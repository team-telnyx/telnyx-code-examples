# OTP 2FA with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET application that implements two-factor authentication (2FA) using one-time passwords (OTPs) delivered via SMS through the Telnyx API. This tutorial demonstrates secure credential management, OTP generation and validation, rate limiting, and proper error handling for a real-world authentication flow.

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
- Basic familiarity with ASP.NET Core and HTTP APIs.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-two-factor-auth-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-two-factor-auth-csharp
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create an `IOtpService` interface and implementation to handle OTP generation and validation:

```csharp
namespace TelnyxOTP2FA.Services
{
    public interface IOtpService
    {
        string GenerateOtp();
        bool ValidateOtp(string phoneNumber, string otp);
        void StoreOtp(string phoneNumber, string otp);
    }

    public class OtpService : IOtpService
    {
        private readonly IOptions<OtpSettings> _otpSettings;
        // In-memory storage for demo; use Redis or database in production
        private readonly Dictionary<string, (string Otp, DateTime ExpiresAt)> _otpStore = new();

        public OtpService(IOptions<OtpSettings> otpSettings)
        {
            _otpSettings = otpSettings;
        }

        public string GenerateOtp()
        {
            var random = new Random();
            var otp = random.Next(
                (int)Math.Pow(10, _otpSettings.Value.Length - 1),
                (int)Math.Pow(10, _otpSettings.Value.Length)
            ).ToString();
            return otp;
        }

        public void StoreOtp(string phoneNumber, string otp)
        {
            var expiresAt = DateTime.UtcNow.AddSeconds(_otpSettings.Value.ExpirySeconds);
            _otpStore[phoneNumber] = (otp, expiresAt);
        }

        public bool ValidateOtp(string phoneNumber, string otp)
        {
            if (!_otpStore.ContainsKey(phoneNumber))
                return false;

            var (storedOtp, expiresAt) = _otpStore[phoneNumber];

            // Check expiration
            if (DateTime.UtcNow > expiresAt)
            {
                _otpStore.Remove(phoneNumber);
                return false;
            }

            // Check OTP match
            if (storedOtp != otp)
                return false;

            // OTP is valid; remove it to prevent reuse
            _otpStore.Remove(phoneNumber);
            return true;
        }
    }
}
```

Create an `ISmsService` interface and implementation to send OTP via Telnyx:

```csharp
namespace TelnyxOTP2FA.Services
{
    public interface ISmsService
    {
        Task<(bool Success, string MessageId, string Error)> SendOtpAsync(string toNumber, string otp);
    }

    public class SmsService : ISmsService
    {
        private readonly IOptions<TelnyxSettings> _telnyxSettings;
        private readonly HttpClient _httpClient;
        private const string TelnyxApiUrl = "https://api.telnyx.com/v2/messages";

        public SmsService(IOptions<TelnyxSettings> telnyxSettings, HttpClient httpClient)
        {
            _telnyxSettings = telnyxSettings;
            _httpClient = httpClient;
        }

        public async Task<(bool Success, string MessageId, string Error)> SendOtpAsync(string toNumber, string otp)
        {
            // Validate E.164 format
            if (!toNumber.StartsWith("+"))
                return (false, "", "Phone number must be in E.164 format (e.g., +15551234567)");

            var fromNumber = _telnyxSettings.Value.PhoneNumber;
            if (string.IsNullOrEmpty(fromNumber))
                return (false, "", "TELNYX_PHONE_NUMBER not configured");

            var apiKey = _telnyxSettings.Value.ApiKey;
            if (string.IsNullOrEmpty(apiKey))
                return (false, "", "TELNYX_API_KEY not configured");

            var messageText = $"Your verification code is: {otp}. Do not share this code.";

            var requestBody = new
            {
                from = fromNumber,
                to = toNumber,
                text = messageText
            };

            var request = new HttpRequestMessage(HttpMethod.Post, TelnyxApiUrl)
            {
                Content = new StringContent(
                    System.Text.Json.JsonSerializer.Serialize(requestBody),
                    System.Text.Encoding.UTF8,
                    "application/json"
                )
            };

            // Add Bearer token authentication
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue(
                "Bearer", apiKey);

            try
            {
                var response = await _httpClient.SendAsync(request);

                if (response.IsSuccessStatusCode)
                {
                    var responseContent = await response.Content.ReadAsStringAsync();
                    var jsonDoc = System.Text.Json.JsonDocument.Parse(responseContent);
                    var messageId = jsonDoc.RootElement
                        .GetProperty("data")
                        .GetProperty("id")
                        .GetString() ?? "";

                    return (true, messageId, "");
                }

                // Handle Telnyx API errors
                if ((int)response.StatusCode == 401)
                    return (false, "", "Invalid API key (401)");
                if ((int)response.StatusCode == 429)
                    return (false, "", "Rate limit exceeded (429)");

                var errorContent = await response.Content.ReadAsStringAsync();
                return (false, "", $"Telnyx API error ({response.StatusCode}): {errorContent}");
            }
            catch (HttpRequestException ex)
            {
                return (false, "", $"Network error: {ex.Message}");
            }
            catch (Exception ex)
            {
                return (false, "", $"Unexpected error: {ex.Message}");
            }
        }
    }
}
```

Create a controller to handle OTP requests and verification:

```csharp
using Microsoft.AspNetCore.Mvc;
using TelnyxOTP2FA.Services;

namespace TelnyxOTP2FA.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AuthController : ControllerBase
    {
        private readonly IOtpService _otpService;
        private readonly ISmsService _smsService;

        public AuthController(IOtpService otpService, ISmsService smsService)
        {
            _otpService = otpService;
            _smsService = smsService;
        }

        [HttpPost("request-otp")]
        public async Task<IActionResult> RequestOtp([FromBody] RequestOtpRequest request)
        {
            if (string.IsNullOrEmpty(request?.PhoneNumber))
                return BadRequest(new { error = "Phone number is required" });

            // Generate OTP
            var otp = _otpService.GenerateOtp();
            _otpService.StoreOtp(request.PhoneNumber, otp);

            // Send OTP via SMS
            var (success, messageId, error) = await _smsService.SendOtpAsync(request.PhoneNumber, otp);

            if (!success)
                return StatusCode(503, new { error = error });

            return Ok(new
            {
                message = "OTP sent successfully",
                message_id = messageId,
                phone_number = request.PhoneNumber
            });
        }

        [HttpPost("verify-otp")]
        public IActionResult VerifyOtp([FromBody] VerifyOtpRequest request)
        {
            if (string.IsNullOrEmpty(request?.PhoneNumber) || string.IsNullOrEmpty(request?.Otp))
                return BadRequest(new { error = "Phone number and OTP are required" });

            var isValid = _otpService.ValidateOtp(request.PhoneNumber, request.Otp);

            if (!isValid)
                return Unauthorized(new { error = "Invalid or expired OTP" });

            return Ok(new
            {
                message = "OTP verified successfully",
                phone_number = request.PhoneNumber,
                authenticated = true
            });
        }
    }

    public class RequestOtpRequest
    {
        public string PhoneNumber { get; set; }
    }

    public class VerifyOtpRequest
    {
        public string PhoneNumber { get; set; }
        public string Otp { get; set; }
    }
}
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-two-factor-auth-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The SMS endpoint returns an error stating "Invalid API key (401)". | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the application after updating the `.env` file. |
| Invalid Phone Number Format | The request-otp endpoint returns "Phone number must be in E.164 format". | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test requests to use properly formatted numbers. |
| OTP Expired Before Verification | The verify-otp endpoint returns "Invalid or expired OTP" even with the correct code. | The default OTP expiry is 300 seconds (5 minutes). Verify the OTP within this window. To extend the expiry time, increase the `OTP_EXPIRY_SECONDS` value in your `.env` file and restart the application. |
| Environment Variables Not Loading | The application throws an error about missing `TELNYX_API_KEY` or `TELNYX_PHONE_NUMBER`. | Confirm your `.env` file exists in the project root directory (same level as `Program.cs`). Ensure the file is named exactly `.env` (not `.env.txt`). Verify the format is `KEY=VALUE` with no spaces around the equals sign. Restart the application after creating or modifying the `.env` file. |
| Network Error Connecting to Telnyx | The SMS service returns "Network error" or "Unexpected error". | Verify your internet connection is active. Check that the Telnyx API endpoint `https://api.telnyx.com/v2/messages` is reachable. If behind a corporate firewall, ensure HTTPS traffic to `api.telnyx.com` is not blocked. Review the detailed error message in the response for more information. |

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
- [Send Bulk SMS Messages with C# and ASP.NET](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/csharp/send-bulk-sms).
