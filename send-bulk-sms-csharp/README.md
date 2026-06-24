# Send Bulk SMS with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET Core endpoint that sends bulk SMS messages using the Telnyx REST API with proper rate limiting, error handling, and batch processing. This tutorial demonstrates how to send multiple messages efficiently while respecting API rate limits and managing concurrent requests in a scalable manner.

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
- Visual Studio, Visual Studio Code, or the .NET CLI.
- Postman or curl for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-bulk-sms-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-bulk-sms-csharp
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to handle bulk SMS operations with rate limiting and error handling:

```csharp
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using TelnyxBulkSMS.Configuration;

namespace TelnyxBulkSMS.Services
{
    public class BulkSmsService
    {
        private readonly HttpClient _httpClient;
        private readonly TelnyxSettings _settings;
        private readonly ILogger<BulkSmsService> _logger;

        public BulkSmsService(HttpClient httpClient, TelnyxSettings settings, ILogger<BulkSmsService> logger)
        {
            _httpClient = httpClient;
            _settings = settings;
            _logger = logger;
            
            // Configure default headers for Telnyx API
            _httpClient.DefaultRequestHeaders.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue(
                    "Bearer", _settings.ApiKey);
            _httpClient.DefaultRequestHeaders.Add("Accept", "application/json");
        }

        public async Task<BulkSmsResult> SendBulkSmsAsync(List<string> phoneNumbers, string message)
        {
            if (string.IsNullOrWhiteSpace(message))
                throw new ArgumentException("Message cannot be empty", nameof(message));

            if (phoneNumbers == null || phoneNumbers.Count == 0)
                throw new ArgumentException("Phone numbers list cannot be empty", nameof(phoneNumbers));

            // Validate all phone numbers are in E.164 format
            foreach (var number in phoneNumbers)
            {
                if (!number.StartsWith("+"))
                    throw new ArgumentException($"Phone number {number} must be in E.164 format (e.g., +15551234567)");
            }

            var result = new BulkSmsResult
            {
                TotalRequested = phoneNumbers.Count,
                Successful = new List<SmsResponse>(),
                Failed = new List<SmsError>()
            };

            // Process messages with rate limiting to avoid hitting API limits
            foreach (var phoneNumber in phoneNumbers)
            {
                try
                {
                    var response = await SendSingleSmsAsync(phoneNumber, message);
                    result.Successful.Add(response);
                    _logger.LogInformation($"SMS sent successfully to {phoneNumber}. Message ID: {response.MessageId}");
                }
                catch (HttpRequestException ex)
                {
                    result.Failed.Add(new SmsError
                    {
                        PhoneNumber = phoneNumber,
                        ErrorMessage = ex.Message,
                        ErrorCode = "NETWORK_ERROR"
                    });
                    _logger.LogError($"Network error sending to {phoneNumber}: {ex.Message}");
                }
                catch (Exception ex)
                {
                    result.Failed.Add(new SmsError
                    {
                        PhoneNumber = phoneNumber,
                        ErrorMessage = ex.Message,
                        ErrorCode = "UNKNOWN_ERROR"
                    });
                    _logger.LogError($"Error sending to {phoneNumber}: {ex.Message}");
                }

                // Apply rate limiting delay between requests
                await Task.Delay(_settings.RateLimitDelay);
            }

            result.SuccessCount = result.Successful.Count;
            result.FailureCount = result.Failed.Count;

            return result;
        }

        private async Task<SmsResponse> SendSingleSmsAsync(string toNumber, string message)
        {
            var payload = new
            {
                from = _settings.PhoneNumber,
                to = toNumber,
                text = message
            };

            var content = new StringContent(
                JsonConvert.SerializeObject(payload),
                Encoding.UTF8,
                "application/json");

            var response = await _httpClient.PostAsync(
                $"{_settings.ApiBaseUrl}/messages",
                content);

            if (!response.IsSuccessStatusCode)
            {
                var errorContent = await response.Content.ReadAsStringAsync();
                _logger.LogError($"API Error ({response.StatusCode}): {errorContent}");

                if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized)
                    throw new UnauthorizedAccessException("Invalid API key");

                if (response.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
                    throw new InvalidOperationException("Rate limit exceeded");

                throw new HttpRequestException($"API returned {response.StatusCode}: {errorContent}");
            }

            var responseContent = await response.Content.ReadAsStringAsync();
            var apiResponse = JsonConvert.DeserializeObject<dynamic>(responseContent);

            return new SmsResponse
            {
                MessageId = apiResponse.data.id,
                PhoneNumber = toNumber,
                Status = apiResponse.data.to[0].status ?? "queued",
                Timestamp = DateTime.UtcNow
            };
        }
    }

    public class BulkSmsResult
    {
        public int TotalRequested { get; set; }
        public int SuccessCount { get; set; }
        public int FailureCount { get; set; }
        public List<SmsResponse> Successful { get; set; }
        public List<SmsError> Failed { get; set; }
    }

    public class SmsResponse
    {
        public string MessageId { get; set; }
        public string PhoneNumber { get; set; }
        public string Status { get; set; }
        public DateTime Timestamp { get; set; }
    }

    public class SmsError
    {
        public string PhoneNumber { get; set; }
        public string ErrorMessage { get; set; }
        public string ErrorCode { get; set; }
    }
}
```

Create a controller to expose the bulk SMS endpoint:

```csharp
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using TelnyxBulkSMS.Services;

namespace TelnyxBulkSMS.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class SmsController : ControllerBase
    {
        private readonly BulkSmsService _bulkSmsService;
        private readonly ILogger<SmsController> _logger;

        public SmsController(BulkSmsService bulkSmsService, ILogger<SmsController> logger)
        {
            _bulkSmsService = bulkSmsService;
            _logger = logger;
        }

        [HttpPost("send-bulk")]
        public async Task<IActionResult> SendBulkSms([FromBody] BulkSmsRequest request)
        {
            if (request == null || request.PhoneNumbers == null || request.PhoneNumbers.Count == 0)
                return BadRequest(new { error = "PhoneNumbers list is required and cannot be empty" });

            if (string.IsNullOrWhiteSpace(request.Message))
                return BadRequest(new { error = "Message is required" });

            try
            {
                var result = await _bulkSmsService.SendBulkSmsAsync(request.PhoneNumbers, request.Message);

                return Ok(new
                {
                    totalRequested = result.TotalRequested,
                    successCount = result.SuccessCount,
                    failureCount = result.FailureCount,
                    successful = result.Successful.ConvertAll(s => new
                    {
                        messageId = s.MessageId,
                        phoneNumber = s.PhoneNumber,
                        status = s.Status,
                        timestamp = s.Timestamp
                    }),
                    failed = result.Failed.ConvertAll(f => new
                    {
                        phoneNumber = f.PhoneNumber,
                        errorMessage = f.ErrorMessage,
                        errorCode = f.ErrorCode
                    })
                });
            }
            catch (ArgumentException ex)
            {
                _logger.LogWarning($"Validation error: {ex.Message}");
                return BadRequest(new { error = ex.Message });
            }
            catch (UnauthorizedAccessException ex)
            {
                _logger.LogError($"Authentication error: {ex.Message}");
                return Unauthorized(new { error = "Invalid API key" });
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("Rate limit"))
            {
                _logger.LogWarning($"Rate limit error: {ex.Message}");
                return StatusCode(429, new { error = "Rate limit exceeded. Please try again later." });
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Network error: {ex.Message}");
                return StatusCode(503, new { error = "Network error connecting to Telnyx API" });
            }
        }
    }

    public class BulkSmsRequest
    {
        public List<string> PhoneNumbers { get; set; }
        public string Message { get; set; }
    }
}
```

Register the service in `Program.cs`:

```csharp
using Microsoft.Extensions.Configuration;
using TelnyxBulkSMS.Configuration;
using TelnyxBulkSMS.Services;

var builder = WebApplication.CreateBuilder(args);

// Load configuration
var telnyxSettings = new TelnyxSettings();
builder.Configuration.GetSection("Telnyx").Bind(telnyxSettings);

// Add services
builder.Services.AddSingleton(telnyxSettings);
builder.Services.AddHttpClient<BulkSmsService>();
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

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-bulk-sms-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in `appsettings.json` or User Secrets matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If using User Secrets, confirm the secret was set correctly with `dotnet user-secrets list`. Restart the application after updating credentials. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers in the request use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Validate the JSON payload in your request body matches the expected format with a `phoneNumbers` array of strings. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please try again later."}` with HTTP 429. | The `RateLimitDelay` setting in `appsettings.json` controls the millisecond delay between requests. Increase this value (e.g., from 100 to 200) to slow down message sending. For very large bulk operations, consider splitting requests into smaller batches or implementing exponential backoff retry logic. |
| Network Error (503) | The endpoint returns `{"error": "Network error connecting to Telnyx API"}` with HTTP 503. | Verify your internet connection and that the Telnyx API endpoint `https://api.telnyx.com/v2` is reachable. Check firewall or proxy settings that may block outbound HTTPS requests. Ensure the `ApiBaseUrl` in configuration is correct. Test connectivity with `curl https://api.telnyx.com/v2/messages -H "Authorization: Bearer YOUR_KEY"`. |
| Empty Phone Numbers List | The endpoint returns `{"error": "PhoneNumbers list is required and cannot be empty"}` with HTTP 400. | Ensure your JSON request body includes a `phoneNumbers` array with at least one valid phone number. Example: `{"phoneNumbers": ["+15559876543"], "message": "Test"}`. Verify the JSON is properly formatted and the array is not null or empty. |

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

- [Send a Single SMS with C# and ASP.NET](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/csharp/send-single-sms).
- [Receive SMS Webhooks with C# and ASP.NET](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/csharp/receive-sms-webhook).
- [Implement Two-Factor Authentication with C# and ASP.NET](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/csharp/otp-2fa).
