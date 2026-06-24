# Clone AI Assistant with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET endpoint that clones an existing AI Assistant using the Telnyx API. This tutorial demonstrates secure HTTP client initialization with Bearer token authentication, proper error handling for telecom APIs, and JSON serialization patterns for ASP.NET Core. Cloning allows you to duplicate an assistant's configuration, model, instructions, and tools to create variants without manual reconfiguration.

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
- An existing AI Assistant ID to clone (create one first if needed).
- Visual Studio, Visual Studio Code, or the .NET CLI.
- curl or Postman for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/clone-ai-assistant-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to handle assistant cloning logic. Add a new file `AssistantService.cs`:

```csharp
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TelnyxAssistantCloner.Services
{
    public class AssistantService
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly TelnyxConfig _config;

        public AssistantService(IHttpClientFactory httpClientFactory, TelnyxConfig config)
        {
            _httpClientFactory = httpClientFactory;
            _config = config;
        }

        public async Task<AssistantResponse> CloneAssistantAsync(
            string sourceAssistantId, 
            string newName)
        {
            var client = _httpClientFactory.CreateClient("TelnyxClient");

            // Validate input
            if (string.IsNullOrWhiteSpace(sourceAssistantId))
                throw new ArgumentException("Source assistant ID cannot be empty");
            if (string.IsNullOrWhiteSpace(newName))
                throw new ArgumentException("New assistant name cannot be empty");

            try
            {
                // Call Telnyx API to clone the assistant
                var response = await client.PostAsync(
                    $"/ai/assistants/{sourceAssistantId}/clone",
                    new StringContent(
                        JsonSerializer.Serialize(new { name = newName }),
                        System.Text.Encoding.UTF8,
                        "application/json"));

                // Handle HTTP errors
                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    throw new HttpRequestException(
                        $"Telnyx API error: {response.StatusCode} - {errorContent}");
                }

                // Parse and return the cloned assistant
                var content = await response.Content.ReadAsStringAsync();
                var options = new JsonSerializerOptions 
                { 
                    PropertyNameCaseInsensitive = true,
                    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
                };
                var result = JsonSerializer.Deserialize<ApiResponse>(content, options);

                if (result?.Data == null)
                    throw new InvalidOperationException("Invalid response from Telnyx API");

                return result.Data;
            }
            catch (HttpRequestException ex) when (ex.Message.Contains("401"))
            {
                throw new UnauthorizedAccessException("Invalid API key", ex);
            }
            catch (HttpRequestException ex) when (ex.Message.Contains("429"))
            {
                throw new InvalidOperationException("Rate limit exceeded", ex);
            }
            catch (HttpRequestException ex)
            {
                throw new InvalidOperationException($"Network error: {ex.Message}", ex);
            }
        }
    }

    // Response models
    public class ApiResponse
    {
        [JsonPropertyName("data")]
        public AssistantResponse Data { get; set; }
    }

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
}
```

Create a controller to expose the cloning endpoint. Add a new file `AssistantsController.cs`:

```csharp
using Microsoft.AspNetCore.Mvc;
using TelnyxAssistantCloner.Services;

namespace TelnyxAssistantCloner.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AssistantsController : ControllerBase
    {
        private readonly AssistantService _assistantService;
        private readonly ILogger<AssistantsController> _logger;

        public AssistantsController(
            AssistantService assistantService,
            ILogger<AssistantsController> logger)
        {
            _assistantService = assistantService;
            _logger = logger;
        }

        [HttpPost("{assistantId}/clone")]
        public async Task<IActionResult> CloneAssistant(
            string assistantId,
            [FromBody] CloneRequest request)
        {
            // Validate request
            if (string.IsNullOrWhiteSpace(assistantId))
                return BadRequest(new { error = "Assistant ID is required" });

            if (request == null || string.IsNullOrWhiteSpace(request.Name))
                return BadRequest(new { error = "New assistant name is required" });

            try
            {
                var clonedAssistant = await _assistantService.CloneAssistantAsync(
                    assistantId,
                    request.Name);

                // Return serialized response
                return Ok(new
                {
                    id = clonedAssistant.Id,
                    name = clonedAssistant.Name,
                    model = clonedAssistant.Model,
                    instructions = clonedAssistant.Instructions,
                    enabled_features = clonedAssistant.EnabledFeatures,
                    created_at = clonedAssistant.CreatedAt
                });
            }
            catch (ArgumentException ex)
            {
                _logger.LogWarning($"Validation error: {ex.Message}");
                return BadRequest(new { error = ex.Message });
            }
            catch (UnauthorizedAccessException ex)
            {
                _logger.LogError($"Authentication error: {ex.Message}");
                return Unauthorized(new { error = "Invalid API key" });
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("Rate limit"))
            {
                _logger.LogWarning($"Rate limit: {ex.Message}");
                return StatusCode(429, new { error = "Rate limit exceeded. Please slow down." });
            }
            catch (InvalidOperationException ex)
            {
                _logger.LogError($"API error: {ex.Message}");
                return StatusCode(503, new { error = "Network error connecting to Telnyx" });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Unexpected error: {ex.Message}");
                return StatusCode(500, new { error = "Internal server error" });
            }
        }
    }

    public class CloneRequest
    {
        public string Name { get; set; }
    }
}
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/clone-ai-assistant-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the ASP.NET application after updating the `.env` file. The `DotNetEnv.Load()` call in `Program.cs` must execute before the application starts. |
| Assistant Not Found (404) | The API returns a 404 error indicating the source assistant ID does not exist. | Verify the assistant ID is correct by listing your assistants in the Telnyx Portal or via the list assistants endpoint. Ensure the ID is in the correct format (typically a UUID). Check that the assistant belongs to your Telnyx account and has not been deleted. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | The Telnyx API enforces rate limits on clone operations. Implement exponential backoff retry logic in your client code. Wait at least 1 second between consecutive clone requests. For bulk cloning operations, space requests over time or contact Telnyx support for higher rate limits. |
| Invalid Request Body | The endpoint returns `{"error": "New assistant name is required"}` even when the name field is provided. | Ensure the request body is valid JSON with the correct field name: `{"name": "Your Assistant Name"}`. Verify the `Content-Type` header is set to `application/json`. Check that the name string is not empty or null. Use curl with the `-d` flag to send JSON data. |
| Network Error (503) | The endpoint returns `{"error": "Network error connecting to Telnyx"}` with HTTP 503. | Verify your internet connection is active and can reach `https://api.telnyx.com`. Check if the Telnyx API is experiencing downtime by visiting the [Telnyx Status Page](https://status.telnyx.com). Ensure your firewall or proxy does not block outbound HTTPS requests to the Telnyx API. Retry the request after a few seconds. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this AI example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

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
