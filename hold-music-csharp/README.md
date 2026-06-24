# Hold Music with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET Core application that places callers on hold with custom music using the Telnyx Voice API. This tutorial demonstrates call control commands, webhook event handling, and proper state management for multi-step call flows. You'll learn to initiate calls, answer them, play hold music, and gracefully handle call lifecycle events.

## Who Is This For?

- **C# developers** building voice features with ASP.NET.
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
- A Telnyx phone number enabled for outbound calls.
- A publicly accessible URL for webhook callbacks (ngrok or similar for local development).
- A valid audio file URL (MP3 or WAV) to use as hold music.
- Basic familiarity with ASP.NET Core and REST APIs.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/hold-music-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create model classes in `Models/CallModels.cs`:

```csharp
using Newtonsoft.Json;

namespace TelnyxHoldMusic.Models
{
    public class InitiateCallRequest
    {
        [JsonProperty("to")]
        public string To { get; set; }
    }

    public class CallResponse
    {
        [JsonProperty("call_control_id")]
        public string CallControlId { get; set; }

        [JsonProperty("status")]
        public string Status { get; set; }
    }

    public class WebhookEvent
    {
        [JsonProperty("data")]
        public WebhookData Data { get; set; }
    }

    public class WebhookData
    {
        [JsonProperty("event_type")]
        public string EventType { get; set; }

        [JsonProperty("call_control_id")]
        public string CallControlId { get; set; }

        [JsonProperty("state")]
        public string State { get; set; }
    }
}
```

Create a service class `Services/TelnyxCallService.cs` to handle API interactions:

```csharp
using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using TelnyxHoldMusic.Models;

namespace TelnyxHoldMusic.Services
{
    public class TelnyxCallService
    {
        private readonly HttpClient _httpClient;
        private readonly string _apiKey;
        private readonly string _phoneNumber;
        private readonly string _connectionId;
        private readonly string _holdMusicUrl;
        private const string BaseUrl = "https://api.telnyx.com/v2";

        public TelnyxCallService(IHttpClientFactory httpClientFactory, IConfiguration config)
        {
            _httpClient = httpClientFactory.CreateClient();
            _apiKey = config["Telnyx:ApiKey"] ?? Environment.GetEnvironmentVariable("TELNYX_API_KEY");
            _phoneNumber = config["Telnyx:PhoneNumber"] ?? Environment.GetEnvironmentVariable("TELNYX_PHONE_NUMBER");
            _connectionId = config["Telnyx:ConnectionId"] ?? Environment.GetEnvironmentVariable("TELNYX_CONNECTION_ID");
            _holdMusicUrl = config["Telnyx:HoldMusicUrl"] ?? Environment.GetEnvironmentVariable("HOLD_MUSIC_URL");

            // Configure default authorization header for all requests
            _httpClient.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", _apiKey);
        }

        public async Task<CallResponse> InitiateCallAsync(string toNumber)
        {
            if (string.IsNullOrEmpty(toNumber))
                throw new ArgumentException("Phone number is required", nameof(toNumber));

            if (!toNumber.StartsWith("+"))
                throw new ArgumentException("Phone number must be in E.164 format (e.g., +15551234567)", nameof(toNumber));

            var payload = new
            {
                from_ = _phoneNumber,
                to = toNumber,
                connection_id = _connectionId,
                webhook_url = Environment.GetEnvironmentVariable("WEBHOOK_URL")
            };

            var content = new StringContent(
                JsonConvert.SerializeObject(payload),
                Encoding.UTF8,
                "application/json"
            );

            var response = await _httpClient.PostAsync($"{BaseUrl}/calls", content);
            response.EnsureSuccessStatusCode();

            var responseBody = await response.Content.ReadAsStringAsync();
            var callData = JsonConvert.DeserializeObject<dynamic>(responseBody);

            return new CallResponse
            {
                CallControlId = callData.data.call_control_id,
                Status = callData.data.state
            };
        }

        public async Task PlayHoldMusicAsync(string callControlId)
        {
            if (string.IsNullOrEmpty(callControlId))
                throw new ArgumentException("Call control ID is required", nameof(callControlId));

            var payload = new
            {
                audio_url = _holdMusicUrl,
                loop = true
            };

            var content = new StringContent(
                JsonConvert.SerializeObject(payload),
                Encoding.UTF8,
                "application/json"
            );

            var response = await _httpClient.PostAsync(
                $"{BaseUrl}/calls/{callControlId}/actions/playback_start",
                content
            );

            response.EnsureSuccessStatusCode();
        }

        public async Task HangupCallAsync(string callControlId)
        {
            if (string.IsNullOrEmpty(callControlId))
                throw new ArgumentException("Call control ID is required", nameof(callControlId));

            var payload = new { };

            var content = new StringContent(
                JsonConvert.SerializeObject(payload),
                Encoding.UTF8,
                "application/json"
            );

            var response = await _httpClient.PostAsync(
                $"{BaseUrl}/calls/{callControlId}/actions/hangup",
                content
            );

            response.EnsureSuccessStatusCode();
        }
    }
}
```

Create the webhook controller `Controllers/WebhooksController.cs`:

```csharp
using Microsoft.AspNetCore.Mvc;
using TelnyxHoldMusic.Models;
using TelnyxHoldMusic.Services;

namespace TelnyxHoldMusic.Controllers
{
    [ApiController]
    [Route("webhooks")]
    public class WebhooksController : ControllerBase
    {
        private readonly TelnyxCallService _callService;
        private readonly ILogger<WebhooksController> _logger;

        public WebhooksController(TelnyxCallService callService, ILogger<WebhooksController> logger)
        {
            _callService = callService;
            _logger = logger;
        }

        [HttpPost("call")]
        public async Task<IActionResult> HandleCallEvent([FromBody] WebhookEvent webhookEvent)
        {
            if (webhookEvent?.Data == null)
                return BadRequest(new { error = "Invalid webhook payload" });

            var eventType = webhookEvent.Data.EventType;
            var callControlId = webhookEvent.Data.CallControlId;

            _logger.LogInformation($"Received event: {eventType} for call: {callControlId}");

            try
            {
                // When call is answered, start playing hold music
                if (eventType == "call.answered")
                {
                    _logger.LogInformation($"Call answered: {callControlId}. Starting hold music.");
                    await _callService.PlayHoldMusicAsync(callControlId);
                }

                // Log call hangup for cleanup
                if (eventType == "call.hangup")
                {
                    _logger.LogInformation($"Call ended: {callControlId}");
                }

                return Ok(new { status = "processed" });
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"API error: {ex.Message}");
                return StatusCode(503, new { error = "Failed to process call event" });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Unexpected error: {ex.Message}");
                return StatusCode(500, new { error = "Internal server error" });
            }
        }
    }
}
```

Create the call control controller `Controllers/CallsController.cs`:

```csharp
using Microsoft.AspNetCore.Mvc;
using TelnyxHoldMusic.Models;
using TelnyxHoldMusic.Services;

namespace TelnyxHoldMusic.Controllers
{
    [ApiController]
    [Route("api/calls")]
    public class CallsController : ControllerBase
    {
        private readonly TelnyxCallService _callService;
        private readonly ILogger<CallsController> _logger;

        public CallsController(TelnyxCallService callService, ILogger<CallsController> logger)
        {
            _callService = callService;
            _logger = logger;
        }

        [HttpPost("initiate")]
        public async Task<IActionResult> InitiateCall([FromBody] InitiateCallRequest request)
        {
            if (request == null || string.IsNullOrEmpty(request.To))
                return BadRequest(new { error = "Missing required field: 'to'" });

            try
            {
                var callResponse = await _callService.InitiateCallAsync(request.To);
                return Ok(new
                {
                    call_control_id = callResponse.CallControlId,
                    status = callResponse.Status
                });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
            catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                _logger.LogError("Authentication failed: Invalid API key");
                return Unauthorized(new { error = "Invalid API key" });
            }
            catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
            {
                _logger.LogWarning("Rate limit exceeded");
                return StatusCode(429, new { error = "Rate limit exceeded. Please slow down." });
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"API error: {ex.Message}");
                return StatusCode((int?)ex.StatusCode ?? 500, new { error = "Failed to initiate call" });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Unexpected error: {ex.Message}");
                return StatusCode(500, new { error = "Internal server error" });
            }
        }

        [HttpPost("{callControlId}/hangup")]
        public async Task<IActionResult> HangupCall(string callControlId)
        {
            if (string.IsNullOrEmpty(callControlId))
                return BadRequest(new { error = "Call control ID is required" });

            try
            {
                await _callService.HangupCallAsync(callControlId);
                return Ok(new { status = "hangup_initiated" });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"API error: {ex.Message}");
                return StatusCode((int?)ex.StatusCode ?? 500, new { error = "Failed to hangup call" });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Unexpected error: {ex.Message}");
                return StatusCode(500, new { error = "Internal server error" });
            }
        }
    }
}
```

Update `Program.cs` to register services and configure the application:

```csharp
using TelnyxHoldMusic.Services;

var builder = WebApplication.CreateBuilder(args);

// Load environment variables from .env file
var envPath = Path.Combine(Directory.GetCurrentDirectory(), ".env");
if (File.Exists(envPath))
{
    var lines = File.ReadAllLines(envPath);
    foreach (var line in lines)
    {
        if (string.IsNullOrWhiteSpace(line) || line.StartsWith("#"))
            continue;

        var parts = line.Split('=', 2);
        if (parts.Length == 2)
        {
            Environment.SetEnvironmentVariable(parts[0].Trim(), parts[1].Trim());
        }
    }
}

// Add services to the container
builder.Services.AddControllers();
builder.Services.AddHttpClient();
builder.Services.AddScoped<TelnyxCallService>();
builder.Services.AddLogging();

var app = builder.Build();

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

app.Run();
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/hold-music-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the ASP.NET Core application after updating the `.env` file. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Webhook Not Triggering | Hold music does not play when the call is answered; webhook events are not received. | Verify that `WEBHOOK_URL` in your `.env` file is publicly accessible and points to your `/webhooks/call` endpoint. If testing locally, use ngrok to expose your application and update the webhook URL. Ensure your firewall allows inbound HTTPS traffic on port 443. Check application logs for webhook delivery errors. |
| Hold Music Not Playing | Call connects but no audio is heard; playback does not start. | Verify that `HOLD_MUSIC_URL` points to a valid, publicly accessible audio file (MP3 or WAV format). Test the URL in a browser to confirm it returns audio data. Ensure the audio file is at least a few seconds long. Check that the `call.answered` webhook event is being received and logged. |
| Connection ID Not Found | API returns an error about invalid or missing connection ID. | Verify that `TELNYX_CONNECTION_ID` in your `.env` file matches a valid Call Control Application ID from the [Telnyx Portal](https://portal.telnyx.com). Ensure the connection is associated with your Telnyx phone number. Regenerate the connection ID if necessary and update your `.env` file. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this Voice example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What C# version do I need?**

.NET 8.0 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Voice API Overview](https://developers.telnyx.com/docs/voice)
- [Voice API Commands](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-commands-and-resources)
- [AI Assistant Start](https://developers.telnyx.com/docs/voice/programmable-voice/ai-assistant-start)
- [Call Control API Reference](https://developers.telnyx.com/api-reference/call-commands/dial)
- [Telnyx Voice API](https://telnyx.com/products/voice-api)
- [Voice AI Agents](https://telnyx.com/products/voice-ai-agents)

## Related Examples

- [Implement an IVR Menu with C# and ASP.NET](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/csharp/ivr-menu).
- [Record and Store Call Audio with C# and ASP.NET](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/csharp/call-recording).
- [Transfer Calls Between Agents with C# and ASP.NET](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/csharp/call-transfer).
