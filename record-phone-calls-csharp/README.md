# Call Recording with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET Core application that initiates outbound calls and records them using the Telnyx Voice API. This tutorial demonstrates the HTTP client pattern for C# (since there is no official Telnyx SDK for C#), proper error handling for telecom APIs, webhook integration for recording events, and secure credential management via environment variables.

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
- A Call Control Application configured in the Telnyx Portal with a connection ID.
- A publicly accessible webhook URL (ngrok or similar for local testing).
- Visual Studio, Visual Studio Code, or the .NET CLI.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/record-phone-calls-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to handle Telnyx API calls. Add a new file `TelnyxCallService.cs`:

```csharp
using Newtonsoft.Json;
using System.Text;

namespace TelnyxCallRecorder;

public class TelnyxCallService
{
    private readonly HttpClient _httpClient;
    private readonly TelnyxConfig _config;
    private readonly ILogger<TelnyxCallService> _logger;

    public TelnyxCallService(HttpClient httpClient, TelnyxConfig config, ILogger<TelnyxCallService> logger)
    {
        _httpClient = httpClient;
        _config = config;
        _logger = logger;
        
        // Configure HTTP client with Bearer token authentication
        _httpClient.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue(
                "Bearer", _config.ApiKey);
        _httpClient.BaseAddress = new Uri("https://api.telnyx.com/v2");
    }

    /// <summary>
    /// Initiates an outbound call and starts recording.
    /// </summary>
    public async Task<CallInitiateResponse> InitiateCallWithRecordingAsync(string toNumber)
    {
        // Validate E.164 format to prevent API errors
        if (!toNumber.StartsWith("+"))
            throw new ArgumentException("Phone number must be in E.164 format (e.g., +15551234567)");

        var payload = new
        {
            from_ = _config.PhoneNumber,
            to = toNumber,
            connection_id = _config.ConnectionId,
            record = true,
            record_channels = "both",
            record_format = "wav"
        };

        var content = new StringContent(
            JsonConvert.SerializeObject(payload),
            Encoding.UTF8,
            "application/json");

        try
        {
            var response = await _httpClient.PostAsync("/calls", content);
            var responseBody = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogError($"Telnyx API error: {response.StatusCode} - {responseBody}");
                throw new TelnyxApiException(response.StatusCode, responseBody);
            }

            var result = JsonConvert.DeserializeObject<TelnyxApiResponse<CallData>>(responseBody);
            if (result?.Data == null)
                throw new InvalidOperationException("Invalid response from Telnyx API");

            return new CallInitiateResponse
            {
                CallControlId = result.Data.CallControlId,
                From = result.Data.From,
                To = result.Data.To,
                State = result.Data.State
            };
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError($"Network error: {ex.Message}");
            throw new TelnyxApiException(System.Net.HttpStatusCode.ServiceUnavailable, "Network error connecting to Telnyx");
        }
    }

    /// <summary>
    /// Stops recording for an active call.
    /// </summary>
    public async Task<bool> StopRecordingAsync(string callControlId)
    {
        var payload = new { };
        var content = new StringContent(
            JsonConvert.SerializeObject(payload),
            Encoding.UTF8,
            "application/json");

        try
        {
            var response = await _httpClient.PostAsync($"/calls/{callControlId}/actions/stop_recording", content);
            
            if (!response.IsSuccessStatusCode)
            {
                var responseBody = await response.Content.ReadAsStringAsync();
                _logger.LogError($"Stop recording error: {response.StatusCode} - {responseBody}");
                throw new TelnyxApiException(response.StatusCode, responseBody);
            }

            return true;
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError($"Network error: {ex.Message}");
            throw new TelnyxApiException(System.Net.HttpStatusCode.ServiceUnavailable, "Network error connecting to Telnyx");
        }
    }
}

public class TelnyxApiException : Exception
{
    public System.Net.HttpStatusCode StatusCode { get; }

    public TelnyxApiException(System.Net.HttpStatusCode statusCode, string message)
        : base(message)
    {
        StatusCode = statusCode;
    }
}

public class TelnyxApiResponse<T>
{
    [JsonProperty("data")]
    public T Data { get; set; }
}

public class CallData
{
    [JsonProperty("call_control_id")]
    public string CallControlId { get; set; }

    [JsonProperty("from")]
    public string From { get; set; }

    [JsonProperty("to")]
    public string To { get; set; }

    [JsonProperty("state")]
    public string State { get; set; }
}

public class CallInitiateResponse
{
    public string CallControlId { get; set; }
    public string From { get; set; }
    public string To { get; set; }
    public string State { get; set; }
}
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/record-phone-calls-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the ASP.NET application after updating the `.env` file. The `Env.Load()` call in `Program.cs` must execute before the application starts. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Connection ID Not Found | The API returns a 422 error or indicates the connection ID is invalid. | Verify your `TELNYX_CONNECTION_ID` in the `.env` file matches a valid Call Control Application ID from the [Telnyx Portal](https://portal.telnyx.com). Ensure the connection is linked to your Telnyx phone number. If you recently created the connection, wait a few moments for it to propagate before testing. |
| Webhook Events Not Received | The `/api/call/webhooks/events` endpoint is not receiving call events from Telnyx. | Ensure your webhook URL is publicly accessible and configured correctly in the Telnyx Portal. Use ngrok (`ngrok http 5000`) to expose your local application and update the webhook URL in the Portal to the ngrok URL. Verify that the endpoint path matches exactly: `/api/call/webhooks/events`. Check application logs for incoming requests. |
| Recording Not Starting | Calls complete but no recording is saved. | Verify that `record = true` is set in the call initiation payload. Ensure your Call Control Application has recording enabled in the Telnyx Portal. Check that the call duration is at least a few seconds—very short calls may not generate recordings. Review webhook events for `call.recording.saved` to confirm recording completion. |

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

- [Handle Inbound Call Webhooks with C#](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/csharp/inbound-call-webhook).
- [Transfer Calls with C#](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/csharp/call-transfer).
- [Build an IVR Menu with C#](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/csharp/ivr-menu).
