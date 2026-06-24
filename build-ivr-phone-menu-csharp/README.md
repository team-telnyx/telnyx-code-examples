# Ivr Menu with C# and ASP.NET

## What Does This Example Do?

Build a production-ready Interactive Voice Response (IVR) system using C# and ASP.NET that handles inbound calls, collects DTMF input, and routes callers based on their selections. This tutorial demonstrates the Telnyx Voice API's command-event model, webhook handling for call lifecycle events, DTMF collection, and call control actions like transfers and hangups.

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
- A Call Control Application configured in the Telnyx Portal with a webhook URL pointing to your server.
- ngrok or similar tool to expose your local server to the internet for webhook testing.
- Visual Studio, Visual Studio Code, or the .NET CLI.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-ivr-phone-menu-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-ivr-phone-menu-csharp
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to encapsulate Telnyx API interactions:

```csharp
using System.Net.Http.Headers;
using Microsoft.Extensions.Options;
using TelnyxIvrMenu.Configuration;

namespace TelnyxIvrMenu.Services
{
    public class TelnyxCallService
    {
        private readonly HttpClient _httpClient;
        private readonly TelnyxSettings _settings;
        private readonly ILogger<TelnyxCallService> _logger;

        public TelnyxCallService(
            HttpClient httpClient,
            IOptions<TelnyxSettings> settings,
            ILogger<TelnyxCallService> logger)
        {
            _httpClient = httpClient;
            _settings = settings.Value;
            _logger = logger;

            // Configure HTTP client with Bearer token authentication
            _httpClient.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", _settings.ApiKey);
            _httpClient.BaseAddress = new Uri("https://api.telnyx.com/v2");
        }

        /// <summary>
        /// Answer an inbound call and play initial IVR prompt.
        /// </summary>
        public async Task<bool> AnswerCallAsync(string callControlId)
        {
            try
            {
                var payload = new
                {
                    command_id = Guid.NewGuid().ToString()
                };

                var content = new StringContent(
                    System.Text.Json.JsonSerializer.Serialize(payload),
                    System.Text.Encoding.UTF8,
                    "application/json");

                var response = await _httpClient.PostAsync(
                    $"/calls/{callControlId}/actions/answer",
                    content);

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogError($"Failed to answer call: {response.StatusCode}");
                    return false;
                }

                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error answering call: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Play audio prompt and collect DTMF input.
        /// </summary>
        public async Task<bool> PlayPromptAsync(string callControlId, string prompt)
        {
            try
            {
                var payload = new
                {
                    payload = prompt,
                    voice = "female",
                    language = "en-US",
                    command_id = Guid.NewGuid().ToString()
                };

                var content = new StringContent(
                    System.Text.Json.JsonSerializer.Serialize(payload),
                    System.Text.Encoding.UTF8,
                    "application/json");

                var response = await _httpClient.PostAsync(
                    $"/calls/{callControlId}/actions/speak",
                    content);

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogError($"Failed to play prompt: {response.StatusCode}");
                    return false;
                }

                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error playing prompt: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Start gathering DTMF input from the caller.
        /// </summary>
        public async Task<bool> StartGatheringAsync(string callControlId, int maxDigits = 1)
        {
            try
            {
                var payload = new
                {
                    max_digits = maxDigits,
                    timeout_millis = 5000,
                    command_id = Guid.NewGuid().ToString()
                };

                var content = new StringContent(
                    System.Text.Json.JsonSerializer.Serialize(payload),
                    System.Text.Encoding.UTF8,
                    "application/json");

                var response = await _httpClient.PostAsync(
                    $"/calls/{callControlId}/actions/gather_using_audio",
                    content);

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogError($"Failed to start gathering: {response.StatusCode}");
                    return false;
                }

                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error starting gather: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Transfer call to a destination number.
        /// </summary>
        public async Task<bool> TransferCallAsync(string callControlId, string toNumber)
        {
            try
            {
                var payload = new
                {
                    to = toNumber,
                    from_ = _settings.PhoneNumber,
                    command_id = Guid.NewGuid().ToString()
                };

                var content = new StringContent(
                    System.Text.Json.JsonSerializer.Serialize(payload),
                    System.Text.Encoding.UTF8,
                    "application/json");

                var response = await _httpClient.PostAsync(
                    $"/calls/{callControlId}/actions/transfer",
                    content);

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogError($"Failed to transfer call: {response.StatusCode}");
                    return false;
                }

                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error transferring call: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Hang up the call.
        /// </summary>
        public async Task<bool> HangupCallAsync(string callControlId)
        {
            try
            {
                var payload = new
                {
                    command_id = Guid.NewGuid().ToString()
                };

                var content = new StringContent(
                    System.Text.Json.JsonSerializer.Serialize(payload),
                    System.Text.Encoding.UTF8,
                    "application/json");

                var response = await _httpClient.PostAsync(
                    $"/calls/{callControlId}/actions/hangup",
                    content);

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogError($"Failed to hangup call: {response.StatusCode}");
                    return false;
                }

                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error hanging up call: {ex.Message}");
                return false;
            }
        }
    }
}
```

Register the service in `Program.cs`:

```csharp
builder.Services.AddHttpClient<TelnyxCallService>();
```

Create a webhook controller to handle Telnyx events:

```csharp
using Microsoft.AspNetCore.Mvc;
using TelnyxIvrMenu.Services;

namespace TelnyxIvrMenu.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class WebhookController : ControllerBase
    {
        private readonly TelnyxCallService _callService;
        private readonly ILogger<WebhookController> _logger;

        public WebhookController(
            TelnyxCallService callService,
            ILogger<WebhookController> logger)
        {
            _callService = callService;
            _logger = logger;
        }

        /// <summary>
        /// Handle incoming Telnyx webhook events.
        /// </summary>
        [HttpPost("events")]
        public async Task<IActionResult> HandleWebhook([FromBody] dynamic webhookData)
        {
            try
            {
                string eventType = webhookData?.data?.event_type;
                string callControlId = webhookData?.data?.call_control_id;

                _logger.LogInformation($"Received event: {eventType} for call: {callControlId}");

                switch (eventType)
                {
                    case "call.initiated":
                        await HandleCallInitiated(callControlId);
                        break;

                    case "call.answered":
                        await HandleCallAnswered(callControlId);
                        break;

                    case "call.dtmf.received":
                        string digit = webhookData?.data?.dtmf_digit;
                        await HandleDtmfReceived(callControlId, digit);
                        break;

                    case "call.hangup":
                        _logger.LogInformation($"Call {callControlId} ended");
                        break;

                    default:
                        _logger.LogWarning($"Unhandled event type: {eventType}");
                        break;
                }

                return Ok(new { success = true });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error processing webhook: {ex.Message}");
                return StatusCode(500, new { error = ex.Message });
            }
        }

        private async Task HandleCallInitiated(string callControlId)
        {
            _logger.LogInformation($"Call initiated: {callControlId}");
            // Answer the call automatically
            await _callService.AnswerCallAsync(callControlId);
        }

        private async Task HandleCallAnswered(string callControlId)
        {
            _logger.LogInformation($"Call answered: {callControlId}");

            // Play initial IVR prompt
            string prompt = "Welcome to our IVR system. Press 1 for Sales, Press 2 for Support, or Press 3 to speak with an operator.";
            await _callService.PlayPromptAsync(callControlId, prompt);

            // Start gathering DTMF input
            await _callService.StartGatheringAsync(callControlId, maxDigits: 1);
        }

        private async Task HandleDtmfReceived(string callControlId, string digit)
        {
            _logger.LogInformation($"DTMF received: {digit} for call: {callControlId}");

            switch (digit)
            {
                case "1":
                    // Transfer to Sales
                    await _callService.PlayPromptAsync(callControlId, "Transferring you to Sales.");
                    await _callService.TransferCallAsync(callControlId, "+15559876543");
                    break;

                case "2":
                    // Transfer to Support
                    await _callService.PlayPromptAsync(callControlId, "Transferring you to Support.");
                    await _callService.TransferCallAsync(callControlId, "+15559876544");
                    break;

                case "3":
                    // Transfer to Operator
                    await _callService.PlayPromptAsync(callControlId, "Transferring you to an operator.");
                    await _callService.TransferCallAsync(callControlId, "+15559876545");
                    break;

                default:
                    // Invalid input, replay menu
                    string prompt = "Invalid selection. Press 1 for Sales, Press 2 for Support, or Press 3 for an operator.";
                    await _callService.PlayPromptAsync(callControlId, prompt);
                    await _callService.StartGatheringAsync(callControlId, maxDigits: 1);
                    break;
            }
        }
    }
}
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-ivr-phone-menu-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not receiving events | The ASP.NET application is running but Telnyx is not sending webhook events. | Verify that your ngrok URL is correctly configured in the Telnyx Portal under your Call Control Application settings. Ensure the webhook URL is exactly `https://<ngrok-url>/api/webhook/events`. Check that your firewall allows inbound HTTPS traffic on port 5000. Restart ngrok and update the Portal URL if the ngrok session expires. |
| Call not answering automatically | Inbound calls ring but are not answered by the IVR system. | Confirm that the `HandleCallInitiated` method is being called by checking application logs. Verify that the `AnswerCallAsync` method returns `true`. Ensure your Telnyx phone number is correctly configured in `appsettings.json` and matches the number assigned to your Call Control Application. |
| DTMF input not recognized | Caller presses digits but the IVR does not respond to the selection. | Verify that `call.dtmf.received` events are being sent by Telnyx (check logs for the event type). Ensure the `StartGatheringAsync` method is called after playing the prompt. Confirm that the `maxDigits` parameter matches the expected input length. Test with a real phone call rather than a test webhook, as some testing tools may not simulate DTMF correctly. |
| Transfer fails silently | The IVR plays the transfer message but the call does not transfer. | Check that the destination phone numbers in the `switch` statement are valid and in E.164 format (e.g., `+15559876543`). Verify that your Telnyx account has outbound calling permissions. Review application logs for HTTP error responses from the transfer API call. Ensure the `from_` parameter in `TransferCallAsync` matches your Telnyx phone number. |
| Authentication error (401) | API calls return 401 Unauthorized responses. | Verify that `TELNYX_API_KEY` in `appsettings.json` is correct and matches the key from the Telnyx Portal. Ensure there are no trailing spaces or special characters in the API key. Confirm that the Bearer token is being set correctly in the `Authorization` header. Regenerate your API key in the Portal if it was recently compromised. |

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

- [Handle Inbound Calls with Webhooks](/tutorials/voice/csharp/inbound-call-webhook).
- [Transfer Calls Between Endpoints](/tutorials/voice/csharp/call-transfer).
- [Record and Store Call Audio](/tutorials/voice/csharp/call-recording).
