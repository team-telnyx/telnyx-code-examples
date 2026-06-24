# Whisper Prompt with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET Core application that implements whisper prompts—a feature that plays a message to the call recipient before connecting them to the caller. This tutorial demonstrates how to initiate outbound calls, handle webhook events, and execute call control actions using the Telnyx Voice API with C#. You'll learn to manage call state, play audio prompts, and transfer calls after the whisper message completes.

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

- .NET 6.0 or higher installed on your system.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for outbound calls.
- A Call Control Application configured in the Telnyx Portal with a webhook URL pointing to your ASP.NET application.
- ngrok or similar tool to expose your local ASP.NET server to the internet for webhook testing.
- Basic familiarity with C# and ASP.NET Core.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-whisper-monitoring-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a `Services` folder and add a `CallControlService.cs` class to handle Telnyx API interactions:

```csharp
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace TelnyxWhisperPrompt.Services
{
    public class CallControlService
    {
        private readonly HttpClient _httpClient;
        private readonly string _apiKey;
        private readonly string _fromNumber;
        private readonly string _connectionId;
        private const string BaseUrl = "https://api.telnyx.com/v2";

        public CallControlService(HttpClient httpClient)
        {
            _httpClient = httpClient;
            _apiKey = Environment.GetEnvironmentVariable("TELNYX_API_KEY") 
                ?? throw new InvalidOperationException("TELNYX_API_KEY not set");
            _fromNumber = Environment.GetEnvironmentVariable("TELNYX_PHONE_NUMBER") 
                ?? throw new InvalidOperationException("TELNYX_PHONE_NUMBER not set");
            _connectionId = Environment.GetEnvironmentVariable("TELNYX_CONNECTION_ID") 
                ?? throw new InvalidOperationException("TELNYX_CONNECTION_ID not set");

            // Configure default headers for all requests
            _httpClient.DefaultRequestHeaders.Authorization = 
                new AuthenticationHeaderValue("Bearer", _apiKey);
        }

        /// <summary>
        /// Initiate an outbound call with a whisper prompt.
        /// </summary>
        public async Task<Dictionary<string, object>> InitiateCallAsync(string toNumber)
        {
            if (string.IsNullOrEmpty(toNumber) || !toNumber.StartsWith("+"))
            {
                throw new ArgumentException("Phone number must be in E.164 format (e.g., +15551234567)");
            }

            var payload = new
            {
                from_ = _fromNumber,
                to = toNumber,
                connection_id = _connectionId,
                custom_headers = new[] 
                {
                    new { name = "X-Custom-Header", value = "whisper-prompt" }
                }
            };

            var content = new StringContent(
                JsonSerializer.Serialize(payload),
                Encoding.UTF8,
                "application/json"
            );

            var response = await _httpClient.PostAsync($"{BaseUrl}/calls", content);
            
            if (!response.IsSuccessStatusCode)
            {
                var errorContent = await response.Content.ReadAsStringAsync();
                throw new HttpRequestException(
                    $"Failed to initiate call: {response.StatusCode} - {errorContent}"
                );
            }

            var responseBody = await response.Content.ReadAsStringAsync();
            using var jsonDoc = JsonDocument.Parse(responseBody);
            var root = jsonDoc.RootElement;

            return new Dictionary<string, object>
            {
                { "call_control_id", root.GetProperty("data").GetProperty("call_control_id").GetString() ?? "" },
                { "status", "initiated" }
            };
        }

        /// <summary>
        /// Play a whisper message to the call recipient.
        /// </summary>
        public async Task PlayWhisperAsync(string callControlId, string message)
        {
            var payload = new
            {
                payload = message,
                language = "en-US",
                voice = "female"
            };

            var content = new StringContent(
                JsonSerializer.Serialize(payload),
                Encoding.UTF8,
                "application/json"
            );

            var response = await _httpClient.PostAsync(
                $"{BaseUrl}/calls/{callControlId}/actions/speak",
                content
            );

            if (!response.IsSuccessStatusCode)
            {
                var errorContent = await response.Content.ReadAsStringAsync();
                throw new HttpRequestException(
                    $"Failed to play whisper: {response.StatusCode} - {errorContent}"
                );
            }
        }

        /// <summary>
        /// Transfer the call to the original caller.
        /// </summary>
        public async Task TransferCallAsync(string callControlId, string transferTo)
        {
            var payload = new
            {
                to = transferTo
            };

            var content = new StringContent(
                JsonSerializer.Serialize(payload),
                Encoding.UTF8,
                "application/json"
            );

            var response = await _httpClient.PostAsync(
                $"{BaseUrl}/calls/{callControlId}/actions/transfer",
                content
            );

            if (!response.IsSuccessStatusCode)
            {
                var errorContent = await response.Content.ReadAsStringAsync();
                throw new HttpRequestException(
                    $"Failed to transfer call: {response.StatusCode} - {errorContent}"
                );
            }
        }

        /// <summary>
        /// Hang up a call.
        /// </summary>
        public async Task HangupCallAsync(string callControlId)
        {
            var payload = new { };

            var content = new StringContent(
                JsonSerializer.Serialize(payload),
                Encoding.UTF8,
                "application/json"
            );

            var response = await _httpClient.PostAsync(
                $"{BaseUrl}/calls/{callControlId}/actions/hangup",
                content
            );

            if (!response.IsSuccessStatusCode)
            {
                var errorContent = await response.Content.ReadAsStringAsync();
                throw new HttpRequestException(
                    $"Failed to hangup call: {response.StatusCode} - {errorContent}"
                );
            }
        }
    }
}
```

Create a `Controllers` folder and add a `CallsController.cs` to handle HTTP requests:

```csharp
using Microsoft.AspNetCore.Mvc;
using TelnyxWhisperPrompt.Models;
using TelnyxWhisperPrompt.Services;

namespace TelnyxWhisperPrompt.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class CallsController : ControllerBase
    {
        private readonly CallControlService _callControlService;
        private readonly ILogger<CallsController> _logger;

        public CallsController(CallControlService callControlService, ILogger<CallsController> logger)
        {
            _callControlService = callControlService;
            _logger = logger;
        }

        /// <summary>
        /// Initiate an outbound call with a whisper prompt.
        /// POST /api/calls/initiate
        /// </summary>
        [HttpPost("initiate")]
        public async Task<IActionResult> InitiateCall([FromBody] CallInitiateRequest request)
        {
            if (request == null || string.IsNullOrEmpty(request.To))
            {
                return BadRequest(new { error = "Missing required field: 'to'" });
            }

            if (string.IsNullOrEmpty(request.WhisperMessage))
            {
                return BadRequest(new { error = "Missing required field: 'whisperMessage'" });
            }

            try
            {
                var result = await _callControlService.InitiateCallAsync(request.To);
                
                // Store whisper message and transfer number in session/cache for webhook handling
                // In production, use a database or distributed cache
                HttpContext.Session.SetString(
                    $"whisper_{result["call_control_id"]}", 
                    request.WhisperMessage
                );

                return Ok(new
                {
                    call_control_id = result["call_control_id"],
                    status = result["status"],
                    message = "Call initiated. Whisper prompt will play when recipient answers."
                });
            }
            catch (ArgumentException ex)
            {
                _logger.LogWarning($"Validation error: {ex.Message}");
                return BadRequest(new { error = ex.Message });
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"API error: {ex.Message}");
                return StatusCode(503, new { error = "Failed to initiate call. Please try again." });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Unexpected error: {ex.Message}");
                return StatusCode(500, new { error = "Internal server error" });
            }
        }

        /// <summary>
        /// Webhook endpoint to receive call events from Telnyx.
        /// POST /api/calls/webhook
        /// </summary>
        [HttpPost("webhook")]
        public async Task<IActionResult> HandleWebhook([FromBody] JsonElement payload)
        {
            try
            {
                var eventType = payload.GetProperty("data").GetProperty("event_type").GetString();
                var callControlId = payload.GetProperty("data").GetProperty("call_control_id").GetString();

                _logger.LogInformation($"Received webhook event: {eventType} for call {callControlId}");

                switch (eventType)
                {
                    case "call.answered":
                        await HandleCallAnswered(callControlId);
                        break;

                    case "call.speak.ended":
                        await HandleSpeakEnded(callControlId);
                        break;

                    case "call.hangup":
                        _logger.LogInformation($"Call {callControlId} ended");
                        break;

                    default:
                        _logger.LogInformation($"Unhandled event type: {eventType}");
                        break;
                }

                return Ok(new { status = "received" });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Webhook processing error: {ex.Message}");
                return StatusCode(500, new { error = "Webhook processing failed" });
            }
        }

        /// <summary>
        /// Handle call.answered event: play whisper prompt.
        /// </summary>
        private async Task HandleCallAnswered(string callControlId)
        {
            try
            {
                // In production, retrieve whisper message from database/cache
                var whisperMessage = "Hello, you have an incoming call. Please wait while we connect you.";
                
                await _callControlService.PlayWhisperAsync(callControlId, whisperMessage);
                _logger.LogInformation($"Whisper prompt played for call {callControlId}");
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error playing whisper: {ex.Message}");
            }
        }

        /// <summary>
        /// Handle call.speak.ended event: transfer call to original caller.
        /// </summary>
        private async Task HandleSpeakEnded(string callControlId)
        {
            try
            {
                // In production, retrieve transfer number from database/cache
                var transferTo = Environment.GetEnvironmentVariable("TELNYX_PHONE_NUMBER") 
                    ?? throw new InvalidOperationException("TELNYX_PHONE_NUMBER not set");
                
                await _callControlService.TransferCallAsync(callControlId, transferTo);
                _logger.LogInformation($"Call {callControlId} transferred to {transferTo}");
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error transferring call: {ex.Message}");
            }
        }
    }
}
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-whisper-monitoring-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The API returns a 401 Unauthorized response when initiating a call. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the ASP.NET application after updating the `.env` file. Check that the Bearer token is correctly formatted in the Authorization header. |
| Invalid Phone Number Format | The endpoint returns a 400 error stating "Phone number must be in E.164 format" or the Telnyx API rejects the number. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command and any stored phone numbers to use the correct format. |
| Webhook Not Received | Call events are not triggering the webhook handler, and no logs appear for webhook events. | Verify that your ngrok tunnel is active and the webhook URL in the Telnyx Portal matches your ngrok URL exactly (e.g., `https://your-ngrok-url.ngrok.io/api/calls/webhook`). Ensure your ASP.NET application is running and accessible. Check firewall rules and ensure port 5000 is not blocked. Review application logs for any errors during webhook processing. |
| Connection ID Not Found | The API returns an error about an invalid or missing connection_id. | Verify that `TELNYX_CONNECTION_ID` in your `.env` file matches the Call Control Application ID from the Telnyx Portal. Ensure the Call Control Application is active and has a webhook URL configured. Restart the application after updating the connection ID. |
| Whisper Message Not Playing | The call connects but the whisper prompt does not play to the recipient. | Verify that the `call.answered` webhook event is being received and logged. Check that the `PlayWhisperAsync` method is being called without errors. Ensure the whisper message text is not empty. Review the Telnyx API logs in the Portal for any speak action errors. Test with a shorter message to rule out audio processing issues. |

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

- [Handle Inbound Call Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/csharp/inbound-call-webhook).
- [Record and Store Call Audio](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/csharp/call-recording).
- [Build an Interactive Voice Response Menu](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/csharp/ivr-menu).
