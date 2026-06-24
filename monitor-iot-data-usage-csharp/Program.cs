// Program.cs
using Microsoft.Extensions.Configuration;
using TelnyxDataUsageMonitor.Configuration;
using TelnyxDataUsageMonitor.Services;

var builder = WebApplication.CreateBuilder(args);

var configuration = builder.Configuration;

var telnyxConfig = configuration.GetSection("Telnyx").Get<TelnyxConfig>();
if (telnyxConfig == null || string.IsNullOrWhiteSpace(telnyxConfig.ApiKey))
{
    throw new InvalidOperationException("Telnyx API key is not configured. Set TELNYX_API_KEY in appsettings.json or environment variables.");
}

builder.Services.AddHttpClient();

builder.Services.AddSingleton<ISimDataUsageService>(sp =>
    new SimDataUsageService(
        sp.GetRequiredService<IHttpClientFactory>().CreateClient(),
        sp.GetRequiredService<ILogger<SimDataUsageService>>(),
        telnyxConfig.ApiKey
    )
);

builder.Services.AddControllers();
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

// Configuration/TelnyxConfig.cs
namespace TelnyxDataUsageMonitor.Configuration
{
    public class TelnyxConfig
    {
        public string ApiKey { get; set; }
        public string BaseUrl { get; set; } = "https://api.telnyx.com/v2";
        public int PollingIntervalSeconds { get; set; } = 300;
    }
}

// ============================================================================

// Services/SimDataUsageService.cs
using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Microsoft.Extensions.Logging;

namespace TelnyxDataUsageMonitor.Services
{
    public class SimDataUsageResponse
    {
        [JsonProperty("data")]
        public SimDataUsageData Data { get; set; }
    }

    public class SimDataUsageData
    {
        [JsonProperty("id")]
        public string Id { get; set; }

        [JsonProperty("imei")]
        public string Imei { get; set; }

        [JsonProperty("iccid")]
        public string Iccid { get; set; }

        [JsonProperty("total_data_limit_in_mbs")]
        public decimal? TotalDataLimitInMbs { get; set; }

        [JsonProperty("total_data_used_in_mbs")]
        public decimal? TotalDataUsedInMbs { get; set; }

        [JsonProperty("data_limit_percentage")]
        public decimal? DataLimitPercentage { get; set; }
    }

    public interface ISimDataUsageService
    {
        Task<SimDataUsageData> GetDataUsageAsync(string simCardId);
    }

    public class SimDataUsageService : ISimDataUsageService
    {
        private readonly HttpClient _httpClient;
        private readonly ILogger<SimDataUsageService> _logger;
        private readonly string _apiKey;

        public SimDataUsageService(HttpClient httpClient, ILogger<SimDataUsageService> logger, string apiKey)
        {
            _httpClient = httpClient;
            _logger = logger;
            _apiKey = apiKey;
        }

        public async Task<SimDataUsageData> GetDataUsageAsync(string simCardId)
        {
            if (string.IsNullOrWhiteSpace(simCardId))
            {
                throw new ArgumentException("SIM card ID cannot be null or empty.", nameof(simCardId));
            }

            try
            {
                _httpClient.DefaultRequestHeaders.Authorization =
                    new AuthenticationHeaderValue("Bearer", _apiKey);

                var url = $"https://api.telnyx.com/v2/sim_cards/{simCardId}/network_usage";

                var response = await _httpClient.GetAsync(url);

                if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized)
                {
                    _logger.LogError("Authentication failed: Invalid API key.");
                    throw new UnauthorizedAccessException("Invalid Telnyx API key.");
                }

                if (response.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
                {
                    _logger.LogWarning("Rate limit exceeded. Please retry after a delay.");
                    throw new InvalidOperationException("Rate limit exceeded. Please retry later.");
                }

                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    _logger.LogError($"API error: {response.StatusCode} - {errorContent}");
                    throw new HttpRequestException($"Telnyx API error: {response.StatusCode}");
                }

                var content = await response.Content.ReadAsStringAsync();
                var dataUsageResponse = JsonConvert.DeserializeObject<SimDataUsageResponse>(content);

                if (dataUsageResponse?.Data == null)
                {
                    throw new InvalidOperationException("Invalid response format from Telnyx API.");
                }

                _logger.LogInformation($"Successfully retrieved data usage for SIM {simCardId}.");
                return dataUsageResponse.Data;
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Network error connecting to Telnyx: {ex.Message}");
                throw new InvalidOperationException("Network error connecting to Telnyx API.", ex);
            }
            catch (JsonException ex)
            {
                _logger.LogError($"Failed to parse API response: {ex.Message}");
                throw new InvalidOperationException("Failed to parse Telnyx API response.", ex);
            }
        }
    }
}

// ============================================================================

// Controllers/SimDataUsageController.cs
using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using TelnyxDataUsageMonitor.Services;

namespace TelnyxDataUsageMonitor.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class SimDataUsageController : ControllerBase
    {
        private readonly ISimDataUsageService _dataUsageService;
        private readonly ILogger<SimDataUsageController> _logger;

        public SimDataUsageController(ISimDataUsageService dataUsageService, ILogger<SimDataUsageController> logger)
        {
            _dataUsageService = dataUsageService;
            _logger = logger;
        }

        [HttpGet("{simCardId}")]
        public async Task<IActionResult> GetDataUsage(string simCardId)
        {
            if (string.IsNullOrWhiteSpace(simCardId))
            {
                return BadRequest(new { error = "SIM card ID is required." });
            }

            try
            {
                var dataUsage = await _dataUsageService.GetDataUsageAsync(simCardId);

                return Ok(new
                {
                    id = dataUsage.Id,
                    imei = dataUsage.Imei,
                    iccid = dataUsage.Iccid,
                    totalDataLimitInMbs = dataUsage.TotalDataLimitInMbs,
                    totalDataUsedInMbs = dataUsage.TotalDataUsedInMbs,
                    dataLimitPercentage = dataUsage.DataLimitPercentage,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (UnauthorizedAccessException)
            {
                _logger.LogError("Authentication failed for SIM data usage request.");
                return Unauthorized(new { error = "Invalid API key." });
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("Rate limit"))
            {
                _logger.LogWarning("Rate limit exceeded for SIM data usage request.");
                return StatusCode(429, new { error = "Rate limit exceeded. Please retry later." });
            }
            catch (InvalidOperationException ex)
            {
                _logger.LogError($"Service error: {ex.Message}");
                return StatusCode(503, new { error = "Service unavailable. Please try again later." });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpGet("{simCardId}/check-limit")]
        public async Task<IActionResult> CheckDataLimit(string simCardId)
        {
            if (string.IsNullOrWhiteSpace(simCardId))
            {
                return BadRequest(new { error = "SIM card ID is required." });
            }

            try
            {
                var dataUsage = await _dataUsageService.GetDataUsageAsync(simCardId);

                var limitReached = dataUsage.DataLimitPercentage.HasValue && dataUsage.DataLimitPercentage >= 100;

                return Ok(new
                {
                    simCardId = dataUsage.Id,
                    limitReached = limitReached,
                    usagePercentage = dataUsage.DataLimitPercentage ?? 0,
                    totalDataUsedInMbs = dataUsage.TotalDataUsedInMbs ?? 0,
                    totalDataLimitInMbs = dataUsage.TotalDataLimitInMbs ?? 0,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (UnauthorizedAccessException)
            {
                return Unauthorized(new { error = "Invalid API key." });
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("Rate limit"))
            {
                return StatusCode(429, new { error = "Rate limit exceeded. Please retry later." });
            }
            catch (InvalidOperationException ex)
            {
                return StatusCode(503, new { error = "Service unavailable." });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }
    }
}

// ============================================================================

// appsettings.json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information"
    }
  },
  "AllowedHosts": "*",
  "Telnyx": {
    "ApiKey": "YOUR_API_KEY_HERE",
    "BaseUrl": "https://api.telnyx.com/v2",
    "PollingIntervalSeconds": 300
  }
}
