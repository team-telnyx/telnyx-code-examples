# Number Lookup with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET endpoint that performs number lookup queries using the Telnyx SMS API. This tutorial demonstrates how to validate phone numbers, retrieve carrier and geographic information, and handle telecom API errors gracefully in a modern ASP.NET application. Number lookup is essential for verifying phone number validity before sending SMS, reducing failed message delivery and improving user experience.

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
- Visual Studio, Visual Studio Code, or the .NET CLI.
- Basic familiarity with C# and ASP.NET Core.
- curl or Postman for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/phone-number-lookup-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a `Services` folder and add `INumberLookupService.cs` interface:

```csharp
using TelnyxNumberLookup.Models;

namespace TelnyxNumberLookup.Services
{
    public interface INumberLookupService
    {
        Task<NumberLookupResponse> LookupPhoneNumberAsync(string phoneNumber);
    }
}
```

Implement the service in `NumberLookupService.cs`:

```csharp
using System.Text.Json;
using TelnyxNumberLookup.Models;

namespace TelnyxNumberLookup.Services
{
    public class NumberLookupService : INumberLookupService
    {
        private readonly HttpClient _httpClient;
        private readonly ILogger<NumberLookupService> _logger;

        public NumberLookupService(HttpClient httpClient, ILogger<NumberLookupService> logger)
        {
            _httpClient = httpClient;
            _logger = logger;
        }

        public async Task<NumberLookupResponse> LookupPhoneNumberAsync(string phoneNumber)
        {
            // Validate E.164 format to prevent API errors
            if (string.IsNullOrWhiteSpace(phoneNumber) || !phoneNumber.StartsWith("+"))
            {
                throw new ArgumentException(
                    "Phone number must be in E.164 format (e.g., +15551234567)");
            }

            try
            {
                // Call Telnyx number lookup endpoint
                var response = await _httpClient.GetAsync($"number_lookup?phone_number={Uri.EscapeDataString(phoneNumber)}");

                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    _logger.LogError($"Telnyx API error: {response.StatusCode} - {errorContent}");

                    // Map HTTP status codes to appropriate exceptions
                    if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized)
                    {
                        throw new UnauthorizedAccessException("Invalid API key");
                    }
                    else if (response.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
                    {
                        throw new InvalidOperationException("Rate limit exceeded. Please slow down.");
                    }
                    else
                    {
                        throw new HttpRequestException(
                            $"Telnyx API returned {response.StatusCode}: {errorContent}");
                    }
                }

                var content = await response.Content.ReadAsStringAsync();
                var jsonDoc = JsonDocument.Parse(content);
                var data = jsonDoc.RootElement.GetProperty("data");

                // Extract serializable data from API response
                return new NumberLookupResponse
                {
                    PhoneNumber = phoneNumber,
                    CountryCode = data.TryGetProperty("country_code", out var cc) 
                        ? cc.GetString() : "Unknown",
                    Carrier = data.TryGetProperty("carrier_name", out var cn) 
                        ? cn.GetString() : "Unknown",
                    LineType = data.TryGetProperty("line_type", out var lt) 
                        ? lt.GetString() : "Unknown",
                    City = data.TryGetProperty("city", out var city) 
                        ? city.GetString() : "Unknown",
                    State = data.TryGetProperty("state", out var state) 
                        ? state.GetString() : "Unknown",
                    IsValid = data.TryGetProperty("phone_number_valid", out var valid) 
                        ? valid.GetBoolean() : false,
                    LookupId = data.TryGetProperty("id", out var id) 
                        ? id.GetString() : "Unknown"
                };
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Network error: {ex.Message}");
                throw new InvalidOperationException("Network error connecting to Telnyx", ex);
            }
        }
    }
}
```

Create a `Controllers` folder and add `NumberLookupController.cs`:

```csharp
using Microsoft.AspNetCore.Mvc;
using TelnyxNumberLookup.Models;
using TelnyxNumberLookup.Services;

namespace TelnyxNumberLookup.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class NumberLookupController : ControllerBase
    {
        private readonly INumberLookupService _lookupService;
        private readonly ILogger<NumberLookupController> _logger;

        public NumberLookupController(
            INumberLookupService lookupService,
            ILogger<NumberLookupController> logger)
        {
            _lookupService = lookupService;
            _logger = logger;
        }

        [HttpPost("lookup")]
        public async Task<ActionResult<NumberLookupResponse>> LookupNumber(
            [FromBody] LookupRequest request)
        {
            // Validate request body
            if (request == null || string.IsNullOrWhiteSpace(request.PhoneNumber))
            {
                return BadRequest(new ErrorResponse
                {
                    Error = "Missing required field: 'phoneNumber'"
                });
            }

            try
            {
                var result = await _lookupService.LookupPhoneNumberAsync(request.PhoneNumber);
                return Ok(result);
            }
            catch (ArgumentException ex)
            {
                _logger.LogWarning($"Validation error: {ex.Message}");
                return BadRequest(new ErrorResponse { Error = ex.Message });
            }
            catch (UnauthorizedAccessException ex)
            {
                _logger.LogError($"Authentication error: {ex.Message}");
                return Unauthorized(new ErrorResponse
                {
                    Error = "Invalid API key",
                    StatusCode = 401
                });
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("Rate limit"))
            {
                _logger.LogWarning($"Rate limit: {ex.Message}");
                return StatusCode(429, new ErrorResponse
                {
                    Error = ex.Message,
                    StatusCode = 429
                });
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("Network error"))
            {
                _logger.LogError($"Network error: {ex.Message}");
                return StatusCode(503, new ErrorResponse
                {
                    Error = "Network error connecting to Telnyx",
                    StatusCode = 503
                });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Unexpected error: {ex.Message}");
                return StatusCode(500, new ErrorResponse
                {
                    Error = "An unexpected error occurred",
                    StatusCode = 500
                });
            }
        }
    }
}
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/phone-number-lookup-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key", "statusCode": 401}`. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Confirm the `.env` file is in the project root and `Env.Load()` is called in `Program.cs` before the application starts. Restart the development server after updating the key. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. Verify the `phoneNumber` field in your JSON request body matches the expected casing. |
| Rate Limit Error (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down.", "statusCode": 429}`. | The Telnyx API enforces rate limits on number lookup requests. Implement exponential backoff in your client code: wait 1 second, then 2 seconds, then 4 seconds between retries. Consider caching lookup results for frequently queried numbers to reduce API calls. Check your Telnyx account plan for rate limit details in the [Portal](https://portal.telnyx.com). |
| Network Error (503) | The endpoint returns `{"error": "Network error connecting to Telnyx", "statusCode": 503}`. | Verify your internet connection and firewall settings allow outbound HTTPS requests to `api.telnyx.com`. Check the Telnyx API status page for any ongoing incidents. Ensure your `.env` file is properly loaded and the `TELNYX_API_KEY` is set. If the issue persists, restart the development server and try again. |
| HTTPS Certificate Error | curl returns `SSL certificate problem: self signed certificate` when testing locally. | Use the `-k` flag with curl to skip certificate verification in development: `curl -k https://localhost:5001/...`. For production, ensure your ASP.NET application uses a valid SSL certificate. In development, you can also use `http://localhost:5000` if you configure the application to listen on HTTP. |

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

- [Send a Single SMS with C# and ASP.NET](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/csharp/send-single-sms).
- [Receive SMS Webhooks with C# and ASP.NET](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/csharp/receive-sms-webhook).
- [Implement Two-Factor Authentication with C# and ASP.NET](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/csharp/otp-2fa).
