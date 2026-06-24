# Call Transfer with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET Core API that transfers active calls using the Telnyx Voice API. This tutorial demonstrates call control operations, webhook event handling, and secure credential management. You'll learn how to initiate calls, listen for webhooks, and transfer calls to a new destination—essential patterns for building IVR systems, call centers, and customer support platforms.

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
- A Call Control Application configured in the Telnyx Portal with a webhook URL.
- ngrok or similar tool to expose your local ASP.NET server for webhook testing.
- curl or Postman for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/transfer-live-phone-calls-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/transfer-live-phone-calls-csharp
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a `Models` folder and add data models for API requests and webhook events:

```csharp
// Models/CallTransferRequest.cs
namespace TelnyxCallTransfer.Models
{
    public class CallTransferRequest
    {
        public string ToNumber { get; set; }
        public string TransferTo { get; set; }
    }
}
```

```csharp
// Models/WebhookEvent.cs
namespace TelnyxCallTransfer.Models
{
    public class WebhookEvent
    {
        public string Data { get; set; }
        public string EventType { get; set; }
    }

    public class CallWebhookData
    {
        public string CallControlId { get; set; }
        public string State { get; set; }
        public string From { get; set; }
        public string To { get; set; }
    }
}
```

Create a `Services` folder with a call management service:

```csharp
// Services/CallService.cs
using System.Net.Http.Json;
using Telnyx;

namespace TelnyxCallTransfer.Services
{
    public class CallService
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly ILogger<CallService> _logger;

        public CallService(IHttpClientFactory httpClientFactory, ILogger<CallService> logger)
        {
            _httpClientFactory = httpClientFactory;
            _logger = logger;
        }

        /// <summary>
        /// Initiate an outbound call.
        /// </summary>
        public async Task<Dictionary<string, object>> InitiateCallAsync(string toNumber)
        {
            var fromNumber = Environment.GetEnvironmentVariable("TELNYX_PHONE_NUMBER");
            var connectionId = Environment.GetEnvironmentVariable("TELNYX_CONNECTION_ID");

            if (string.IsNullOrEmpty(fromNumber) || string.IsNullOrEmpty(connectionId))
            {
                throw new InvalidOperationException("Missing required environment variables");
            }

            // Validate E.164 format
            if (!toNumber.StartsWith("+"))
            {
                throw new ArgumentException("Phone number must be in E.164 format (e.g., +15551234567)");
            }

            var client = _httpClientFactory.CreateClient("Telnyx");

            var payload = new
            {
                from_ = fromNumber,
                to = toNumber,
                connection_id = connectionId,
            };

            try
            {
                var response = await client.PostAsJsonAsync("/calls", payload);
                response.EnsureSuccessStatusCode();

                var content = await response.Content.ReadAsAsync<dynamic>();
                var callControlId = content.data.call_control_id;

                _logger.LogInformation($"Call initiated: {callControlId}");

                return new Dictionary<string, object>
                {
                    { "call_control_id", callControlId },
                    { "from", fromNumber },
                    { "to", toNumber },
                };
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Failed to initiate call: {ex.Message}");
                throw;
            }
        }

        /// <summary>
        /// Transfer an active call to a new destination.
        /// </summary>
        public async Task<Dictionary<string, object>> TransferCallAsync(string callControlId, string transferTo)
        {
            if (string.IsNullOrEmpty(callControlId))
            {
                throw new ArgumentException("Call control ID is required");
            }

            if (!transferTo.StartsWith("+"))
            {
                throw new ArgumentException("Transfer destination must be in E.164 format");
            }

            var client = _httpClientFactory.CreateClient("Telnyx");

            var payload = new
            {
                to = transferTo,
            };

            try
            {
                var response = await client.PostAsJsonAsync(
                    $"/calls/{callControlId}/actions/transfer",
                    payload);
                response.EnsureSuccessStatusCode();

                _logger.LogInformation($"Call transferred: {callControlId} -> {transferTo}");

                return new Dictionary<string, object>
                {
                    { "call_control_id", callControlId },
                    { "transfer_to", transferTo },
                    { "status", "transfer_initiated" },
                };
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Failed to transfer call: {ex.Message}");
                throw;
            }
        }

        /// <summary>
        /// Hang up an active call.
        /// </summary>
        public async Task<Dictionary<string, object>> HangupCallAsync(string callControlId)
        {
            if (string.IsNullOrEmpty(callControlId))
            {
                throw new ArgumentException("Call control ID is required");
            }

            var client = _httpClientFactory.CreateClient("Telnyx");

            try
            {
                var response = await client.PostAsJsonAsync(
                    $"/calls/{callControlId}/actions/hangup",
                    new { });
                response.EnsureSuccessStatusCode();

                _logger.LogInformation($"Call hung up: {callControlId}");

                return new Dictionary<string, object>
                {
                    { "call_control_id", callControlId },
                    { "status", "hangup_initiated" },
                };
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Failed to hangup call: {ex.Message}");
                throw;
            }
        }
    }
}
```

Create a controller to handle call operations and webhooks:

```csharp
// Controllers/CallsController.cs
using Microsoft.AspNetCore.Mvc;
using TelnyxCallTransfer.Models;
using TelnyxCallTransfer.Services;

namespace TelnyxCallTransfer.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class CallsController : ControllerBase
    {
        private readonly CallService _callService;
        private readonly ILogger<CallsController> _logger;

        public CallsController(CallService callService, ILogger<CallsController> logger)
        {
            _callService = callService;
            _logger = logger;
        }

        /// <summary>
        /// Initiate an outbound call.
        /// POST /api/calls/initiate
        /// </summary>
        [HttpPost("initiate")]
        public async Task<IActionResult> InitiateCall([FromBody] CallTransferRequest request)
        {
            if (string.IsNullOrEmpty(request?.ToNumber))
            {
                return BadRequest(new { error = "Missing required field: 'toNumber'" });
            }

            try
            {
                var result = await _callService.InitiateCallAsync(request.ToNumber);
                return Ok(result);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                return StatusCode(500, new { error = ex.Message });
            }
            catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                return Unauthorized(new { error = "Invalid API key" });
            }
            catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
            {
                return StatusCode(429, new { error = "Rate limit exceeded. Please slow down." });
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"API error: {ex.Message}");
                return StatusCode((int?)ex.StatusCode ?? 500, new { error = "Failed to initiate call" });
            }
        }

        /// <summary>
        /// Transfer an active call to a new destination.
        /// POST /api/calls/{callControlId}/transfer
        /// </summary>
        [HttpPost("{callControlId}/transfer")]
        public async Task<IActionResult> TransferCall(string callControlId, [FromBody] CallTransferRequest request)
        {
            if (string.IsNullOrEmpty(request?.TransferTo))
            {
                return BadRequest(new { error = "Missing required field: 'transferTo'" });
            }

            try
            {
                var result = await _callService.TransferCallAsync(callControlId, request.TransferTo);
                return Ok(result);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
            catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                return Unauthorized(new { error = "Invalid API key" });
            }
            catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
            {
                return StatusCode(429, new { error = "Rate limit exceeded. Please slow down." });
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"API error: {ex.Message}");
                return StatusCode((int?)ex.StatusCode ?? 500, new { error = "Failed to transfer call" });
            }
        }

        /// <summary>
        /// Hang up an active call.
        /// POST /api/calls/{callControlId}/hangup
        /// </summary>
        [HttpPost("{callControlId}/hangup")]
        public async Task<IActionResult> HangupCall(string callControlId)
        {
            try
            {
                var result = await _callService.HangupCallAsync(callControlId);
                return Ok(result);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
            catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                return Unauthorized(new { error = "Invalid API key" });
            }
            catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
            {
                return StatusCode(429, new { error = "Rate limit exceeded. Please slow down." });
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"API error: {ex.Message}");
                return StatusCode((int?)ex.StatusCode ?? 500, new { error = "Failed to hangup call" });
            }
        }
    }
}
```

Create a webhook controller to receive call events:

```csharp
// Controllers/WebhooksController.cs
using Microsoft.AspNetCore.Mvc;
using TelnyxCallTransfer.Models;

namespace TelnyxCallTransfer.Controllers
{
    [ApiController]
    [Route("webhooks")]
    public class WebhooksController : ControllerBase
    {
        private readonly ILogger<WebhooksController> _logger;

        public WebhooksController(ILogger<WebhooksController> logger)
        {
            _logger = logger;
        }

        /// <summary>
        /// Receive call control webhook events from Telnyx.
        /// POST /webhooks/call
        /// </summary>
        [HttpPost("call")]
        public IActionResult ReceiveCallEvent([FromBody] dynamic webhookData)
        {
            try
            {
                var eventType = webhookData?.data?.event_type ?? "unknown";
                var callControlId = webhookData?.data?.call_control_id ?? "unknown";
                var state = webhookData?.data?.state ?? "unknown";

                _logger.LogInformation(
                    $"Webhook received - Event: {eventType}, Call ID: {callControlId}, State: {state}");

                // Handle specific call events
                switch (eventType)
                {
                    case "call.initiated":
                        _logger.LogInformation($"Call initiated: {callControlId}");
                        break;
                    case "call.answered":
                        _logger.LogInformation($"Call answered: {callControlId}");
                        break;
                    case "call.hangup":
                        _logger.LogInformation($"Call ended: {callControlId}");
                        break;
                    default:
                        _logger.LogInformation($"Unhandled event type: {eventType}");
                        break;
                }

                // Return 200 OK to acknowledge receipt
                return Ok(new { status = "received" });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error processing webhook: {ex.Message}");
                return StatusCode(500, new { error = "Failed to process webhook" });
            }
        }
    }
}
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/transfer-live-phone-calls-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the ASP.NET Core application after updating the `.env` file. The `Env.Load()` call in `Program.cs` must execute before the HttpClient is configured. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your curl commands and request bodies to use properly formatted numbers. |
| Missing Connection ID | The endpoint returns a 500 error with "Missing required environment variables". | Verify that `TELNYX_CONNECTION_ID` is set in your `.env` file. This is your Call Control Application ID from the Telnyx Portal. Confirm the `.env` file exists in the project root directory and `Env.Load()` is called in `Program.cs` before services are configured. |
| Webhook Not Receiving Events | Call events are not being logged in your application. | Ensure your ngrok tunnel is active and the webhook URL in the Telnyx Portal matches your ngrok URL exactly (e.g., `https://your-ngrok-url.ngrok.io/webhooks/call`). Verify that your ASP.NET Core application is running and accessible at the ngrok URL. Check application logs for any errors processing webhook requests. |
| Call Transfer Fails with 404 | The transfer endpoint returns a 404 error. | Verify that the `call_control_id` from the initiate call response is correct and the call is still active. The call must be in an answered state before transfer is possible. Check that the transfer destination phone number is in valid E.164 format. |

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

- [Inbound Call Webhook with C#](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/csharp/inbound-call-webhook).
- [Call Recording with C#](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/csharp/call-recording).
- [IVR Menu with C#](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/csharp/ivr-menu).
