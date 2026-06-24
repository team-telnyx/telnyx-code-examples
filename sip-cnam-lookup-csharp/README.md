# CNAM Lookup with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET endpoint that performs CNAM (Caller ID Name) lookups using the Telnyx REST API. This tutorial demonstrates secure credential management via environment variables, proper HTTP client configuration, and comprehensive error handling for telecom APIs. CNAM lookups retrieve the caller's name associated with a phone number, essential for call screening and caller identification in SIP trunking applications.

## Who Is This For?

- **C# developers** building sip features with ASP.NET.
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
- Visual Studio, Visual Studio Code, or the .NET CLI.
- A phone number in E.164 format to test CNAM lookups (e.g., +15551234567).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-cnam-lookup-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a `CnamController.cs` file to define the HTTP endpoint:

```csharp
using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using TelnyxCnamLookup.Services;

namespace TelnyxCnamLookup.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class CnamController : ControllerBase
    {
        private readonly CnamLookupService _cnamService;

        public CnamController(CnamLookupService cnamService)
        {
            _cnamService = cnamService;
        }

        /// <summary>
        /// Perform a CNAM lookup for a given phone number.
        /// </summary>
        /// <param name="phoneNumber">Phone number in E.164 format (e.g., +15551234567)</param>
        /// <returns>CNAM lookup result with caller name and type</returns>
        [HttpGet("lookup")]
        public async Task<IActionResult> LookupCnam([FromQuery] string phoneNumber)
        {
            if (string.IsNullOrWhiteSpace(phoneNumber))
            {
                return BadRequest(new { error = "Phone number is required" });
            }

            try
            {
                var result = await _cnamService.LookupCnamAsync(phoneNumber);

                // Extract serializable data from response
                return Ok(new
                {
                    phoneNumber = result.Data.PhoneNumber,
                    callerName = result.Data.CallerName,
                    callerNameType = result.Data.CallerNameType
                });
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
                return StatusCode(429, new { error = "Rate limit exceeded. Please slow down." });
            }
            catch (HttpRequestException ex)
            {
                return StatusCode(503, new { error = "Network error connecting to Telnyx" });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { error = $"Unexpected error: {ex.Message}" });
            }
        }
    }
}
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-cnam-lookup-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the ASP.NET development server after updating the `.env` file. Confirm `DotNetEnv.Env.Load()` is called in `Program.cs` before the app builds. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). URL-encode the `+` character as `%2B` in query strings. Update your test curl command to use properly formatted numbers. |
| Environment Variable Not Set | The application throws `InvalidOperationException: TELNYX_API_KEY environment variable not set` on startup. | Confirm your `.env` file exists in the project root directory and contains the variable. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). Verify `DotNetEnv.Env.Load()` is called at the start of `Program.cs` before services are configured. Restart the development server after creating or modifying the `.env` file. |
| Rate Limit Error (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | Telnyx enforces rate limits on CNAM lookups. Implement exponential backoff in your client code: wait 1 second, then 2 seconds, then 4 seconds between retries. Cache CNAM results for frequently looked-up numbers to reduce API calls. Contact Telnyx support if you consistently hit rate limits for legitimate use cases. |
| Network Error (503) | The endpoint returns `{"error": "Network error connecting to Telnyx"}` with HTTP 503. | Verify your internet connection and firewall rules allow outbound HTTPS traffic to `api.telnyx.com`. Check the Telnyx status page for any ongoing API incidents. Ensure your ASP.NET application has proper DNS resolution configured. Implement retry logic with exponential backoff for transient network failures. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SIP example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What C# version do I need?**

.NET 8.0 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [SIP Trunking Get Started](https://developers.telnyx.com/docs/voice/sip-trunking/get-started)
- [SIP Configuration Guides](https://developers.telnyx.com/docs/voice/sip-trunking/configuration-guides)
- [Telnyx SIP Trunks](https://telnyx.com/products/sip-trunks)
- [SIP Trunking Pricing](https://telnyx.com/pricing/elastic-sip)

## Related Examples

- [Set Up SIP Trunking](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/csharp/sip-trunking-setup).
- [Configure SIP Authentication](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/csharp/sip-authentication).
- [Route Inbound SIP Calls](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/csharp/inbound-sip-routing).
