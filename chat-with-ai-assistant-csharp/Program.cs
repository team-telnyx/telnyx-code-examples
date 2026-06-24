// Program.cs
using DotNetEnv;
using TelnyxAIChat.Services;

var builder = WebApplicationBuilder.CreateBuilder(args);

// Load environment variables from .env file
Env.Load();

// Add services to the container
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Register HttpClient for Telnyx API communication
builder.Services.AddHttpClient("TelnyxClient", client =>
{
    client.BaseAddress = new Uri("https://api.telnyx.com/v2/");
    client.DefaultRequestHeaders.Add("Accept", "application/json");
    
    var apiKey = Environment.GetEnvironmentVariable("TELNYX_API_KEY");
    if (string.IsNullOrEmpty(apiKey))
    {
        throw new InvalidOperationException("TELNYX_API_KEY environment variable not set");
    }
    
    client.DefaultRequestHeaders.Authorization =
        new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", apiKey);
});

// Register the AI chat service
builder.Services.AddScoped<AIChatService>();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

app.Run();

// Models/ChatRequest.cs
namespace TelnyxAIChat.Models
{
    public class ChatRequest
    {
        public string Message { get; set; }
    }
}

// Models/ChatResponse.cs
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

// Services/AIChatService.cs
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

// Controllers/AIChatController.cs
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
