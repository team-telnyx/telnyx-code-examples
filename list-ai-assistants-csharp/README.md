# List AI Assistants with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET Core API endpoint that retrieves and lists AI assistants using the Telnyx REST API. This tutorial demonstrates HTTP client configuration with Bearer token authentication, proper error handling for API responses, and secure credential management via environment variables.

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

- .NET 6.0 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- Visual Studio, VS Code, or any C# IDE.
- Basic familiarity with ASP.NET Core and REST APIs.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/list-ai-assistants-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/list-ai-assistants-csharp
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a data model for AI assistants. Add `Models/AiAssistant.cs`:

```csharp
namespace TelnyxAiAssistants.Models
{
    public class AiAssistant
    {
        public string Id { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string Model { get; set; } = string.Empty;
        public string Instructions { get; set; } = string.Empty;
        public List<string> EnabledFeatures { get; set; } = new();
        public DateTime CreatedAt { get; set; }
    }

    public class TelnyxApiResponse<T>
    {
        public T Data { get; set; } = default(T)!;
        public object? Meta { get; set; }
    }

    public class ListAssistantsResponse
    {
        public List<AiAssistant> Data { get; set; } = new();
    }
}
```

Create a service to handle Telnyx API communication. Add `Services/TelnyxService.cs`:

```csharp
using Newtonsoft.Json;
using TelnyxAiAssistants.Models;
using System.Net.Http.Headers;

namespace TelnyxAiAssistants.Services
{
    public class TelnyxService
    {
        private readonly HttpClient _httpClient;
        private readonly ILogger<TelnyxService> _logger;

        public TelnyxService(HttpClient httpClient, ILogger<TelnyxService> logger, IConfiguration configuration)
        {
            _httpClient = httpClient;
            _logger = logger;

            // Configure base URL and authentication
            var baseUrl = configuration["Telnyx:ApiBaseUrl"];
            _httpClient.BaseAddress = new Uri(baseUrl!);
            
            var apiKey = Environment.GetEnvironmentVariable("TELNYX_API_KEY");
            if (string.IsNullOrEmpty(apiKey))
            {
                throw new InvalidOperationException("TELNYX_API_KEY environment variable is required");
            }

            _httpClient.DefaultRequestHeaders.Authorization = 
                new AuthenticationHeaderValue("Bearer", apiKey);
            _httpClient.DefaultRequestHeaders.Accept.Add(
                new MediaTypeWithQualityHeaderValue("application/json"));
        }

        public async Task<List<AiAssistant>> ListAssistantsAsync()
        {
            try
            {
                var response = await _httpClient.GetAsync("/ai/assistants");
                
                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    _logger.LogError("Telnyx API error: {StatusCode} - {Content}", 
                        response.StatusCode, errorContent);
                    
                    throw response.StatusCode switch
                    {
                        System.Net.HttpStatusCode.Unauthorized => new UnauthorizedAccessException("Invalid API key"),
                        System.Net.HttpStatusCode.TooManyRequests => new InvalidOperationException("Rate limit exceeded"),
                        _ => new HttpRequestException($"API request failed with status {response.StatusCode}")
                    };
                }

                var content = await response.Content.ReadAsStringAsync();
                var apiResponse = JsonConvert.DeserializeObject<ListAssistantsResponse>(content);
                
                return apiResponse?.Data ?? new List<AiAssistant>();
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "Network error while calling Telnyx API");
                throw new InvalidOperationException("Network error connecting to Telnyx", ex);
            }
        }
    }
}
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/list-ai-assistants-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` environment variable matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment variable and restart the application. Check that the environment variable is set in the same terminal session where you run `dotnet run`. |
| Environment Variable Not Set | The application throws `InvalidOperationException: TELNYX_API_KEY environment variable is required` on startup. | Confirm the environment variable is set correctly. On Windows, use `echo %TELNYX_API_KEY%` to verify. On macOS/Linux, use `echo $TELNYX_API_KEY`. The variable must be set before starting the application. Consider adding it to your IDE's run configuration or using a `.env` file with a package like `DotNetEnv`. |
| Empty Response Array | The endpoint returns `[]` even though you have AI assistants in your account. | Verify your API key has the correct permissions to access AI assistants. Check the Telnyx Portal to confirm assistants exist in your account. Enable debug logging by setting `"LogLevel": { "Default": "Debug" }` in `appsettings.json` to see the raw API response. Ensure you're using the correct API base URL (`https://api.telnyx.com/v2`). |

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

- [Get an AI Assistant](/tutorials/ai/csharp/get-ai-assistant).
- [Create an AI Assistant](/tutorials/ai/csharp/create-ai-assistant).
- [Chat with an AI Assistant](/tutorials/ai/csharp/chat-with-ai-assistant).
