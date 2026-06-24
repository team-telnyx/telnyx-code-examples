# Text To Speech with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET endpoint that plays text-to-speech (TTS) messages during voice calls using the Telnyx Voice API. This tutorial demonstrates how to initiate outbound calls, speak text to the recipient, and handle call lifecycle events via webhooks. You'll learn the command-event model that powers Telnyx Call Control, secure credential management, and proper error handling for telecom APIs.

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
- A Call Control Application configured in the Telnyx Portal with its Connection ID.
- A publicly accessible URL for receiving webhooks (ngrok or similar for local development).
- Visual Studio, Visual Studio Code, or the .NET CLI.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/text-to-speech-phone-call-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/text-to-speech-phone-call-csharp
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a `Models` folder and add a `CallRequest.cs` class to define the incoming request structure:

```csharp
namespace TelnyxTTS.Models
{
    public class CallRequest
    {
        public string To { get; set; }
        public string Message { get; set; }
    }

    public class CallResponse
    {
        public string CallControlId { get; set; }
        public string Status { get; set; }
        public string From { get; set; }
        public string To { get; set; }
    }

    public class WebhookEvent
    {
        public string Data { get; set; }
        public string EventType { get; set; }
    }
}
```

Create a `Services` folder and add `CallService.cs` to handle Telnyx API interactions:

```csharp
using System.Text;
using System.Text.Json;
using TelnyxTTS.Models;

namespace TelnyxTTS.Services
{
    public class CallService
    {
        private readonly HttpClient _httpClient;
        private readonly ILogger<CallService> _logger;

        public CallService(IHttpClientFactory httpClientFactory, ILogger<CallService> logger)
        {
            _httpClient = httpClientFactory.CreateClient("TelnyxClient");
            _logger = logger;
        }

        public async Task<CallResponse> InitiateCallAsync(string toNumber, string message)
        {
            var fromNumber = Environment.GetEnvironmentVariable("TELNYX_PHONE_NUMBER");
            var connectionId = Environment.GetEnvironmentVariable("TELNYX_CONNECTION_ID");

            if (string.IsNullOrEmpty(fromNumber))
                throw new InvalidOperationException("TELNYX_PHONE_NUMBER environment variable not set");

            if (string.IsNullOrEmpty(connectionId))
                throw new InvalidOperationException("TELNYX_CONNECTION_ID environment variable not set");

            // Validate E.164 format to prevent API errors
            if (!toNumber.StartsWith("+"))
                throw new ArgumentException("Phone number must be in E.164 format (e.g., +15551234567)");

            var payload = new
            {
                from_ = fromNumber,
                to = toNumber,
                connection_id = connectionId,
                // Store the message in custom headers for later retrieval in webhook
                custom_headers = new[] { new { name = "X-TTS-Message", value = message } }
            };

            var content = new StringContent(
                JsonSerializer.Serialize(payload),
                Encoding.UTF8,
                "application/json");

            try
            {
                var response = await _httpClient.PostAsync("calls", content);
                response.EnsureSuccessStatusCode();

                var responseBody = await response.Content.ReadAsStringAsync();
                using var jsonDoc = JsonDocument.Parse(responseBody);
                var root = jsonDoc.RootElement;

                var callControlId = root.GetProperty("data")
                    .GetProperty("call_control_id").GetString();

                return new CallResponse
                {
                    CallControlId = callControlId,
                    Status = "initiated",
                    From = fromNumber,
                    To = toNumber
                };
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Failed to initiate call: {ex.Message}");
                throw;
            }
        }

        public async Task<bool> SpeakAsync(string callControlId, string text)
        {
            var payload = new
            {
                payload = text,
                language = "en-US",
                voice = "female"
            };

            var content = new StringContent(
                JsonSerializer.Serialize(payload),
                Encoding.UTF8,
                "application/json");

            try
            {
                var response = await _httpClient.PostAsync(
                    $"calls/{callControlId}/actions/speak",
                    content);

                return response.IsSuccessStatusCode;
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Failed to speak on call {callControlId}: {ex.Message}");
                throw;
            }
        }

        public async Task<bool> HangupAsync(string callControlId)
        {
            try
            {
                var response = await _httpClient.PostAsync(
                    $"calls/{callControlId}/actions/hangup",
                    new StringContent("", Encoding.UTF8, "application/json"));

                return response.IsSuccessStatusCode;
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Failed to hangup call {callControlId}: {ex.Message}");
                throw;
            }
        }
    }
}
```

Create a `Controllers` folder and add `CallController.cs` with endpoints for initiating calls and handling webhooks:

```csharp
using Microsoft.AspNetCore.Mvc;
using System.Text.Json;
using TelnyxTTS.Models;
using TelnyxTTS.Services;

namespace TelnyxTTS.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class CallController : ControllerBase
    {
        private readonly CallService _callService;
        private readonly ILogger<CallController> _logger;

        public CallController(CallService callService, ILogger<CallController> logger)
        {
            _callService = callService;
            _logger = logger;
        }

        [HttpPost("initiate")]
        public async Task<IActionResult> InitiateCall([FromBody] CallRequest request)
        {
            if (request == null || string.IsNullOrEmpty(request.To) || string.IsNullOrEmpty(request.Message))
            {
                return BadRequest(new { error = "Missing required fields: 'to' and 'message'" });
            }

            try
            {
                var result = await _callService.InitiateCallAsync(request.To, request.Message);
                return Ok(new
                {
                    call_control_id = result.CallControlId,
                    status = result.Status,
                    from = result.From,
                    to = result.To
                });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                return StatusCode(500, new { error = ex.Message });
            }
            catch (HttpRequestException ex) when (ex.InnerException is System.Net.Http.HttpRequestException)
            {
                // Handle authentication errors (401)
                if (ex.Message.Contains("401"))
                    return Unauthorized(new { error = "Invalid API key" });

                // Handle rate limiting (429)
                if (ex.Message.Contains("429"))
                    return StatusCode(429, new { error = "Rate limit exceeded. Please slow down." });

                // Handle other HTTP errors
                return StatusCode(503, new { error = "Network error connecting to Telnyx" });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Unexpected error: {ex.Message}");
                return StatusCode(500, new { error = "Internal server error" });
            }
        }

        [HttpPost("webhooks/call")]
        public async Task<IActionResult> HandleCallWebhook([FromBody] JsonElement payload)
        {
            try
            {
                var eventType = payload.GetProperty("data")
                    .GetProperty("event_type").GetString();

                var callControlId = payload.GetProperty("data")
                    .GetProperty("call_control_id").GetString();

                _logger.LogInformation($"Received webhook: {eventType} for call {callControlId}");

                // Handle call.answered event — speak the TTS message
                if (eventType == "call.answered")
                {
                    // In production, retrieve the message from your database using callControlId
                    // For this example, we'll use a default message
                    var message = "Hello! This is a text to speech message from Telnyx.";
                    await _callService.SpeakAsync(callControlId, message);
                }

                // Handle call.hangup event — clean up resources
                if (eventType == "call.hangup")
                {
                    _logger.LogInformation($"Call {callControlId} ended");
                }

                return Ok(new { status = "received" });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Webhook processing error: {ex.Message}");
                return StatusCode(500, new { error = "Webhook processing failed" });
            }
        }
    }
}
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/text-to-speech-phone-call-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the ASP.NET application after updating the `.env` file. The `Env.Load()` call in `Program.cs` must execute before the HttpClient is configured. |
| Connection ID Not Found | The API returns an error about an invalid or missing connection ID. | Confirm your `TELNYX_CONNECTION_ID` is set in the `.env` file and matches a Call Control Application configured in the Telnyx Portal. The Connection ID links your phone number to your Call Control application. Verify the application is active and has the correct webhook URL configured. |
| Webhook Not Received | The `/api/call/webhooks/call` endpoint is never called when a call is answered. | Ensure your webhook URL is publicly accessible and configured in the Telnyx Portal under your Call Control Application settings. Use ngrok or a similar tool to expose your local development server. Verify the webhook URL in the Portal matches your actual endpoint (e.g., `https://your-domain.com/api/call/webhooks/call`). Check your application logs for any errors during webhook processing. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format". | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| TTS Audio Not Playing | The call connects but no audio is heard. | Verify the `call.answered` webhook event is being received by checking your application logs. Ensure the `SpeakAsync` method is being called with valid text. Check that the voice and language parameters are supported (default is `female` voice with `en-US` language). The call must remain active long enough for the TTS to complete—add a delay or wait for the `call.speak.ended` webhook event before hanging up. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this Voice example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

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

- [Handle Inbound Call Webhooks with C#](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/csharp/inbound-call-webhook).
- [Record Voice Calls with C#](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/csharp/call-recording).
- [Build an IVR Menu with C#](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/csharp/ivr-menu).
