# Voicemail with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET Core application that captures voicemail messages using the Telnyx Voice API. This tutorial demonstrates how to initiate inbound calls, record audio, handle webhooks, and retrieve voicemail recordings. You'll learn the command-event model of Call Control, secure credential management via environment variables, and proper error handling for telecom APIs.

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
- A Telnyx phone number enabled for inbound calls.
- A Call Control Application configured in the Telnyx Portal with your webhook URL.
- ngrok or similar tool to expose your local ASP.NET application to the internet for webhook testing.
- Visual Studio, Visual Studio Code, or the .NET CLI.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/voicemail-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a `VoicemailController.cs` to handle voicemail operations and webhooks:

```csharp
using Microsoft.AspNetCore.Mvc;
using TelnyxVoicemail.Services;
using System.Text.Json;

namespace TelnyxVoicemail.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class VoicemailController : ControllerBase
    {
        private readonly VoicemailService _voicemailService;
        private readonly ILogger<VoicemailController> _logger;

        public VoicemailController(ILogger<VoicemailController> logger)
        {
            _logger = logger;
            _voicemailService = new VoicemailService();
        }

        /// <summary>
        /// Initiate an outbound call to capture voicemail.
        /// </summary>
        [HttpPost("initiate")]
        public async Task<IActionResult> InitiateVoicemail([FromBody] InitiateVoicemailRequest request)
        {
            if (string.IsNullOrEmpty(request.ToNumber))
            {
                return BadRequest(new { error = "Missing required field: 'toNumber'" });
            }

            try
            {
                var result = await _voicemailService.InitiateCallAsync(request.ToNumber);
                return Ok(result);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "API error initiating call");
                return StatusCode(503, new { error = "Failed to initiate call" });
            }
        }

        /// <summary>
        /// Webhook endpoint to receive Telnyx call events.
        /// </summary>
        [HttpPost("webhook")]
        public async Task<IActionResult> HandleWebhook([FromBody] JsonElement payload)
        {
            try
            {
                var eventType = payload.GetProperty("data").GetProperty("event_type").GetString();
                var callControlId = payload.GetProperty("data").GetProperty("call_control_id").GetString();

                _logger.LogInformation($"Received event: {eventType} for call: {callControlId}");

                switch (eventType)
                {
                    case "call.initiated":
                        // Call initiated — ready to start recording
                        _logger.LogInformation($"Call initiated: {callControlId}");
                        break;

                    case "call.answered":
                        // Call answered — start recording voicemail
                        _logger.LogInformation($"Call answered: {callControlId}. Starting recording...");
                        await _voicemailService.StartRecordingAsync(callControlId);
                        break;

                    case "call.hangup":
                        // Call ended — stop recording and process voicemail
                        _logger.LogInformation($"Call ended: {callControlId}. Stopping recording...");
                        await _voicemailService.StopRecordingAsync(callControlId);
                        break;

                    case "call.recording.saved":
                        // Recording saved — retrieve and store metadata
                        var recordingUrl = payload.GetProperty("data").GetProperty("recording_urls")
                            .GetProperty("wav").GetString();
                        _logger.LogInformation($"Recording saved for call {callControlId}: {recordingUrl}");
                        // TODO: Store recording metadata in database
                        break;

                    default:
                        _logger.LogWarning($"Unhandled event type: {eventType}");
                        break;
                }

                // Return 200 OK to acknowledge receipt
                return Ok(new { status = "received" });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing webhook");
                return StatusCode(500, new { error = "Webhook processing failed" });
            }
        }

        /// <summary>
        /// Manually stop recording for a call.
        /// </summary>
        [HttpPost("stop-recording/{callControlId}")]
        public async Task<IActionResult> StopRecording(string callControlId)
        {
            if (string.IsNullOrEmpty(callControlId))
            {
                return BadRequest(new { error = "Missing required parameter: callControlId" });
            }

            try
            {
                var result = await _voicemailService.StopRecordingAsync(callControlId);
                return Ok(result);
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "API error stopping recording");
                return StatusCode(503, new { error = "Failed to stop recording" });
            }
        }

        /// <summary>
        /// Hangup a call.
        /// </summary>
        [HttpPost("hangup/{callControlId}")]
        public async Task<IActionResult> HangupCall(string callControlId)
        {
            if (string.IsNullOrEmpty(callControlId))
            {
                return BadRequest(new { error = "Missing required parameter: callControlId" });
            }

            try
            {
                var result = await _voicemailService.HangupCallAsync(callControlId);
                return Ok(result);
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "API error hanging up call");
                return StatusCode(503, new { error = "Failed to hangup call" });
            }
        }
    }

    public class InitiateVoicemailRequest
    {
        public string ToNumber { get; set; }
    }
}
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voicemail-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The API returns `401 Unauthorized` when initiating a call or managing recordings. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart your ASP.NET application after updating the `.env` file. Check that the Bearer token is correctly formatted in the Authorization header. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test requests to use properly formatted numbers. |
| Webhook Not Receiving Events | Your webhook endpoint is configured but not receiving call events from Telnyx. | Verify that your ngrok URL is correctly configured in the Telnyx Portal Call Control Application settings. Ensure the webhook URL is exactly `https://your-ngrok-url.ngrok.io/api/voicemail/webhook`. Check that your ASP.NET application is running and accessible. Review application logs for any errors during webhook processing. Confirm that your firewall or network allows inbound HTTPS traffic on port 443. |
| Recording Not Starting | The call connects but recording does not start automatically. | Verify that your Call Control Application is properly configured in the Telnyx Portal. Ensure the `call.answered` event is being received in your webhook handler. Check application logs to confirm `StartRecordingAsync` is being called. Verify that your Telnyx account has recording enabled and sufficient quota. |
| Connection ID Not Set | The application throws `InvalidOperationException: TELNYX_CONNECTION_ID not set`. | Confirm your `.env` file exists in the project root and contains the `TELNYX_CONNECTION_ID` variable. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `Env.Load()` call in `Program.cs` must execute before any service tries to read environment variables. Restart your application after updating the `.env` file. |

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

- [Handle Inbound Calls with Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/csharp/inbound-call-webhook).
- [Record and Retrieve Call Recordings](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/csharp/call-recording).
- [Transfer Calls Between Numbers](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/csharp/call-transfer).
