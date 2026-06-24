// Program.cs
using DotNetEnv;

var builder = WebApplicationBuilder.CreateBuilder(args);

// Load environment variables from .env file
Env.Load();

// Add services to the container
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Register HttpClient for Telnyx API
builder.Services.AddHttpClient("TelnyxClient", client =>
{
    client.BaseAddress = new Uri("https://api.telnyx.com/v2/");
    var apiKey = Environment.GetEnvironmentVariable("TELNYX_API_KEY");
    client.DefaultRequestHeaders.Authorization =
        new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", apiKey);
    client.DefaultRequestHeaders.Add("Accept", "application/json");
});

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

// Controllers/MmsController.cs
using Microsoft.AspNetCore.Mvc;
using System.Text.Json.Serialization;

namespace TelnyxMmsSender.Controllers;

[ApiController]
[Route("api/[controller]")]
public class MmsController : ControllerBase
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<MmsController> _logger;

    public MmsController(IHttpClientFactory httpClientFactory, ILogger<MmsController> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    [HttpPost("send")]
    public async Task<IActionResult> SendMms([FromBody] SendMmsRequest request)
    {
        // Validate request payload
        if (string.IsNullOrWhiteSpace(request.To) || string.IsNullOrWhiteSpace(request.Text))
        {
            return BadRequest(new { error = "Missing required fields: 'to' and 'text'" });
        }

        if (request.MediaUrls == null || request.MediaUrls.Count == 0)
        {
            return BadRequest(new { error = "At least one media URL is required for MMS" });
        }

        // Validate E.164 format
        if (!request.To.StartsWith("+"))
        {
            return BadRequest(new { error = "Phone number must be in E.164 format (e.g., +15551234567)" });
        }

        var fromNumber = Environment.GetEnvironmentVariable("TELNYX_PHONE_NUMBER");
        if (string.IsNullOrWhiteSpace(fromNumber))
        {
            _logger.LogError("TELNYX_PHONE_NUMBER environment variable not set");
            return StatusCode(500, new { error = "Server configuration error" });
        }

        try
        {
            var result = await SendMmsInternal(fromNumber, request.To, request.Text, request.MediaUrls);
            return Ok(result);
        }
        catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.Unauthorized)
        {
            _logger.LogError("Authentication failed: {Message}", ex.Message);
            return Unauthorized(new { error = "Invalid API key" });
        }
        catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
        {
            _logger.LogWarning("Rate limit exceeded");
            return StatusCode(429, new { error = "Rate limit exceeded. Please slow down." });
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError("API error: {StatusCode} {Message}", ex.StatusCode, ex.Message);
            return StatusCode((int?)ex.StatusCode ?? 500, new { error = "Telnyx API error", details = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError("Unexpected error: {Message}", ex.Message);
            return StatusCode(500, new { error = "Internal server error" });
        }
    }

    private async Task<object> SendMmsInternal(string fromNumber, string toNumber, string text, List<string> mediaUrls)
    {
        var client = _httpClientFactory.CreateClient("TelnyxClient");

        // Build the request payload
        var payload = new
        {
            from_ = fromNumber,
            to = toNumber,
            text = text,
            media_urls = mediaUrls,
            type = "MMS"
        };

        var content = new StringContent(
            System.Text.Json.JsonSerializer.Serialize(payload),
            System.Text.Encoding.UTF8,
            "application/json"
        );

        var response = await client.PostAsync("messages", content);

        if (!response.IsSuccessStatusCode)
        {
            var errorContent = await response.Content.ReadAsStringAsync();
            _logger.LogError("Telnyx API error: {StatusCode} {Content}", response.StatusCode, errorContent);
            throw new HttpRequestException(errorContent, null, response.StatusCode);
        }

        var responseContent = await response.Content.ReadAsStringAsync();
        using var doc = System.Text.Json.JsonDocument.Parse(responseContent);
        var root = doc.RootElement;

        // Extract serializable data from API response
        var messageData = root.GetProperty("data");
        var toArray = messageData.GetProperty("to");
        var status = toArray.EnumerateArray().FirstOrDefault().GetProperty("status").GetString() ?? "unknown";

        return new
        {
            message_id = messageData.GetProperty("id").GetString(),
            status = status,
            from = fromNumber,
            to = toNumber,
            media_count = mediaUrls.Count
        };
    }
}

public class SendMmsRequest
{
    [JsonPropertyName("to")]
    public string To { get; set; } = string.Empty;

    [JsonPropertyName("text")]
    public string Text { get; set; } = string.Empty;

    [JsonPropertyName("media_urls")]
    public List<string> MediaUrls { get; set; } = new();
}
