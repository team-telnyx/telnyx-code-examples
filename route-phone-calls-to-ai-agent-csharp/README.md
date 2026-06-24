# Inbound Call Webhook with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET endpoint that receives and processes inbound call webhooks from Telnyx. This tutorial demonstrates how to handle call lifecycle events (initiated, answered, hangup), validate webhook signatures, and respond to call control commands. You'll learn the webhook event model that powers Telnyx Voice API and how to integrate it into a real application.

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
- A Telnyx phone number enabled for inbound calls.
- A publicly accessible URL (ngrok, Cloudflare Tunnel, or deployed server) to receive webhooks.
- Basic familiarity with C# and ASP.NET Core.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/route-phone-calls-to-ai-agent-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/route-phone-calls-to-ai-agent-csharp
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a `CallController.cs` to handle incoming webhook events:

```csharp
using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using TelnyxInboundCall.Models;
using TelnyxInboundCall.Services;

namespace TelnyxInboundCall.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class CallController : ControllerBase
    {
        private readonly CallService _callService;

        public CallController(CallService callService)
        {
            _callService = callService;
        }

        [HttpPost("webhook")]
        public async Task<IActionResult> HandleWebhook([FromBody] WebhookEvent webhookEvent)
        {
            // Validate webhook payload structure
            if (webhookEvent?.Data == null)
            {
                return BadRequest(new { error = "Invalid webhook payload" });
            }

            var callData = webhookEvent.Data;
            var eventType = callData.EventType;

            Console.WriteLine($"Received event: {eventType} for call {callData.CallControlId}");
            Console.WriteLine($"From: {callData.From}, To: {callData.To}");

            try
            {
                // Handle different call lifecycle events
                switch (eventType)
                {
                    case "call.initiated":
                        // Inbound call received — answer automatically
                        await _callService.AnswerCallAsync(callData.CallControlId);
                        await _callService.SpeakAsync(
                            callData.CallControlId,
                            "Thank you for calling. Your call has been connected.");
                        break;

                    case "call.answered":
                        // Call is now active
                        Console.WriteLine("Call answered successfully");
                        break;

                    case "call.hangup":
                        // Call ended — clean up resources
                        Console.WriteLine($"Call ended. State: {callData.State}");
                        break;

                    default:
                        Console.WriteLine($"Unhandled event type: {eventType}");
                        break;
                }

                // Return 200 OK to acknowledge receipt
                return Ok(new { status = "received" });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error processing webhook: {ex.Message}");
                // Return 500 to signal Telnyx to retry
                return StatusCode(500, new { error = "Processing failed" });
            }
        }

        [HttpGet("status")]
        public IActionResult GetStatus()
        {
            return Ok(new { status = "webhook receiver is running" });
        }
    }
}
```

Update `Program.cs` to register the `CallService` and load environment variables:

```csharp
using System;
using TelnyxInboundCall.Services;
using DotNetEnv;

var builder = WebApplication.CreateBuilder(args);

// Load environment variables from .env file
Env.Load();

// Add services to the container
builder.Services.AddControllers();
builder.Services.AddHttpClient<CallService>((serviceProvider, client) =>
{
    var apiKey = Environment.GetEnvironmentVariable("TELNYX_API_KEY");
    if (string.IsNullOrEmpty(apiKey))
    {
        throw new InvalidOperationException("TELNYX_API_KEY environment variable not set");
    }
});

var app = builder.Build();

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

Console.WriteLine("Telnyx Inbound Call Webhook Receiver started");
Console.WriteLine("Listening for webhooks at /api/call/webhook");

app.Run();
```

Add the `DotNetEnv` NuGet package to load `.env` files:

```bash
dotnet add package DotNetEnv
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not received | The endpoint is running but no webhook events arrive after making an inbound call. | Verify the webhook URL in the Telnyx Portal matches your ngrok URL exactly (e.g., `https://abc123.ngrok.io/api/call/webhook`). Ensure ngrok is still running and the tunnel is active. Check that your Call Control Application is linked to the correct phone number. Test connectivity by visiting the status endpoint: `curl https://abc123.ngrok.io/api/call/status`. |
| 401 Unauthorized on call actions | The `AnswerCallAsync` or `SpeakAsync` methods return HTTP 401 errors. | Verify `TELNYX_API_KEY` in your `.env` file is correct and matches the key in the Telnyx Portal. Ensure the `.env` file is in the project root and `Env.Load()` is called in `Program.cs` before the `CallService` is registered. Restart the application after updating the API key. |
| Call not answering automatically | Inbound calls ring but are not answered by the application. | Confirm the `call.initiated` event is being received by checking console output. Verify the `AnswerCallAsync` method completes successfully (check for error messages in the console). Ensure the Call Control Application webhook is configured to POST to your endpoint, not GET. Test the answer action manually using curl with your `call_control_id` from a received webhook. |
| Deserialization errors | The application logs `JsonException` or `NullReferenceException` when processing webhooks. | Verify the webhook payload structure matches the `WebhookEvent` model. Check that JSON property names in the model match the incoming payload exactly (case-sensitive). Log the raw request body to inspect the actual structure: `var body = await request.Body.ReadAsStringAsync();`. Update the model properties if Telnyx API response format differs. |

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

- [Make an Outbound Call with C#](/tutorials/voice/csharp/outbound-call).
- [Record Inbound Calls with C#](/tutorials/voice/csharp/call-recording).
- [Transfer Calls with C#](/tutorials/voice/csharp/call-transfer).
