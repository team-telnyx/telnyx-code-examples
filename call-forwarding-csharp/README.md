# Call Forwarding with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET Core application that implements intelligent call forwarding using the Telnyx Voice API. This tutorial demonstrates how to intercept inbound calls via webhooks, route them to alternative numbers based on business logic, and handle call control operations with proper error handling and secure credential management.

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
- A Telnyx phone number configured with a Call Control Application.
- A publicly accessible URL for webhook delivery (ngrok or similar for local development).
- Visual Studio, Visual Studio Code, or the .NET CLI.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-forwarding-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-forwarding-csharp
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service layer to handle call forwarding logic. Add `Services/ICallForwardingService.cs`:

```csharp
namespace TelnyxCallForwarding.Services
{
    public interface ICallForwardingService
    {
        Task<CallForwardingResult> HandleInboundCall(string callControlId, string fromNumber);
        Task<bool> TransferCall(string callControlId, string toNumber);
    }

    public class CallForwardingResult
    {
        public string CallControlId { get; set; }
        public string Status { get; set; }
        public string Message { get; set; }
    }
}
```

Implement the service in `Services/CallForwardingService.cs`:

```csharp
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using TelnyxCallForwarding.Configuration;

namespace TelnyxCallForwarding.Services
{
    public class CallForwardingService : ICallForwardingService
    {
        private readonly TelnyxConfig _config;
        private readonly HttpClient _httpClient;
        private readonly ILogger<CallForwardingService> _logger;

        public CallForwardingService(TelnyxConfig config, ILogger<CallForwardingService> logger)
        {
            _config = config;
            _logger = logger;
            _httpClient = new HttpClient();
            _httpClient.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", _config.ApiKey);
        }

        public async Task<CallForwardingResult> HandleInboundCall(string callControlId, string fromNumber)
        {
            try
            {
                // Validate E.164 format for the forwarding destination
                if (!_config.ForwardToNumber.StartsWith("+"))
                {
                    throw new ArgumentException("Forward-to number must be in E.164 format");
                }

                _logger.LogInformation($"Handling inbound call {callControlId} from {fromNumber}");

                // Answer the call before transferring
                var answerResult = await AnswerCall(callControlId);
                if (!answerResult)
                {
                    return new CallForwardingResult
                    {
                        CallControlId = callControlId,
                        Status = "failed",
                        Message = "Failed to answer call"
                    };
                }

                // Transfer the call to the forwarding destination
                var transferResult = await TransferCall(callControlId, _config.ForwardToNumber);
                if (!transferResult)
                {
                    return new CallForwardingResult
                    {
                        CallControlId = callControlId,
                        Status = "failed",
                        Message = "Failed to transfer call"
                    };
                }

                return new CallForwardingResult
                {
                    CallControlId = callControlId,
                    Status = "transferred",
                    Message = $"Call forwarded to {_config.ForwardToNumber}"
                };
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error handling inbound call: {ex.Message}");
                throw;
            }
        }

        public async Task<bool> TransferCall(string callControlId, string toNumber)
        {
            try
            {
                var url = $"https://api.telnyx.com/v2/calls/{callControlId}/actions/transfer";
                var payload = new
                {
                    to = toNumber
                };

                var content = new StringContent(
                    JsonSerializer.Serialize(payload),
                    Encoding.UTF8,
                    "application/json"
                );

                var response = await _httpClient.PostAsync(url, content);

                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    _logger.LogError($"Transfer failed: {response.StatusCode} - {errorContent}");
                    return false;
                }

                _logger.LogInformation($"Call {callControlId} transferred to {toNumber}");
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error transferring call: {ex.Message}");
                throw;
            }
        }

        private async Task<bool> AnswerCall(string callControlId)
        {
            try
            {
                var url = $"https://api.telnyx.com/v2/calls/{callControlId}/actions/answer";
                var content = new StringContent(
                    JsonSerializer.Serialize(new { }),
                    Encoding.UTF8,
                    "application/json"
                );

                var response = await _httpClient.PostAsync(url, content);

                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    _logger.LogError($"Answer failed: {response.StatusCode} - {errorContent}");
                    return false;
                }

                _logger.LogInformation($"Call {callControlId} answered");
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error answering call: {ex.Message}");
                throw;
            }
        }
    }
}
```

Create the webhook controller to receive call events. Add `Controllers/WebhookController.cs`:

```csharp
using Microsoft.AspNetCore.Mvc;
using System.Text.Json;
using TelnyxCallForwarding.Services;

namespace TelnyxCallForwarding.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class WebhookController : ControllerBase
    {
        private readonly ICallForwardingService _callForwardingService;
        private readonly ILogger<WebhookController> _logger;

        public WebhookController(ICallForwardingService callForwardingService, ILogger<WebhookController> logger)
        {
            _callForwardingService = callForwardingService;
            _logger = logger;
        }

        [HttpPost("call-events")]
        public async Task<IActionResult> HandleCallEvent([FromBody] JsonElement payload)
        {
            try
            {
                // Extract event type and call details from webhook payload
                var eventType = payload.GetProperty("data").GetProperty("event_type").GetString();
                var callControlId = payload.GetProperty("data").GetProperty("call_control_id").GetString();
                var fromNumber = payload.GetProperty("data").GetProperty("from").GetString();

                _logger.LogInformation($"Received webhook event: {eventType} for call {callControlId}");

                // Handle call.initiated event to trigger forwarding
                if (eventType == "call.initiated")
                {
                    var result = await _callForwardingService.HandleInboundCall(callControlId, fromNumber);
                    return Ok(new
                    {
                        call_control_id = result.CallControlId,
                        status = result.Status,
                        message = result.Message
                    });
                }

                // Handle call.hangup to log call completion
                if (eventType == "call.hangup")
                {
                    _logger.LogInformation($"Call {callControlId} ended");
                    return Ok(new { status = "acknowledged" });
                }

                return Ok(new { status = "acknowledged" });
            }
            catch (telnyx.AuthenticationError)
            {
                _logger.LogError("Authentication failed - invalid API key");
                return Unauthorized(new { error = "Invalid API key" });
            }
            catch (telnyx.RateLimitError)
            {
                _logger.LogError("Rate limit exceeded");
                return StatusCode(429, new { error = "Rate limit exceeded" });
            }
            catch (telnyx.APIStatusError ex)
            {
                _logger.LogError($"API error: {ex.Message}");
                return StatusCode(ex.StatusCode ?? 500, new { error = ex.Message });
            }
            catch (telnyx.APIConnectionError)
            {
                _logger.LogError("Network error connecting to Telnyx");
                return StatusCode(503, new { error = "Network error" });
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

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-forwarding-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The webhook returns `{"error": "Invalid API key"}` or API calls fail with 401 status. | Verify your `TELNYX_API_KEY` in user secrets matches the key from the [Telnyx Portal](https://portal.telnyx.com). Run `dotnet user-secrets list` to confirm the value is set. Ensure there are no trailing spaces or special characters. Restart the application after updating secrets. |
| Webhook Not Receiving Events | The webhook endpoint is not being called when inbound calls arrive. | Confirm your Call Control Application webhook URL is correctly configured in the Telnyx Portal and points to your public ngrok URL. Verify the endpoint path matches exactly: `/api/webhook/call-events`. Check application logs for incoming requests. Ensure your firewall and ngrok tunnel are active and accessible. |
| Call Transfer Fails | The transfer action returns a 4xx or 5xx error, and calls are not forwarded. | Verify the `FORWARD_TO_NUMBER` is in valid E.164 format (e.g., `+15559876543`). Ensure the destination number is reachable and not blocked. Check that your Telnyx account has sufficient credits and the connection is active. Review application logs for detailed error messages from the Telnyx API. |
| Missing Configuration Error | Application throws `InvalidOperationException: Missing required Telnyx configuration`. | Ensure all required secrets are set: `TELNYX_API_KEY`, `TELNYX_PHONE_NUMBER`, `TELNYX_CONNECTION_ID`, and `FORWARD_TO_NUMBER`. Run `dotnet user-secrets set "KEY" "VALUE"` for each missing secret. Verify secrets are stored in the correct user secrets store for your project. |
| Call Control ID Not Found | The webhook payload is missing `call_control_id` or other expected fields. | Verify the webhook payload structure matches Telnyx's event schema. Check that your Call Control Application is properly linked to your phone number. Review the Telnyx documentation for the exact payload format of `call.initiated` events. Log the raw payload to debug field names and structure. |

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

- [Handle Inbound Calls with Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/csharp/inbound-call-webhook).
- [Record Calls with C# and ASP.NET](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/csharp/call-recording).
- [Build an IVR Menu with C# and ASP.NET](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/csharp/ivr-menu).
