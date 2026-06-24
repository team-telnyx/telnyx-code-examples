# Warm Transfer with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET Core application that implements warm transfer—seamlessly moving an active call from one agent to another while maintaining call quality and context. This tutorial demonstrates the Telnyx Voice API's call control capabilities, proper HTTP client configuration for telecom APIs, and secure credential management via environment variables.

A warm transfer differs from a cold transfer: the transferring agent stays on the line until the receiving agent accepts, ensuring a smooth handoff and reducing dropped calls.

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
- Two Telnyx phone numbers enabled for inbound and outbound calls.
- A Call Control Application configured in the Telnyx Portal with a webhook URL.
- A publicly accessible webhook endpoint (use ngrok for local development).
- Visual Studio, Visual Studio Code, or the .NET CLI.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/warm-transfer-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service interface for call control operations:

```csharp
namespace TelnyxWarmTransfer.Services
{
    public interface ICallControlService
    {
        Task<(string CallControlId, string Error)> InitiateCallAsync(string toNumber);
        Task<(bool Success, string Error)> TransferCallAsync(string callControlId, string transferTo);
        Task<(bool Success, string Error)> HangupCallAsync(string callControlId);
    }
}
```

Implement the call control service with proper error handling:

```csharp
using TelnyxWarmTransfer.Configuration;
using Newtonsoft.Json;

namespace TelnyxWarmTransfer.Services
{
    public class CallControlService : ICallControlService
    {
        private readonly HttpClient _httpClient;
        private readonly TelnyxSettings _settings;
        private readonly ILogger<CallControlService> _logger;

        public CallControlService(
            IHttpClientFactory httpClientFactory,
            TelnyxSettings settings,
            ILogger<CallControlService> logger)
        {
            _httpClient = httpClientFactory.CreateClient("TelnyxClient");
            _settings = settings;
            _logger = logger;
        }

        public async Task<(string CallControlId, string Error)> InitiateCallAsync(string toNumber)
        {
            try
            {
                // Validate E.164 format to prevent API errors
                if (!toNumber.StartsWith("+"))
                {
                    return (null, "Phone number must be in E.164 format (e.g., +15551234567)");
                }

                var payload = new
                {
                    from_ = _settings.PhoneNumber,
                    to = toNumber,
                    connection_id = _settings.ConnectionId,
                };

                var content = new StringContent(
                    JsonConvert.SerializeObject(payload),
                    System.Text.Encoding.UTF8,
                    "application/json");

                var response = await _httpClient.PostAsync("calls", content);

                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    _logger.LogError($"Telnyx API error: {response.StatusCode} - {errorContent}");
                    return (null, $"Failed to initiate call: {response.StatusCode}");
                }

                var responseContent = await response.Content.ReadAsStringAsync();
                dynamic responseData = JsonConvert.DeserializeObject(responseContent);
                string callControlId = responseData.data.call_control_id;

                _logger.LogInformation($"Call initiated with ID: {callControlId}");
                return (callControlId, null);
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Network error: {ex.Message}");
                return (null, "Network error connecting to Telnyx");
            }
            catch (Exception ex)
            {
                _logger.LogError($"Unexpected error: {ex.Message}");
                return (null, ex.Message);
            }
        }

        public async Task<(bool Success, string Error)> TransferCallAsync(string callControlId, string transferTo)
        {
            try
            {
                if (string.IsNullOrEmpty(callControlId))
                {
                    return (false, "Call control ID is required");
                }

                if (!transferTo.StartsWith("+"))
                {
                    return (false, "Transfer number must be in E.164 format");
                }

                var payload = new
                {
                    to = transferTo,
                };

                var content = new StringContent(
                    JsonConvert.SerializeObject(payload),
                    System.Text.Encoding.UTF8,
                    "application/json");

                var response = await _httpClient.PostAsync(
                    $"calls/{callControlId}/actions/transfer",
                    content);

                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    _logger.LogError($"Transfer failed: {response.StatusCode} - {errorContent}");
                    return (false, $"Transfer failed: {response.StatusCode}");
                }

                _logger.LogInformation($"Call {callControlId} transferred to {transferTo}");
                return (true, null);
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Network error during transfer: {ex.Message}");
                return (false, "Network error connecting to Telnyx");
            }
            catch (Exception ex)
            {
                _logger.LogError($"Unexpected error during transfer: {ex.Message}");
                return (false, ex.Message);
            }
        }

        public async Task<(bool Success, string Error)> HangupCallAsync(string callControlId)
        {
            try
            {
                if (string.IsNullOrEmpty(callControlId))
                {
                    return (false, "Call control ID is required");
                }

                var payload = new { };

                var content = new StringContent(
                    JsonConvert.SerializeObject(payload),
                    System.Text.Encoding.UTF8,
                    "application/json");

                var response = await _httpClient.PostAsync(
                    $"calls/{callControlId}/actions/hangup",
                    content);

                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    _logger.LogError($"Hangup failed: {response.StatusCode} - {errorContent}");
                    return (false, $"Hangup failed: {response.StatusCode}");
                }

                _logger.LogInformation($"Call {callControlId} hung up");
                return (true, null);
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Network error during hangup: {ex.Message}");
                return (false, "Network error connecting to Telnyx");
            }
            catch (Exception ex)
            {
                _logger.LogError($"Unexpected error during hangup: {ex.Message}");
                return (false, ex.Message);
            }
        }
    }
}
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/warm-transfer-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Failed to initiate call: Unauthorized"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the ASP.NET Core application after updating the `.env` file. The Bearer token must be correctly formatted in the Authorization header. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl commands and `.env` file to use properly formatted numbers. |
| Connection ID Not Found | The API returns a 422 error indicating the connection ID is invalid or not found. | Verify that `TELNYX_CONNECTION_ID` in your `.env` file matches your Call Control Application ID from the Telnyx Portal. The connection ID links your phone number to the Call Control application. If you recently created a new application, ensure it is fully provisioned before testing. |
| Webhook Not Receiving Events | The webhook endpoint is not receiving call events from Telnyx. | Ensure your webhook URL is publicly accessible (use ngrok for local development: `ngrok http 5001`). Update the Call Control Application webhook URL in the Telnyx Portal to point to your public endpoint (e.g., `https://your-domain.com/api/calls/webhook`). Verify that your firewall and network configuration allow inbound HTTPS traffic on port 443. |
| Transfer Fails with Active Call | The transfer endpoint returns an error even though the call is active. | Ensure the call is in an active state before attempting transfer. The call must be answered before transfer is possible. Verify that the transfer destination number is in E.164 format and is a valid, reachable phone number. Check the application logs for detailed error messages from the Telnyx API. |

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

- [Implement an IVR Menu with C#](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/csharp/ivr-menu).
- [Record Calls with C#](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/csharp/call-recording).
- [Build a Conference Call with C#](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/csharp/conference-call).
