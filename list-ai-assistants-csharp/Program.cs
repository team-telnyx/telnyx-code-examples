// Program.cs
using TelnyxAiAssistants.Services;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Register HttpClient and TelnyxService
builder.Services.AddHttpClient<TelnyxService>();

var app = builder.Build();

// Configure the HTTP request pipeline
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

app.Run();

// Models/AiAssistant.cs
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

    public class ListAssistantsResponse
    {
        public List<AiAssistant> Data { get; set; } = new();
    }
}

// Services/TelnyxService.cs
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

// Controllers/AiAssistantsController.cs
using Microsoft.AspNetCore.Mvc;
using TelnyxAiAssistants.Services;

namespace TelnyxAiAssistants.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AiAssistantsController : ControllerBase
    {
        private readonly TelnyxService _telnyxService;
        private readonly ILogger<AiAssistantsController> _logger;

        public AiAssistantsController(TelnyxService telnyxService, ILogger<AiAssistantsController> logger)
        {
            _telnyxService = telnyxService;
            _logger = logger;
        }

        [HttpGet]
        public async Task<IActionResult> ListAssistants()
        {
            try
            {
                var assistants = await _telnyxService.ListAssistantsAsync();
                
                var result = assistants.Select(a => new
                {
                    id = a.Id,
                    name = a.Name,
                    model = a.Model,
                    instructions = a.Instructions,
                    enabled_features = a.EnabledFeatures,
                    created_at = a.CreatedAt
                }).ToList();

                return Ok(result);
            }
            catch (UnauthorizedAccessException)
            {
                return Unauthorized(new { error = "Invalid API key" });
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("Rate limit"))
            {
                return StatusCode(429, new { error = "Rate limit exceeded. Please slow down." });
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("Network error"))
            {
                return StatusCode(503, new { error = "Network error connecting to Telnyx" });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error while listing assistants");
                return StatusCode(500, new { error = "Internal server error" });
            }
        }
    }
}
