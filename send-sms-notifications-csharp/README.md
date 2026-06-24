# SMS Notifications with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET Core application that sends SMS notifications using the Telnyx API. This tutorial demonstrates secure credential management via environment variables, proper HTTP client configuration with Bearer token authentication, comprehensive error handling for telecom APIs, and JSON serialization patterns for web responses. You'll create a notification service that integrates with ASP.NET's dependency injection and middleware error handling.

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
- A Telnyx phone number enabled for outbound SMS.
- Visual Studio, Visual Studio Code, or the .NET CLI.
- curl or Postman for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-sms-notifications-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service interface `ISmsNotificationService.cs`:

```csharp
namespace TelnyxSmsNotifications.Services
{
    public interface ISmsNotificationService
    {
        Task<SmsNotificationResponse> SendNotificationAsync(string toNumber, string message);
    }

    public class SmsNotificationResponse
    {
        public string MessageId { get; set; }
        public string Status { get; set; }
        public string From { get; set; }
        public string To { get; set; }
    }
}
```

Create the service implementation `SmsNotificationService.cs`:

```csharp
using Microsoft.Extensions.Options;
using System.Text;
using System.Text.Json;
using TelnyxSmsNotifications.Configuration;

namespace TelnyxSmsNotifications.Services
{
    public class SmsNotificationService : ISmsNotificationService
    {
        private readonly HttpClient _httpClient;
        private readonly TelnyxConfig _config;
        private readonly ILogger<SmsNotificationService> _logger;

        public SmsNotificationService(
            IHttpClientFactory httpClientFactory,
            IOptions<TelnyxConfig> config,
            ILogger<SmsNotificationService> logger)
        {
            _httpClient = httpClientFactory.CreateClient("TelnyxClient");
            _config = config.Value;
            _logger = logger;
        }

        public async Task<SmsNotificationResponse> SendNotificationAsync(string toNumber, string message)
        {
            // Validate E.164 format to prevent API errors
            if (string.IsNullOrWhiteSpace(toNumber) || !toNumber.StartsWith("+"))
            {
                throw new ArgumentException(
                    "Phone number must be in E.164 format (e.g., +15551234567)", 
                    nameof(toNumber));
            }

            if (string.IsNullOrWhiteSpace(message))
            {
                throw new ArgumentException("Message cannot be empty", nameof(message));
            }

            // Prepare request payload
            var payload = new
            {
                from_ = _config.PhoneNumber,
                to = toNumber,
                text = message
            };

            var jsonContent = new StringContent(
                JsonSerializer.Serialize(payload),
                Encoding.UTF8,
                "application/json");

            try
            {
                _logger.LogInformation(
                    "Sending SMS notification to {ToNumber} from {FromNumber}",
                    toNumber, _config.PhoneNumber);

                var response = await _httpClient.PostAsync("messages", jsonContent);

                // Handle HTTP errors
                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    _logger.LogError(
                        "Telnyx API error: {StatusCode} - {ErrorContent}",
                        response.StatusCode, errorContent);

                    throw new HttpRequestException(
                        $"Telnyx API returned {response.StatusCode}: {errorContent}",
                        null,
                        response.StatusCode);
                }

                // Parse successful response
                var responseContent = await response.Content.ReadAsStringAsync();
                using var jsonDoc = JsonDocument.Parse(responseContent);
                var root = jsonDoc.RootElement;

                // Extract message ID and status from nested response structure
                var messageId = root.GetProperty("data").GetProperty("id").GetString();
                var toArray = root.GetProperty("data").GetProperty("to");
                var status = toArray.EnumerateArray().FirstOrDefault()
                    .GetProperty("status").GetString() ?? "queued";

                _logger.LogInformation(
                    "SMS notification sent successfully. Message ID: {MessageId}",
                    messageId);

                return new SmsNotificationResponse
                {
                    MessageId = messageId,
                    Status = status,
                    From = _config.PhoneNumber,
                    To = toNumber
                };
            }
            catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                _logger.LogError("Authentication failed: Invalid API key");
                throw new InvalidOperationException("Invalid Telnyx API key", ex);
            }
            catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
            {
                _logger.LogError("Rate limit exceeded");
                throw new InvalidOperationException("Rate limit exceeded. Please slow down.", ex);
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError("Network error: {Message}", ex.Message);
                throw new InvalidOperationException("Network error connecting to Telnyx", ex);
            }
        }
    }
}
```

Create the controller `SmsNotificationController.cs`:

```csharp
using Microsoft.AspNetCore.Mvc;
using TelnyxSmsNotifications.Services;

namespace TelnyxSmsNotifications.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class SmsNotificationController : ControllerBase
    {
        private readonly ISmsNotificationService _smsService;
        private readonly ILogger<SmsNotificationController> _logger;

        public SmsNotificationController(
            ISmsNotificationService smsService,
            ILogger<SmsNotificationController> logger)
        {
            _smsService = smsService;
            _logger = logger;
        }

        [HttpPost("send")]
        public async Task<IActionResult> SendNotification([FromBody] SendNotificationRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.To) || string.IsNullOrWhiteSpace(request.Message))
            {
                return BadRequest(new { error = "Missing required fields: 'to' and 'message'" });
            }

            try
            {
                var result = await _smsService.SendNotificationAsync(request.To, request.Message);
                return Ok(new
                {
                    message_id = result.MessageId,
                    status = result.Status,
                    from = result.From,
                    to = result.To
                });
            }
            catch (ArgumentException ex)
            {
                _logger.LogWarning("Validation error: {Message}", ex.Message);
                return BadRequest(new { error = ex.Message });
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("Invalid Telnyx API key"))
            {
                _logger.LogError("Authentication error: {Message}", ex.Message);
                return Unauthorized(new { error = "Invalid API key" });
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("Rate limit"))
            {
                _logger.LogError("Rate limit error: {Message}", ex.Message);
                return StatusCode(429, new { error = "Rate limit exceeded. Please slow down." });
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("Network error"))
            {
                _logger.LogError("Network error: {Message}", ex.Message);
                return StatusCode(503, new { error = "Network error connecting to Telnyx" });
            }
            catch (Exception ex)
            {
                _logger.LogError("Unexpected error: {Message}", ex.Message);
                return StatusCode(500, new { error = "An unexpected error occurred" });
            }
        }
    }

    public class SendNotificationRequest
    {
        public string To { get; set; }
        public string Message { get; set; }
    }
}
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-notifications-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the application after updating the `.env` file. The `Env.Load()` call in `Program.cs` executes only once at startup. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Environment Variable Not Set | The application throws `InvalidOperationException: TELNYX_API_KEY not set` during startup. | Confirm your `.env` file exists in the project root directory (same level as `Program.cs`) and contains both `TELNYX_API_KEY` and `TELNYX_PHONE_NUMBER`. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). Verify the DotNetEnv NuGet package is installed: `dotnet add package DotNetEnv`. |
| HTTPS Certificate Error | curl returns `SSL certificate problem: self signed certificate` when testing locally. | Use `curl -k` (insecure flag) to bypass certificate validation for local testing, or use `http://localhost:5000` if HTTP is enabled. In production, use valid HTTPS certificates. Alternatively, use Postman which handles self-signed certificates more gracefully. |
| Rate Limit (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | Telnyx enforces rate limits on API calls. Implement exponential backoff retry logic in production. Space out requests and consider batching notifications. Check the [Telnyx documentation](https://developers.telnyx.com) for current rate limit thresholds. |

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
