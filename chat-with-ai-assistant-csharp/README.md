# Chat With AI Assistant with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET Core endpoint that enables real-time chat interactions with a Telnyx AI Assistant. This tutorial demonstrates secure API initialization, proper error handling for AI operations, and JSON serialization patterns for ASP.NET Core controllers. You'll create a conversational interface that sends user messages to an AI Assistant and returns intelligent responses.

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

- .NET 6.0 or higher installed on your system.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- An existing AI Assistant ID (create one via the Telnyx Portal or use the [Create AI Assistant](/tutorials/ai/csharp/create-ai-assistant) tutorial).
- Visual Studio, Visual Studio Code, or another C# IDE.
- curl or Postman for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/chat-with-ai-assistant-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/chat-with-ai-assistant-csharp
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a `Models` folder and add a `ChatRequest.cs` class to represent incoming chat messages:

```csharp
namespace TelnyxAIChat.Models
{
    public class ChatRequest
    {
        public string Message { get; set; }
    }
}
```

Create a `ChatResponse.cs` class to represent the AI Assistant's response:

```csharp
namespace TelnyxAIChat.Models
{
    public class ChatResponse
    {
        public string AssistantId { get; set; }
        public string UserMessage { get; set; }
        public string AssistantMessage { get; set; }
        public string Role { get; set; }
        public DateTime Timestamp { get; set; }
    }
}
```

Create a `Services` folder and add an `AIChatService.cs` class to handle communication with the Telnyx AI Assistant API:

```csharp
using System.Text;
using System.Text.Json;
using TelnyxAIChat.Models;

namespace TelnyxAIChat.Services
{
    public class AIChatService
    {
        private readonly HttpClient _httpClient;
        private readonly string _assistantId;

        public AIChatService(HttpClient httpClient)
        {
            _httpClient = httpClient;
            _assistantId = Environment.GetEnvironmentVariable("TELNYX_AI_ASSISTANT_ID")
                ?? throw new InvalidOperationException("TELNYX_AI_ASSISTANT_ID environment variable not set");
        }

        public async Task<ChatResponse> ChatAsync(string userMessage)
        {
            // Validate input to prevent empty messages
            if (string.IsNullOrWhiteSpace(userMessage))
            {
                throw new ArgumentException("Message cannot be empty", nameof(userMessage));
            }

            // Build the request payload for the Telnyx AI chat endpoint
            var requestPayload = new
            {
                messages = new[]
                {
                    new { role = "user", content = userMessage }
                }
            };

            var jsonContent = new StringContent(
                JsonSerializer.Serialize(requestPayload),
                Encoding.UTF8,
                "application/json"
            );

            try
            {
                // Send POST request to the AI Assistant chat endpoint
                var response = await _httpClient.PostAsync(
                    $"ai_assistants/{_assistantId}/chat",
                    jsonContent
                );

                // Handle HTTP error responses
                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    
                    if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized)
                    {
                        throw new UnauthorizedAccessException("Invalid API key or authentication failed");
                    }
                    
                    if (response.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
                    {
                        throw new InvalidOperationException("Rate limit exceeded. Please try again later.");
                    }
                    
                    throw new HttpRequestException(
                        $"Telnyx API error: {response.StatusCode} - {errorContent}"
                    );
                }

                // Parse the successful response
                var responseContent = await response.Content.ReadAsStringAsync();
                using var jsonDoc = JsonDocument.Parse(responseContent);
                var root = jsonDoc.RootElement;

                // Extract assistant message from the response
                string assistantMessage = "No response received";
                if (root.TryGetProperty("data", out var dataElement) &&
                    dataElement.TryGetProperty("messages", out var messagesElement) &&
                    messagesElement.GetArrayLength() > 0)
                {
                    var lastMessage = messagesElement[messagesElement.GetArrayLength() - 1];
                    if (lastMessage.TryGetProperty("content", out var contentElement))
                    {
                        assistantMessage = contentElement.GetString() ?? assistantMessage;
                    }
                }

                // Return structured response
                return new ChatResponse
                {
                    AssistantId = _assistantId,
                    UserMessage = userMessage,
                    AssistantMessage = assistantMessage,
                    Role = "assistant",
                    Timestamp = DateTime.UtcNow
                };
            }
            catch (HttpRequestException ex)
            {
                // Network or connection errors
                throw new InvalidOperationException("Network error connecting to Telnyx API", ex);
            }
        }
    }
}
```

Create a `Controllers` folder and add an `AIChatController.cs` to expose the chat endpoint:

```csharp
using Microsoft.AspNetCore.Mvc;
using TelnyxAIChat.Models;
using TelnyxAIChat.Services;

namespace TelnyxAIChat.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AIChatController : ControllerBase
    {
        private readonly AIChatService _chatService;
        private readonly ILogger<AIChatController> _logger;

        public AIChatController(AIChatService chatService, ILogger<AIChatController> logger)
        {
            _chatService = chatService;
            _logger = logger;
        }

        [HttpPost("message")]
        public async Task<IActionResult> SendMessage([FromBody] ChatRequest request)
        {
            // Validate request body
            if (request == null || string.IsNullOrWhiteSpace(request.Message))
            {
                return BadRequest(new { error = "Message field is required and cannot be empty" });
            }

            try
            {
                // Call the AI Assistant chat service
                var response = await _chatService.ChatAsync(request.Message);

                // Return serialized response as JSON
                return Ok(new
                {
                    assistantId = response.AssistantId,
                    userMessage = response.UserMessage,
                    assistantMessage = response.AssistantMessage,
                    role = response.Role,
                    timestamp = response.Timestamp
                });
            }
            catch (UnauthorizedAccessException ex)
            {
                _logger.LogError($"Authentication error: {ex.Message}");
                return Unauthorized(new { error = "Invalid API key or authentication failed" });
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("Rate limit"))
            {
                _logger.LogWarning($"Rate limit exceeded: {ex.Message}");
                return StatusCode(429, new { error = "Rate limit exceeded. Please try again later." });
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("Network error"))
            {
                _logger.LogError($"Network error: {ex.Message}");
                return StatusCode(503, new { error = "Network error connecting to Telnyx API" });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"HTTP request error: {ex.Message}");
                return StatusCode(500, new { error = "Error communicating with Telnyx API" });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Unexpected error: {ex.Message}");
                return StatusCode(500, new { error = "An unexpected error occurred" });
            }
        }
    }
}
```

Update `Program.cs` to register the `AIChatService`:

```csharp
builder.Services.AddScoped<AIChatService>();
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/chat-with-ai-assistant-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key or authentication failed"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Confirm the `.env` file is in the project root directory and that `Env.Load()` is called in `Program.cs` before the HttpClient is configured. Restart the application after updating the key. |
| Assistant ID Not Found | The API returns a 404 error or "Assistant not found" message. | Verify that `TELNYX_AI_ASSISTANT_ID` in your `.env` file is correct and matches an existing AI Assistant in your Telnyx account. Check the [Telnyx Portal](https://portal.telnyx.com) to confirm the assistant exists and is enabled. Ensure the ID is copied exactly without extra spaces or characters. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please try again later."}` with HTTP 429. | The Telnyx API has rate limits on chat requests. Implement exponential backoff retry logic in your client code. Wait at least 1-2 seconds between consecutive requests during testing. For production, consider adding a queue or caching layer to manage request volume. Check the Telnyx documentation for current rate limit thresholds. |
| Network Error (503) | The endpoint returns `{"error": "Network error connecting to Telnyx API"}` with HTTP 503. | Verify your internet connection is active and can reach `https://api.telnyx.com`. Check if the Telnyx API service is operational by visiting the [Telnyx Status Page](https://status.telnyx.com). Ensure your firewall or proxy is not blocking outbound HTTPS requests. If using a corporate network, verify that HTTPS traffic to `api.telnyx.com` is allowed. |
| Empty Message Error (400) | The endpoint returns `{"error": "Message field is required and cannot be empty"}` with HTTP 400. | Ensure your request body includes a non-empty `message` field. Example: `{"message": "Hello, assistant!"}`. Verify the JSON is properly formatted and the field name matches exactly (case-sensitive). Test with curl to confirm the request structure. |

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

- [List AI Assistants](/tutorials/ai/csharp/list-ai-assistants).
- [Create an AI Assistant](/tutorials/ai/csharp/create-ai-assistant).
- [Update an AI Assistant](/tutorials/ai/csharp/update-ai-assistant).
