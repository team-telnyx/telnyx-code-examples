# Create AI Assistant with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET endpoint that creates AI assistants using the Telnyx AI Assistants API. This tutorial demonstrates secure credential management via environment variables, proper error handling for telecom APIs, and JSON serialization patterns for ASP.NET Core. You'll create a fully functional assistant with configurable model, instructions, and enabled features.

## Who Is This For?

- **C# developers** building ai features with ASP.NET.
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
- Visual Studio, Visual Studio Code, or the .NET CLI.
- Basic familiarity with ASP.NET Core and HTTP POST requests.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/create-ai-assistant-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/create-ai-assistant-csharp
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a model class to represent the assistant creation request. Add `CreateAssistantRequest.cs`:

```csharp
namespace TelnyxAIAssistant;

public class CreateAssistantRequest
{
    public string Name { get; set; }
    public string Model { get; set; }
    public string Instructions { get; set; }
    public List<string> EnabledFeatures { get; set; } = new();
}
```

Create a response model for the assistant. Add `AssistantResponse.cs`:

```csharp
using System.Text.Json.Serialization;

namespace TelnyxAIAssistant;

public class AssistantResponse
{
    [JsonPropertyName("id")]
    public string Id { get; set; }

    [JsonPropertyName("name")]
    public string Name { get; set; }

    [JsonPropertyName("model")]
    public string Model { get; set; }

    [JsonPropertyName("instructions")]
    public string Instructions { get; set; }

    [JsonPropertyName("enabled_features")]
    public List<string> EnabledFeatures { get; set; }

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; }
}
```

Create a service class to handle API communication. Add `TelnyxAIService.cs`:

```csharp
using System.Text;
using System.Text.Json;

namespace TelnyxAIAssistant;

public class TelnyxAIService
{
    private readonly HttpClient _httpClient;
    private readonly string _apiKey;

    public TelnyxAIService()
    {
        _apiKey = Config.GetApiKey();
        _httpClient = new HttpClient();
        _httpClient.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _apiKey);
    }

    public async Task<AssistantResponse> CreateAssistantAsync(CreateAssistantRequest request)
    {
        // Validate required fields to prevent API errors
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            throw new ArgumentException("Assistant name is required");
        }

        if (string.IsNullOrWhiteSpace(request.Model))
        {
            throw new ArgumentException("Model is required");
        }

        if (string.IsNullOrWhiteSpace(request.Instructions))
        {
            throw new ArgumentException("Instructions are required");
        }

        var payload = new
        {
            name = request.Name,
            model = request.Model,
            instructions = request.Instructions,
            enabled_features = request.EnabledFeatures ?? new List<string>()
        };

        var jsonContent = new StringContent(
            JsonSerializer.Serialize(payload),
            Encoding.UTF8,
            "application/json"
        );

        var response = await _httpClient.PostAsync(
            $"{Config.TelnyxApiBaseUrl}/ai_assistants",
            jsonContent
        );

        var responseBody = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            HandleApiError(response.StatusCode, responseBody);
        }

        // Parse the response — extract data from the API response structure
        var jsonDoc = JsonDocument.Parse(responseBody);
        var dataElement = jsonDoc.RootElement.GetProperty("data");

        var assistant = new AssistantResponse
        {
            Id = dataElement.GetProperty("id").GetString(),
            Name = dataElement.GetProperty("name").GetString(),
            Model = dataElement.GetProperty("model").GetString(),
            Instructions = dataElement.GetProperty("instructions").GetString(),
            CreatedAt = dataElement.GetProperty("created_at").GetString(),
            EnabledFeatures = dataElement.GetProperty("enabled_features")
                .EnumerateArray()
                .Select(e => e.GetString())
                .ToList()
        };

        return assistant;
    }

    private void HandleApiError(System.Net.HttpStatusCode statusCode, string responseBody)
    {
        var errorMessage = "Telnyx API error";

        try
        {
            var jsonDoc = JsonDocument.Parse(responseBody);
            if (jsonDoc.RootElement.TryGetProperty("errors", out var errorsElement))
            {
                var firstError = errorsElement.EnumerateArray().FirstOrDefault();
                if (firstError.ValueKind != JsonValueKind.Undefined)
                {
                    if (firstError.TryGetProperty("detail", out var detailElement))
                    {
                        errorMessage = detailElement.GetString() ?? errorMessage;
                    }
                }
            }
        }
        catch
        {
            // If JSON parsing fails, use the raw response body
            errorMessage = responseBody;
        }

        throw statusCode switch
        {
            System.Net.HttpStatusCode.Unauthorized => new UnauthorizedAccessException("Invalid API key"),
            System.Net.HttpStatusCode.TooManyRequests => new InvalidOperationException("Rate limit exceeded. Please slow down."),
            System.Net.HttpStatusCode.ServiceUnavailable => new InvalidOperationException("Network error connecting to Telnyx"),
            _ => new InvalidOperationException($"API error ({(int)statusCode}): {errorMessage}")
        };
    }
}
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/create-ai-assistant-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes around the key value. If the key was regenerated recently, update your `.env` file and restart the ASP.NET application with `dotnet run`. |
| Missing Required Fields (400) | You receive a 400 error stating "Missing required fields: name, model, instructions". | Ensure your POST request includes all three required fields in the JSON body: `name`, `model`, and `instructions`. The `enabled_features` array is optional but recommended. Verify the JSON is properly formatted with no syntax errors. |
| Environment Variable Not Set | The application throws `InvalidOperationException: TELNYX_API_KEY environment variable not set` on startup or first request. | Confirm your `.env` file exists in the project root directory (same level as `Program.cs`) and contains the line `TELNYX_API_KEY=YOUR_API_KEY_HERE`. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `Program.cs` file must load the `.env` file before the application starts—verify the environment variable loading code runs before `app.Run()`. |
| Network Error (503) | The endpoint returns `{"error": "Network error connecting to Telnyx"}` with HTTP 503. | This indicates a connectivity issue between your application and the Telnyx API. Verify your internet connection is active and that the Telnyx API endpoint `https://api.telnyx.com/v2` is reachable. Check if your firewall or proxy is blocking outbound HTTPS requests. If the issue persists, check the [Telnyx Status Page](https://status.telnyx.com) for any ongoing service incidents. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | You have exceeded the API rate limit. Implement exponential backoff in your client code to retry requests with increasing delays. For production systems, consider caching assistant configurations and reusing existing assistants instead of creating new ones frequently. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this AI example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What C# version do I need?**

.NET 8.0 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [AI Assistants Guide](https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant)
- [Assistants API Reference](https://developers.telnyx.com/api-reference/assistants/create-an-assistant)
- [Telnyx AI Assistants](https://telnyx.com/ai-assistants)
- [Voice AI Agents](https://telnyx.com/products/voice-ai-agents)

## Related Examples

- [List AI Assistants](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/csharp/list-ai-assistants).
- [Get an AI Assistant](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/csharp/get-ai-assistant).
- [Chat with an AI Assistant](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/csharp/chat-with-ai-assistant).
