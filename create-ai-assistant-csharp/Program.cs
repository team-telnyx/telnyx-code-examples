// Program.cs
using System.Text.Json;
using System.Text.Json.Serialization;

var builder = WebApplication.CreateBuilder(args);

// Load .env file
var envPath = Path.Combine(Directory.GetCurrentDirectory(), ".env");
if (File.Exists(envPath))
{
    foreach (var line in File.ReadAllLines(envPath))
    {
        if (string.IsNullOrWhiteSpace(line) || line.StartsWith("#"))
            continue;

        var parts = line.Split('=', 2);
        if (parts.Length == 2)
        {
            Environment.SetEnvironmentVariable(parts[0].Trim(), parts[1].Trim());
        }
    }
}

builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
        options.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    });

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

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

// ============================================================================

// Config.cs
namespace TelnyxAIAssistant;

public static class Config
{
    public static string GetApiKey()
    {
        var apiKey = Environment.GetEnvironmentVariable("TELNYX_API_KEY");
        if (string.IsNullOrEmpty(apiKey))
        {
            throw new InvalidOperationException("TELNYX_API_KEY environment variable not set");
        }
        return apiKey;
    }

    public static string TelnyxApiBaseUrl => "https://api.telnyx.com/v2";
}

// ============================================================================

// CreateAssistantRequest.cs
namespace TelnyxAIAssistant;

public class CreateAssistantRequest
{
    public string Name { get; set; }
    public string Model { get; set; }
    public string Instructions { get; set; }
    public List<string> EnabledFeatures { get; set; } = new();
}

// ============================================================================

// AssistantResponse.cs
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

// ============================================================================

// TelnyxAIService.cs
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

// ============================================================================

// Controllers/AssistantsController.cs
using Microsoft.AspNetCore.Mvc;

namespace TelnyxAIAssistant.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AssistantsController : ControllerBase
{
    private readonly TelnyxAIService _aiService;

    public AssistantsController()
    {
        _aiService = new TelnyxAIService();
    }

    [HttpPost("create")]
    public async Task<IActionResult> CreateAssistant([FromBody] CreateAssistantRequest request)
    {
        // Validate request body
        if (request == null)
        {
            return BadRequest(new { error = "Request body required" });
        }

        if (string.IsNullOrWhiteSpace(request.Name) ||
            string.IsNullOrWhiteSpace(request.Model) ||
            string.IsNullOrWhiteSpace(request.Instructions))
        {
            return BadRequest(new { error = "Missing required fields: name, model, instructions" });
        }

        try
        {
            var assistant = await _aiService.CreateAssistantAsync(request);

            // Return serialized assistant data — NOT the SDK object
            return Ok(new
            {
                id = assistant.Id,
                name = assistant.Name,
                model = assistant.Model,
                instructions = assistant.Instructions,
                enabled_features = assistant.EnabledFeatures,
                created_at = assistant.CreatedAt
            });
        }
        catch (UnauthorizedAccessException)
        {
            return Unauthorized(new { error = "Invalid API key" });
        }
        catch (InvalidOperationException ex) when (ex.Message.Contains("Rate limit"))
        {
            return StatusCode(429, new { error = ex.Message });
        }
        catch (InvalidOperationException ex) when (ex.Message.Contains("Network error"))
        {
            return StatusCode(503, new { error = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }
}
