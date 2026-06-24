# SMS Autoresponder with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET Core API that automatically responds to inbound SMS messages using the Telnyx SMS API. This tutorial demonstrates webhook handling for inbound messages, secure credential management via environment variables, and proper error handling for telecom APIs. You'll create an endpoint that receives SMS webhooks and sends automatic replies based on message content.

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

- .NET 6.0 or higher installed on your system.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for inbound and outbound SMS.
- A publicly accessible URL for webhook delivery (ngrok, Cloudflare Tunnel, or deployed server).
- Visual Studio, Visual Studio Code, or a command-line editor.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-auto-reply-bot-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-auto-reply-bot-csharp
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to handle SMS operations. Add a new file `Services/SmsService.cs`:

```csharp
using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using TelnyxAutoresponder.Configuration;
using Microsoft.Extensions.Options;

namespace TelnyxAutoresponder.Services
{
    public class SmsService
    {
        private readonly HttpClient _httpClient;
        private readonly TelnyxOptions _options;
        private const string TelnyxApiUrl = "https://api.telnyx.com/v2/messages";

        public SmsService(HttpClient httpClient, IOptions<TelnyxOptions> options)
        {
            _httpClient = httpClient;
            _options = options.Value;
            
            // Configure default headers for Telnyx API authentication
            _httpClient.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", _options.ApiKey);
        }

        public async Task<SmsResponse> SendSmsAsync(string toNumber, string messageText)
        {
            // Validate E.164 format to prevent API errors
            if (string.IsNullOrWhiteSpace(toNumber) || !toNumber.StartsWith("+"))
            {
                throw new ArgumentException(
                    "Phone number must be in E.164 format (e.g., +15551234567)", 
                    nameof(toNumber));
            }

            if (string.IsNullOrWhiteSpace(messageText))
            {
                throw new ArgumentException("Message text cannot be empty", nameof(messageText));
            }

            var payload = new
            {
                from = _options.PhoneNumber,
                to = toNumber,
                text = messageText
            };

            var content = new StringContent(
                JsonConvert.SerializeObject(payload),
                Encoding.UTF8,
                "application/json");

            try
            {
                var response = await _httpClient.PostAsync(TelnyxApiUrl, content);

                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    throw new HttpRequestException(
                        $"Telnyx API error: {response.StatusCode} - {errorContent}");
                }

                var responseContent = await response.Content.ReadAsStringAsync();
                var result = JsonConvert.DeserializeObject<TelnyxApiResponse>(responseContent);

                return new SmsResponse
                {
                    MessageId = result?.Data?.Id,
                    Status = result?.Data?.To?[0]?.Status ?? "unknown",
                    From = _options.PhoneNumber,
                    To = toNumber
                };
            }
            catch (HttpRequestException ex) when (ex.Message.Contains("401"))
            {
                throw new UnauthorizedAccessException("Invalid Telnyx API key", ex);
            }
            catch (HttpRequestException ex) when (ex.Message.Contains("429"))
            {
                throw new InvalidOperationException("Rate limit exceeded. Please slow down.", ex);
            }
        }
    }

    // Response models for Telnyx API
    public class TelnyxApiResponse
    {
        [JsonProperty("data")]
        public MessageData Data { get; set; }
    }

    public class MessageData
    {
        [JsonProperty("id")]
        public string Id { get; set; }

        [JsonProperty("to")]
        public ToRecipient[] To { get; set; }
    }

    public class ToRecipient
    {
        [JsonProperty("status")]
        public string Status { get; set; }
    }

    public class SmsResponse
    {
        public string MessageId { get; set; }
        public string Status { get; set; }
        public string From { get; set; }
        public string To { get; set; }
    }
}
```

Create a webhook handler service. Add a new file `Services/WebhookService.cs`:

```csharp
using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace TelnyxAutoresponder.Services
{
    public class WebhookService
    {
        public string GenerateAutoResponse(InboundSmsWebhook webhook)
        {
            // Extract message content and sender
            var messageText = webhook?.Data?.Payload?.Text ?? "";
            var senderNumber = webhook?.Data?.Payload?.From?.PhoneNumber ?? "Unknown";

            // Generate contextual auto-response based on message content
            if (messageText.Contains("help", StringComparison.OrdinalIgnoreCase))
            {
                return "Thanks for contacting us! Our support team will respond shortly. " +
                       "For urgent issues, please call our hotline.";
            }

            if (messageText.Contains("hours", StringComparison.OrdinalIgnoreCase) ||
                messageText.Contains("open", StringComparison.OrdinalIgnoreCase))
            {
                return "We're open Monday-Friday, 9 AM - 6 PM EST. " +
                       "Your message has been received and we'll respond during business hours.";
            }

            // Default auto-response
            return "Thank you for your message! We've received it and will respond as soon as possible.";
        }

        public bool IsValidWebhook(InboundSmsWebhook webhook)
        {
            // Validate webhook structure to prevent processing malformed requests
            return webhook?.Data?.Payload?.Text != null &&
                   webhook?.Data?.Payload?.From?.PhoneNumber != null &&
                   webhook?.Data?.Payload?.To != null;
        }
    }

    // Webhook payload models
    public class InboundSmsWebhook
    {
        [JsonProperty("data")]
        public WebhookData Data { get; set; }

        [JsonProperty("meta")]
        public WebhookMeta Meta { get; set; }
    }

    public class WebhookData
    {
        [JsonProperty("payload")]
        public SmsPayload Payload { get; set; }
    }

    public class SmsPayload
    {
        [JsonProperty("id")]
        public string Id { get; set; }

        [JsonProperty("text")]
        public string Text { get; set; }

        [JsonProperty("from")]
        public PhoneInfo From { get; set; }

        [JsonProperty("to")]
        public string[] To { get; set; }

        [JsonProperty("received_at")]
        public string ReceivedAt { get; set; }
    }

    public class PhoneInfo
    {
        [JsonProperty("phone_number")]
        public string PhoneNumber { get; set; }
    }

    public class WebhookMeta
    {
        [JsonProperty("attempt_number")]
        public int AttemptNumber { get; set; }

        [JsonProperty("delivered_to")]
        public string DeliveredTo { get; set; }
    }
}
```

Create the webhook controller. Add a new file `Controllers/WebhooksController.cs`:

```csharp
using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using TelnyxAutoresponder.Services;

namespace TelnyxAutoresponder.Controllers
{
    [ApiController]
    [Route("webhooks")]
    public class WebhooksController : ControllerBase
    {
        private readonly SmsService _smsService;
        private readonly WebhookService _webhookService;
        private readonly ILogger<WebhooksController> _logger;

        public WebhooksController(
            SmsService smsService,
            WebhookService webhookService,
            ILogger<WebhooksController> logger)
        {
            _smsService = smsService;
            _webhookService = webhookService;
            _logger = logger;
        }

        [HttpPost("sms")]
        public async Task<IActionResult> HandleSmsWebhook([FromBody] InboundSmsWebhook webhook)
        {
            // Validate webhook structure
            if (webhook == null)
            {
                _logger.LogWarning("Received null webhook payload");
                return BadRequest(new { error = "Webhook payload required" });
            }

            if (!_webhookService.IsValidWebhook(webhook))
            {
                _logger.LogWarning("Received malformed webhook: missing required fields");
                return BadRequest(new { error = "Invalid webhook structure" });
            }

            try
            {
                var messageText = webhook.Data.Payload.Text;
                var senderNumber = webhook.Data.Payload.From.PhoneNumber;
                var messageId = webhook.Data.Payload.Id;

                _logger.LogInformation(
                    "Received SMS from {SenderNumber}: {MessageText}",
                    senderNumber, messageText);

                // Generate contextual auto-response
                var autoResponse = _webhookService.GenerateAutoResponse(webhook);

                // Send auto-response back to sender
                var smsResponse = await _smsService.SendSmsAsync(senderNumber, autoResponse);

                _logger.LogInformation(
                    "Sent auto-response to {SenderNumber} with message ID {ResponseMessageId}",
                    senderNumber, smsResponse.MessageId);

                // Return 200 OK to acknowledge webhook receipt
                return Ok(new
                {
                    success = true,
                    inbound_message_id = messageId,
                    response_message_id = smsResponse.MessageId,
                    response_text = autoResponse
                });
            }
            catch (ArgumentException ex)
            {
                _logger.LogError(ex, "Validation error processing webhook");
                return BadRequest(new { error = ex.Message });
            }
            catch (UnauthorizedAccessException ex)
            {
                _logger.LogError(ex, "Authentication error with Telnyx API");
                return StatusCode(401, new { error = "Invalid API credentials" });
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("Rate limit"))
            {
                _logger.LogError(ex, "Rate limit exceeded");
                return StatusCode(429, new { error = "Rate limit exceeded" });
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "HTTP error communicating with Telnyx API");
                return StatusCode(503, new { error = "Service unavailable" });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error processing webhook");
                return StatusCode(500, new { error = "Internal server error" });
            }
        }
    }
}
```

Update `Program.cs` to register services and configure the application:

```csharp
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using TelnyxAutoresponder.Configuration;
using TelnyxAutoresponder.Services;

var builder = WebApplication.CreateBuilder(args);

// Load user secrets in development
if (builder.Environment.IsDevelopment())
{
    builder.Configuration.AddUserSecrets<Program>();
}

// Add services to the container
builder.Services.Configure<TelnyxOptions>(
    builder.Configuration.GetSection("Telnyx"));

builder.Services.AddHttpClient<SmsService>();
builder.Services.AddScoped<WebhookService>();

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

app.Run();
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-auto-reply-bot-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The webhook handler returns `{"error": "Invalid API credentials"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in user secrets matches the key from the [Telnyx Portal](https://portal.telnyx.com). Run `dotnet user-secrets list` to confirm the value is set. Ensure there are no trailing spaces. If the key was regenerated, update it with `dotnet user-secrets set "Telnyx:ApiKey" "NEW_KEY"` and restart the application. |
| Webhook Not Triggering | Inbound SMS messages are not reaching your webhook endpoint. | Confirm your ngrok URL or public domain is configured in the Telnyx Portal under Messaging Profiles > Inbound Settings. The webhook URL must be `https://your-domain.com/webhooks/sms` (exact path). Verify the endpoint is publicly accessible by testing with curl from another machine. Check application logs for incoming requests using `dotnet run` in development mode. |
| Invalid Phone Number Format | The autoresponder fails with "Phone number must be in E.164 format". | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update the `TELNYX_PHONE_NUMBER` user secret and verify the inbound message's `from.phone_number` field is properly formatted in the webhook payload. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded"}` with HTTP 429. | Telnyx enforces rate limits on API calls. Implement exponential backoff retry logic in `SmsService.SendSmsAsync()` or queue outbound messages asynchronously using a background job service like Hangfire. Reduce the frequency of auto-responses by adding cooldown logic per sender number. |
| Null Reference Exception in Webhook Handler | The application crashes with a null reference error when processing webhooks. | Ensure the webhook payload structure matches the `InboundSmsWebhook` model. The `WebhookService.IsValidWebhook()` method validates required fields before processing. Add null-coalescing operators (`??`) when accessing nested properties. Check application logs to identify which field is null and update the validation logic accordingly. |

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

- [Receive SMS Webhooks with C#](/tutorials/sms/csharp/receive-sms-webhook).
- [Send Bulk SMS Messages with C#](/tutorials/sms/csharp/send-bulk-sms).
- [Implement Two-Factor Authentication with SMS](/tutorials/sms/csharp/otp-2fa).
