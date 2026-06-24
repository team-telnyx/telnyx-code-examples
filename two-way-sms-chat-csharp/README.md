# Two Way SMS with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET Core application that sends and receives SMS messages using the Telnyx API. This tutorial demonstrates how to set up inbound webhook handling for received messages, send outbound SMS responses, and manage two-way conversations with proper error handling and security patterns.

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
- A Telnyx phone number enabled for inbound and outbound SMS.
- A publicly accessible URL for webhook delivery (ngrok, Cloudflare Tunnel, or deployed server).
- Visual Studio, Visual Studio Code, or the .NET CLI.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/two-way-sms-chat-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/two-way-sms-chat-csharp
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a `Controllers` folder and add `SmsController.cs` to handle both sending and receiving SMS:

```csharp
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;
using TelnyxTwoWaySMS.Models;

namespace TelnyxTwoWaySMS.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class SmsController : ControllerBase
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly ILogger<SmsController> _logger;

        public SmsController(IHttpClientFactory httpClientFactory, ILogger<SmsController> logger)
        {
            _httpClientFactory = httpClientFactory;
            _logger = logger;
        }

        /// <summary>
        /// Send an outbound SMS message.
        /// </summary>
        [HttpPost("send")]
        public async Task<IActionResult> SendSms([FromBody] SendSmsRequest request)
        {
            // Validate request
            if (string.IsNullOrWhiteSpace(request?.To) || string.IsNullOrWhiteSpace(request?.Message))
            {
                return BadRequest(new { error = "Missing required fields: 'to' and 'message'" });
            }

            // Validate E.164 format
            if (!request.To.StartsWith("+"))
            {
                return BadRequest(new { error = "Phone number must be in E.164 format (e.g., +15551234567)" });
            }

            var fromNumber = Environment.GetEnvironmentVariable("TELNYX_PHONE_NUMBER");
            if (string.IsNullOrWhiteSpace(fromNumber))
            {
                _logger.LogError("TELNYX_PHONE_NUMBER environment variable not set");
                return StatusCode(500, new { error = "Server configuration error" });
            }

            try
            {
                var client = _httpClientFactory.CreateClient("TelnyxClient");

                var payload = new
                {
                    from = fromNumber,
                    to = request.To,
                    text = request.Message
                };

                var content = new StringContent(
                    JsonConvert.SerializeObject(payload),
                    System.Text.Encoding.UTF8,
                    "application/json"
                );

                var response = await client.PostAsync("messages", content);

                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    _logger.LogError($"Telnyx API error: {response.StatusCode} - {errorContent}");

                    return response.StatusCode switch
                    {
                        System.Net.HttpStatusCode.Unauthorized => StatusCode(401, new { error = "Invalid API key" }),
                        System.Net.HttpStatusCode.TooManyRequests => StatusCode(429, new { error = "Rate limit exceeded. Please slow down." }),
                        _ => StatusCode((int)response.StatusCode, new { error = "Failed to send SMS", details = errorContent })
                    };
                }

                var responseContent = await response.Content.ReadAsStringAsync();
                var messageResponse = JsonConvert.DeserializeObject<dynamic>(responseContent);

                var result = new SendSmsResponse
                {
                    MessageId = messageResponse.data.id,
                    Status = messageResponse.data.to[0].status ?? "queued",
                    From = fromNumber,
                    To = request.To
                };

                return Ok(result);
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Network error: {ex.Message}");
                return StatusCode(503, new { error = "Network error connecting to Telnyx" });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Unexpected error: {ex.Message}");
                return StatusCode(500, new { error = "An unexpected error occurred" });
            }
        }

        /// <summary>
        /// Webhook endpoint to receive inbound SMS messages.
        /// </summary>
        [HttpPost("webhooks/receive")]
        public async Task<IActionResult> ReceiveSms([FromBody] SmsWebhookPayload payload)
        {
            if (payload?.Data == null)
            {
                return BadRequest(new { error = "Invalid webhook payload" });
            }

            var messageData = payload.Data;

            // Only process received messages
            if (messageData.Direction != "inbound")
            {
                return Ok(new { status = "ignored" });
            }

            _logger.LogInformation($"Received SMS from {messageData.From?.Number}: {messageData.Text}");

            try
            {
                // Echo back the received message with a prefix
                var replyText = $"Echo: {messageData.Text}";
                var replyRequest = new SendSmsRequest
                {
                    To = messageData.From.Number,
                    Message = replyText
                };

                // Send reply using the same SendSms logic
                var client = _httpClientFactory.CreateClient("TelnyxClient");
                var fromNumber = Environment.GetEnvironmentVariable("TELNYX_PHONE_NUMBER");

                var payload_reply = new
                {
                    from = fromNumber,
                    to = replyRequest.To,
                    text = replyRequest.Message
                };

                var content = new StringContent(
                    JsonConvert.SerializeObject(payload_reply),
                    System.Text.Encoding.UTF8,
                    "application/json"
                );

                var response = await client.PostAsync("messages", content);

                if (response.IsSuccessStatusCode)
                {
                    _logger.LogInformation($"Sent reply to {replyRequest.To}");
                }
                else
                {
                    _logger.LogWarning($"Failed to send reply: {response.StatusCode}");
                }

                return Ok(new { status = "processed", message_id = messageData.Id });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error processing webhook: {ex.Message}");
                return StatusCode(500, new { error = "Failed to process webhook" });
            }
        }
    }
}
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/two-way-sms-chat-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the application after updating the `.env` file. The `Env.Load()` call in `Program.cs` must execute before the HttpClient is configured. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command and webhook configuration to use properly formatted numbers. |
| Webhook Not Receiving Messages | The webhook endpoint is configured but inbound SMS messages are not triggering the `/api/sms/webhooks/receive` endpoint. | Verify the webhook URL in the [Telnyx Portal](https://portal.telnyx.com) Messaging Profile settings is correct and publicly accessible. Use ngrok or a similar tool to expose your local development server. Ensure the URL includes the full path: `https://your-domain.com/api/sms/webhooks/receive`. Check application logs for any errors during webhook processing. |
| Environment Variable Not Set | The application raises an error about `TELNYX_PHONE_NUMBER` or `TELNYX_API_KEY` not being set. | Confirm your `.env` file exists in the project root directory (same level as `Program.cs`). Ensure the file is named exactly `.env` (not `.env.txt` or `env`). Verify the `Env.Load()` call is at the top of `Program.cs` before any environment variable access. Restart the application after creating or modifying the `.env` file. |
| HTTPS Certificate Error in Development | curl or the application fails with certificate validation errors when testing locally. | For local development, use `http://localhost:5000` instead of `https://localhost:5001`, or disable certificate validation in your test client. In production, ensure your server has a valid SSL certificate. The `app.UseHttpsRedirection()` line can be removed in development if needed. |

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

- [Send Bulk SMS Messages](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/csharp/send-bulk-sms).
- [Implement Two-Factor Authentication with SMS](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/csharp/otp-2fa).
- [Build an SMS Survey Application](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/csharp/sms-survey).
