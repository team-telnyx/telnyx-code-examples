# MMS Receive with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET Core endpoint that receives inbound MMS messages via Telnyx webhooks. This tutorial demonstrates webhook configuration, secure credential management, and proper handling of multipart media attachments. You'll learn to parse incoming MMS payloads, validate webhook signatures, and persist message data for downstream processing.

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
- A Telnyx phone number enabled for inbound SMS/MMS.
- A publicly accessible URL (ngrok, Cloudflare Tunnel, or deployed server) for webhook delivery.
- Visual Studio, Visual Studio Code, or the .NET CLI.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/receive-mms-webhook-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a model to represent inbound MMS webhook payloads. Add `MmsWebhookPayload.cs`:

```csharp
using System.Text.Json.Serialization;

namespace TelnyxMmsReceiver.Models
{
    public class MmsWebhookPayload
    {
        [JsonPropertyName("data")]
        public MmsMessageData Data { get; set; }
        
        [JsonPropertyName("meta")]
        public WebhookMeta Meta { get; set; }
    }

    public class MmsMessageData
    {
        [JsonPropertyName("id")]
        public string Id { get; set; }

        [JsonPropertyName("type")]
        public string Type { get; set; }

        [JsonPropertyName("attributes")]
        public MmsAttributes Attributes { get; set; }
    }

    public class MmsAttributes
    {
        [JsonPropertyName("from")]
        public PhoneNumber From { get; set; }

        [JsonPropertyName("to")]
        public List<PhoneNumber> To { get; set; }

        [JsonPropertyName("text")]
        public string Text { get; set; }

        [JsonPropertyName("media_urls")]
        public List<string> MediaUrls { get; set; }

        [JsonPropertyName("received_at")]
        public DateTime ReceivedAt { get; set; }

        [JsonPropertyName("direction")]
        public string Direction { get; set; }
    }

    public class PhoneNumber
    {
        [JsonPropertyName("phone_number")]
        public string Number { get; set; }

        [JsonPropertyName("status")]
        public string Status { get; set; }
    }

    public class WebhookMeta
    {
        [JsonPropertyName("attempt_number")]
        public int AttemptNumber { get; set; }

        [JsonPropertyName("delivered_at")]
        public DateTime DeliveredAt { get; set; }
    }
}
```

Create a service to handle MMS message processing. Add `MmsService.cs`:

```csharp
using Microsoft.Extensions.Logging;
using TelnyxMmsReceiver.Models;

namespace TelnyxMmsReceiver.Services
{
    public interface IMmsService
    {
        Task<MmsMessageResponse> ProcessInboundMmsAsync(MmsWebhookPayload payload);
    }

    public class MmsService : IMmsService
    {
        private readonly ILogger<MmsService> _logger;

        public MmsService(ILogger<MmsService> logger)
        {
            _logger = logger;
        }

        public async Task<MmsMessageResponse> ProcessInboundMmsAsync(MmsWebhookPayload payload)
        {
            if (payload?.Data?.Attributes == null)
            {
                throw new ArgumentException("Invalid MMS payload structure");
            }

            var attributes = payload.Data.Attributes;

            // Validate required fields
            if (attributes.From == null || string.IsNullOrEmpty(attributes.From.Number))
            {
                throw new ArgumentException("Sender phone number is required");
            }

            if (attributes.To == null || attributes.To.Count == 0)
            {
                throw new ArgumentException("Recipient phone number is required");
            }

            // Log the inbound MMS for audit trail
            _logger.LogInformation(
                "Received MMS from {From} to {To} with {MediaCount} attachments at {ReceivedAt}",
                attributes.From.Number,
                string.Join(", ", attributes.To.Select(t => t.Number)),
                attributes.MediaUrls?.Count ?? 0,
                attributes.ReceivedAt);

            // Process media URLs if present
            var processedMediaUrls = new List<string>();
            if (attributes.MediaUrls != null && attributes.MediaUrls.Count > 0)
            {
                foreach (var mediaUrl in attributes.MediaUrls)
                {
                    // Validate URL format
                    if (Uri.TryCreate(mediaUrl, UriKind.Absolute, out var uri))
                    {
                        processedMediaUrls.Add(mediaUrl);
                        _logger.LogInformation("Processed media attachment: {MediaUrl}", mediaUrl);
                    }
                    else
                    {
                        _logger.LogWarning("Invalid media URL format: {MediaUrl}", mediaUrl);
                    }
                }
            }

            // Simulate async processing (e.g., storing to database, triggering workflows)
            await Task.Delay(100);

            return new MmsMessageResponse
            {
                MessageId = payload.Data.Id,
                From = attributes.From.Number,
                To = attributes.To.First().Number,
                Text = attributes.Text ?? string.Empty,
                MediaCount = processedMediaUrls.Count,
                ReceivedAt = attributes.ReceivedAt,
                ProcessedAt = DateTime.UtcNow
            };
        }
    }

    public class MmsMessageResponse
    {
        public string MessageId { get; set; }
        public string From { get; set; }
        public string To { get; set; }
        public string Text { get; set; }
        public int MediaCount { get; set; }
        public DateTime ReceivedAt { get; set; }
        public DateTime ProcessedAt { get; set; }
    }
}
```

Register the service in `Program.cs`:

```csharp
builder.Services.AddScoped<IMmsService, MmsService>();
```

Create the webhook controller. Add `MmsWebhookController.cs`:

```csharp
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using System.Security.Cryptography;
using System.Text;
using TelnyxMmsReceiver.Configuration;
using TelnyxMmsReceiver.Models;
using TelnyxMmsReceiver.Services;

namespace TelnyxMmsReceiver.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class MmsWebhookController : ControllerBase
    {
        private readonly IMmsService _mmsService;
        private readonly ILogger<MmsWebhookController> _logger;
        private readonly TelnyxOptions _telnyxOptions;

        public MmsWebhookController(
            IMmsService mmsService,
            ILogger<MmsWebhookController> logger,
            IOptions<TelnyxOptions> telnyxOptions)
        {
            _mmsService = mmsService;
            _logger = logger;
            _telnyxOptions = telnyxOptions.Value;
        }

        [HttpPost("receive")]
        public async Task<IActionResult> ReceiveMms([FromBody] MmsWebhookPayload payload)
        {
            // Validate webhook signature if secret is configured
            if (!string.IsNullOrEmpty(_telnyxOptions.WebhookSecret))
            {
                if (!ValidateWebhookSignature(Request, _telnyxOptions.WebhookSecret))
                {
                    _logger.LogWarning("Webhook signature validation failed");
                    return Unauthorized(new { error = "Invalid webhook signature" });
                }
            }

            // Validate payload structure
            if (payload == null || payload.Data == null)
            {
                _logger.LogWarning("Received invalid MMS webhook payload");
                return BadRequest(new { error = "Invalid payload structure" });
            }

            try
            {
                // Process the inbound MMS
                var result = await _mmsService.ProcessInboundMmsAsync(payload);

                _logger.LogInformation(
                    "Successfully processed MMS {MessageId} from {From}",
                    result.MessageId,
                    result.From);

                // Return serialized response (not SDK object)
                return Ok(new
                {
                    messageId = result.MessageId,
                    from = result.From,
                    to = result.To,
                    text = result.Text,
                    mediaCount = result.MediaCount,
                    receivedAt = result.ReceivedAt,
                    processedAt = result.ProcessedAt
                });
            }
            catch (ArgumentException ex)
            {
                _logger.LogError("Validation error processing MMS: {Error}", ex.Message);
                return BadRequest(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error processing MMS webhook");
                return StatusCode(500, new { error = "Internal server error" });
            }
        }

        /// <summary>
        /// Validates the webhook signature using HMAC-SHA256.
        /// Telnyx includes a signature header for security verification.
        /// </summary>
        private bool ValidateWebhookSignature(HttpRequest request, string secret)
        {
            // Telnyx sends the signature in the X-Telnyx-Signature-V2 header
            if (!request.Headers.TryGetValue("X-Telnyx-Signature-V2", out var signatureHeader))
            {
                _logger.LogWarning("Missing webhook signature header");
                return false;
            }

            // Read the raw request body for signature verification
            request.Body.Position = 0;
            using (var reader = new StreamReader(request.Body, Encoding.UTF8, leaveOpen: true))
            {
                var body = reader.ReadToEndAsync().Result;
                request.Body.Position = 0;

                // Compute HMAC-SHA256 of the body using the webhook secret
                using (var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret)))
                {
                    var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(body));
                    var computedSignature = Convert.ToBase64String(hash);

                    // Compare signatures in constant time to prevent timing attacks
                    return CryptographicOperations.FixedTimeEquals(
                        Encoding.UTF8.GetBytes(signatureHeader.ToString()),
                        Encoding.UTF8.GetBytes(computedSignature));
                }
            }
        }
    }
}
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-mms-webhook-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not receiving payloads | The endpoint is configured in the Telnyx Portal but no requests arrive. | Verify the webhook URL is publicly accessible and uses HTTPS. Test with ngrok: `ngrok http 5001` and update the Portal with the generated URL. Ensure your firewall allows inbound traffic on port 5001. Check the Telnyx Portal webhook logs for delivery failures or error responses. |
| Signature validation fails | The endpoint returns 401 "Invalid webhook signature" for valid requests. | Confirm the webhook secret in user-secrets matches exactly what is configured in the Telnyx Portal. Ensure the secret has no leading/trailing whitespace. Verify the request body is read only once—reading it twice will invalidate the signature. Use `request.Body.Position = 0` to reset the stream after reading. |
| Media URLs are null or empty | The MMS contains attachments but `MediaUrls` is always empty in the response. | Check that the inbound MMS actually includes media by examining the raw webhook payload in application logs. Telnyx only includes `media_urls` if the MMS contains attachments. Verify the sender's device supports MMS and the message was sent with images/videos. Test with a real MMS from a mobile device rather than curl. |
| Deserialization errors | The endpoint returns 400 "Invalid payload structure" even with valid JSON. | Verify the JSON property names match the `[JsonPropertyName]` attributes exactly (case-sensitive). Ensure the request Content-Type header is `application/json`. Check that the payload structure matches the `MmsWebhookPayload` model—nested objects like `data.attributes` must be present. Use a JSON validator to confirm the payload is well-formed. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

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

- [Receive SMS Webhooks with C#](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/csharp/receive-sms-webhook).
- [Send Bulk SMS Messages with C#](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/csharp/send-bulk-sms).
- [Implement Two-Factor Authentication with SMS](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/csharp/otp-2fa).
