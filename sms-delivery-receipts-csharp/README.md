# Delivery Receipts with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET application that receives and processes SMS delivery receipts from Telnyx. This tutorial demonstrates webhook configuration, secure credential management, and proper handling of message status updates in a real-world scenario. You'll learn to track message delivery status, handle webhook events, and store delivery data for audit and analytics purposes.

## Who Is This For?

- **C# developers** building sms features with ASP.NET.
- **Backend engineers** integrating telephony or messaging into existing applications.
- **DevOps teams** looking for containerized, production-ready telecom examples.
- **Startups and enterprises** replacing legacy telecom providers with a modern API-first platform.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform that gives developers a single API for [voice](https://telnyx.com/products/voice-ai-agents), [messaging](https://telnyx.com/products/sms-api), [SIP](https://telnyx.com/products/sip-trunks), [AI](https://telnyx.com/ai-assistants), and [IoT](https://telnyx.com/products/iot-sim-card) — no Frankenstack required.

- **Integrated platform** — [Voice](https://telnyx.com/products/voice-ai-agents), [SMS](https://telnyx.com/products/sms-api), [SIP trunking](https://telnyx.com/products/sip-trunks), [AI assistants](https://telnyx.com/ai-assistants), and [IoT SIM management](https://telnyx.com/products/iot-sim-card) under one roof. No stitching together multiple vendors.
- **Global private network** — Calls and messages traverse the Telnyx-owned IP network for lower latency and higher reliability than the public internet.
- **Developer-first** — SDKs for Python, Node.js, Go, Ruby, Java, and PHP. Comprehensive webhook event model. Sandbox environment for testing.
- **Competitive pricing** — Pay-as-you-go with no minimums, contracts, or per-seat fees.

## Prerequisites

- .NET 6.0 or higher installed.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for outbound SMS.
- A publicly accessible URL (ngrok, Cloudflare Tunnel, or deployed server) for webhook callbacks.
- Visual Studio, Visual Studio Code, or the .NET CLI.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-delivery-receipts-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-delivery-receipts-csharp
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a `Services` folder and add a `TelnyxService.cs` class to handle API calls:

```csharp
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace TelnyxDeliveryReceipts.Services
{
    public class TelnyxService
    {
        private readonly HttpClient _httpClient;
        private readonly string _apiKey;
        private readonly string _fromNumber;
        private const string BaseUrl = "https://api.telnyx.com/v2";

        public TelnyxService(HttpClient httpClient)
        {
            _httpClient = httpClient;
            _apiKey = Environment.GetEnvironmentVariable("TELNYX_API_KEY");
            _fromNumber = Environment.GetEnvironmentVariable("TELNYX_PHONE_NUMBER");

            if (string.IsNullOrEmpty(_apiKey))
                throw new InvalidOperationException("TELNYX_API_KEY environment variable not set");
            if (string.IsNullOrEmpty(_fromNumber))
                throw new InvalidOperationException("TELNYX_PHONE_NUMBER environment variable not set");

            // Configure default headers for all requests
            _httpClient.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", _apiKey);
            _httpClient.DefaultRequestHeaders.Accept.Add(
                new MediaTypeWithQualityHeaderValue("application/json"));
        }

        public async Task<Dictionary<string, object>> SendSmsAsync(string toNumber, string message)
        {
            if (!toNumber.StartsWith("+"))
                throw new ArgumentException("Phone number must be in E.164 format (e.g., +15551234567)");

            var payload = new
            {
                from_ = _fromNumber,
                to = toNumber,
                text = message
            };

            var json = JsonSerializer.Serialize(payload);
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            try
            {
                var response = await _httpClient.PostAsync($"{BaseUrl}/messages", content);

                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    throw new HttpRequestException(
                        $"Telnyx API error: {response.StatusCode} - {errorContent}");
                }

                var responseBody = await response.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(responseBody);
                var root = doc.RootElement;

                return new Dictionary<string, object>
                {
                    { "message_id", root.GetProperty("data").GetProperty("id").GetString() },
                    { "status", root.GetProperty("data").GetProperty("to")[0].GetProperty("status").GetString() },
                    { "from", _fromNumber },
                    { "to", toNumber }
                };
            }
            catch (HttpRequestException ex) when (ex.Message.Contains("401"))
            {
                throw new UnauthorizedAccessException("Invalid API key", ex);
            }
            catch (HttpRequestException ex) when (ex.Message.Contains("429"))
            {
                throw new InvalidOperationException("Rate limit exceeded. Please slow down.", ex);
            }
        }
    }
}
```

Create a `Controllers` folder and add a `WebhooksController.cs` to handle delivery receipts:

```csharp
using Microsoft.AspNetCore.Mvc;
using TelnyxDeliveryReceipts.Models;
using System.Collections.Concurrent;

namespace TelnyxDeliveryReceipts.Controllers
{
    [ApiController]
    [Route("webhooks")]
    public class WebhooksController : ControllerBase
    {
        // In-memory storage for demonstration; use a database in production
        private static readonly ConcurrentDictionary<string, MessageStatus> DeliveryStatuses =
            new ConcurrentDictionary<string, MessageStatus>();

        [HttpPost("sms")]
        public IActionResult ReceiveDeliveryReceipt([FromBody] DeliveryReceipt receipt)
        {
            if (receipt == null || receipt.Data == null)
                return BadRequest(new { error = "Invalid webhook payload" });

            // Only process finalized delivery status events
            if (receipt.Type != "message.finalized")
                return Ok(new { message = "Event type not processed" });

            try
            {
                var messageId = receipt.Data.Id;
                var recipients = receipt.Data.To ?? new List<Recipient>();

                foreach (var recipient in recipients)
                {
                    var status = new MessageStatus
                    {
                        MessageId = messageId,
                        PhoneNumber = recipient.PhoneNumber,
                        Status = recipient.Status,
                        ErrorCode = recipient.ErrorCode,
                        ErrorMessage = recipient.ErrorMessage,
                        ReceivedAt = DateTime.UtcNow
                    };

                    // Store delivery status keyed by message ID + phone number
                    var key = $"{messageId}:{recipient.PhoneNumber}";
                    DeliveryStatuses.AddOrUpdate(key, status, (_, _) => status);

                    // Log delivery status for audit trail
                    Console.WriteLine(
                        $"[{DateTime.UtcNow:O}] Message {messageId} to {recipient.PhoneNumber}: {recipient.Status}");

                    if (!string.IsNullOrEmpty(recipient.ErrorCode))
                        Console.WriteLine($"  Error: {recipient.ErrorCode} - {recipient.ErrorMessage}");
                }

                return Ok(new { message = "Delivery receipt processed successfully" });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error processing webhook: {ex.Message}");
                return StatusCode(500, new { error = "Failed to process delivery receipt" });
            }
        }

        [HttpGet("status/{messageId}")]
        public IActionResult GetDeliveryStatus(string messageId)
        {
            var statuses = DeliveryStatuses
                .Where(kvp => kvp.Key.StartsWith($"{messageId}:"))
                .Select(kvp => new
                {
                    message_id = kvp.Value.MessageId,
                    phone_number = kvp.Value.PhoneNumber,
                    status = kvp.Value.Status,
                    error_code = kvp.Value.ErrorCode,
                    error_message = kvp.Value.ErrorMessage,
                    received_at = kvp.Value.ReceivedAt
                })
                .ToList();

            if (!statuses.Any())
                return NotFound(new { error = "No delivery status found for this message ID" });

            return Ok(new { deliveries = statuses });
        }
    }
}
```

Create a `Controllers/MessagesController.cs` to send SMS and track delivery:

```csharp
using Microsoft.AspNetCore.Mvc;
using TelnyxDeliveryReceipts.Services;

namespace TelnyxDeliveryReceipts.Controllers
{
    [ApiController]
    [Route("api/messages")]
    public class MessagesController : ControllerBase
    {
        private readonly TelnyxService _telnyxService;

        public MessagesController(TelnyxService telnyxService)
        {
            _telnyxService = telnyxService;
        }

        [HttpPost("send")]
        public async Task<IActionResult> SendSms([FromBody] SendSmsRequest request)
        {
            if (request == null || string.IsNullOrEmpty(request.To) || string.IsNullOrEmpty(request.Message))
                return BadRequest(new { error = "Missing required fields: 'to' and 'message'" });

            try
            {
                var result = await _telnyxService.SendSmsAsync(request.To, request.Message);
                return Ok(result);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
            catch (UnauthorizedAccessException)
            {
                return Unauthorized(new { error = "Invalid API key" });
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("Rate limit"))
            {
                return StatusCode(429, new { error = ex.Message });
            }
            catch (HttpRequestException ex)
            {
                if (ex.Message.Contains("503"))
                    return StatusCode(503, new { error = "Network error connecting to Telnyx" });

                return StatusCode(500, new { error = ex.Message });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { error = $"Unexpected error: {ex.Message}" });
            }
        }
    }

    public class SendSmsRequest
    {
        public string To { get; set; }
        public string Message { get; set; }
    }
}
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-delivery-receipts-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the ASP.NET application. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Environment Variable Not Set | The application throws `InvalidOperationException: TELNYX_API_KEY environment variable not set` on startup. | Confirm your `.env` file exists in the project root directory and contains the variable. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `DotNetEnv.Env.Load()` call in `Program.cs` must execute before the `TelnyxService` is instantiated. Restart the application after updating the `.env` file. |
| Webhook Not Receiving Events | The `/webhooks/sms` endpoint is not receiving delivery receipt events from Telnyx. | Verify that your webhook URL is publicly accessible and matches the URL configured in the Telnyx Portal. Use ngrok (`ngrok http 5001`) or Cloudflare Tunnel to expose your local development server. Ensure the `message.finalized` event is enabled in your Messaging Profile webhook settings. Check application logs for incoming requests. |
| HTTPS Certificate Error | curl returns `SSL certificate problem: self signed certificate` when testing locally. | Use the `-k` flag with curl to skip certificate verification for local testing: `curl -k https://localhost:5001/...`. For production, use a valid certificate from a trusted CA. In development, you can also use `http://localhost:5000` if you disable HTTPS redirection in `Program.cs`. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What C# version do I need?**

.NET 8.0 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)

## Related Examples

- [Send Bulk SMS Messages](/tutorials/sms/csharp/send-bulk-sms).
- [Receive SMS Webhooks with C#](/tutorials/sms/csharp/receive-sms-webhook).
- [Implement Two-Factor Authentication with SMS](/tutorials/sms/csharp/otp-2fa).
