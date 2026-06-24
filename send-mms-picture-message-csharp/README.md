# MMS Send with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET endpoint that sends MMS messages with media attachments using the Telnyx REST API. This tutorial demonstrates secure credential management via environment variables, proper error handling for telecom APIs, and JSON serialization patterns for ASP.NET Core. Since C# has no official Telnyx SDK, you'll use `HttpClient` with Bearer token authentication to interact with the Telnyx API directly.

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
- A Telnyx phone number enabled for outbound MMS.
- Visual Studio, Visual Studio Code, or the .NET CLI.
- A publicly accessible URL or media file to attach (e.g., image, video, or document).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-mms-picture-message-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-mms-picture-message-csharp
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a new controller file `Controllers/MmsController.cs` to handle MMS sending:

```csharp
using Microsoft.AspNetCore.Mvc;
using System.Text.Json.Serialization;

namespace TelnyxMmsSender.Controllers;

[ApiController]
[Route("api/[controller]")]
public class MmsController : ControllerBase
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<MmsController> _logger;

    public MmsController(IHttpClientFactory httpClientFactory, ILogger<MmsController> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    [HttpPost("send")]
    public async Task<IActionResult> SendMms([FromBody] SendMmsRequest request)
    {
        // Validate request payload
        if (string.IsNullOrWhiteSpace(request.To) || string.IsNullOrWhiteSpace(request.Text))
        {
            return BadRequest(new { error = "Missing required fields: 'to' and 'text'" });
        }

        if (request.MediaUrls == null || request.MediaUrls.Count == 0)
        {
            return BadRequest(new { error = "At least one media URL is required for MMS" });
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
            var result = await SendMmsInternal(fromNumber, request.To, request.Text, request.MediaUrls);
            return Ok(result);
        }
        catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.Unauthorized)
        {
            _logger.LogError("Authentication failed: {Message}", ex.Message);
            return Unauthorized(new { error = "Invalid API key" });
        }
        catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
        {
            _logger.LogWarning("Rate limit exceeded");
            return StatusCode(429, new { error = "Rate limit exceeded. Please slow down." });
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError("API error: {StatusCode} {Message}", ex.StatusCode, ex.Message);
            return StatusCode((int?)ex.StatusCode ?? 500, new { error = "Telnyx API error", details = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError("Unexpected error: {Message}", ex.Message);
            return StatusCode(500, new { error = "Internal server error" });
        }
    }

    private async Task<object> SendMmsInternal(string fromNumber, string toNumber, string text, List<string> mediaUrls)
    {
        var client = _httpClientFactory.CreateClient("TelnyxClient");

        // Build the request payload
        var payload = new
        {
            from_ = fromNumber,
            to = toNumber,
            text = text,
            media_urls = mediaUrls,
            type = "MMS"
        };

        var content = new StringContent(
            System.Text.Json.JsonSerializer.Serialize(payload),
            System.Text.Encoding.UTF8,
            "application/json"
        );

        var response = await client.PostAsync("messages", content);

        if (!response.IsSuccessStatusCode)
        {
            var errorContent = await response.Content.ReadAsStringAsync();
            _logger.LogError("Telnyx API error: {StatusCode} {Content}", response.StatusCode, errorContent);
            throw new HttpRequestException(errorContent, null, response.StatusCode);
        }

        var responseContent = await response.Content.ReadAsStringAsync();
        using var doc = System.Text.Json.JsonDocument.Parse(responseContent);
        var root = doc.RootElement;

        // Extract serializable data from API response
        var messageData = root.GetProperty("data");
        var toArray = messageData.GetProperty("to");
        var status = toArray.EnumerateArray().FirstOrDefault().GetProperty("status").GetString() ?? "unknown";

        return new
        {
            message_id = messageData.GetProperty("id").GetString(),
            status = status,
            from = fromNumber,
            to = toNumber,
            media_count = mediaUrls.Count
        };
    }
}

public class SendMmsRequest
{
    [JsonPropertyName("to")]
    public string To { get; set; } = string.Empty;

    [JsonPropertyName("text")]
    public string Text { get; set; } = string.Empty;

    [JsonPropertyName("media_urls")]
    public List<string> MediaUrls { get; set; } = new();
}
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-mms-picture-message-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the ASP.NET Core application after updating the `.env` file. The `Env.Load()` call in `Program.cs` must execute before the application starts. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your curl request to use properly formatted numbers. |
| Media URL Not Accessible | The API returns a 400 error or the message fails with status "failed" indicating media could not be retrieved. | Verify that all URLs in the `media_urls` array are publicly accessible and return valid media files (JPEG, PNG, GIF, MP4, etc.). Test the URL in a browser to confirm it loads. Ensure the media file size is within Telnyx limits (typically 5 MB per file). |
| Environment Variable Not Set | The application returns `{"error": "Server configuration error"}` or logs "TELNYX_PHONE_NUMBER environment variable not set". | Confirm your `.env` file exists in the project root directory and contains the variable. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `Env.Load()` call in `Program.cs` must execute before `Environment.GetEnvironmentVariable()` is called. Restart the application after creating or modifying the `.env` file. |
| Rate Limit Error (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | Telnyx enforces rate limits on API requests. Implement exponential backoff in your client code or reduce the frequency of requests. For bulk MMS sending, consider spacing requests over time or using a queue-based approach. Check the [Telnyx documentation](https://developers.telnyx.com) for current rate limit thresholds. |

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

- [Send a Single SMS with C# and ASP.NET](/tutorials/sms/csharp/send-single-sms).
- [Receive SMS Webhooks with C# and ASP.NET](/tutorials/sms/csharp/receive-sms-webhook).
- [Send Bulk SMS Messages with C# and ASP.NET](/tutorials/sms/csharp/send-bulk-sms).
