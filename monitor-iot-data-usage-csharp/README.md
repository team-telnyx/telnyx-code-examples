# Data Usage Monitoring with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET Core application that monitors SIM card data usage using the Telnyx IoT API. This tutorial demonstrates how to retrieve real-time data consumption metrics, set up periodic polling for usage updates, and implement webhook handlers for data limit alerts. You'll learn to integrate Telnyx's SIM management capabilities into a modern ASP.NET application with proper error handling and secure credential management.

## Who Is This For?

- **C# developers** building iot features with ASP.NET.
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
- At least one active SIM card in your Telnyx account.
- Visual Studio, Visual Studio Code, or another C# IDE.
- curl or Postman for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/monitor-iot-data-usage-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/monitor-iot-data-usage-csharp
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to handle SIM card data usage queries. Add a new file `SimDataUsageService.cs`:

```csharp
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
                // Set up authorization header with Bearer token
                _httpClient.DefaultRequestHeaders.Authorization =
                    new AuthenticationHeaderValue("Bearer", _apiKey);

                // Construct the endpoint URL for network usage data
                var url = $"https://api.telnyx.com/v2/sim_cards/{simCardId}/network_usage";

                var response = await _httpClient.GetAsync(url);

                // Handle authentication errors
                if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized)
                {
                    _logger.LogError("Authentication failed: Invalid API key.");
                    throw new UnauthorizedAccessException("Invalid Telnyx API key.");
                }

                // Handle rate limiting
                if (response.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
                {
                    _logger.LogWarning("Rate limit exceeded. Please retry after a delay.");
                    throw new InvalidOperationException("Rate limit exceeded. Please retry later.");
                }

                // Handle other API errors
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
```

Create a controller to expose data usage endpoints. Add a new file `SimDataUsageController.cs`:

```csharp
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

        /// <summary>
        /// Get current data usage for a specific SIM card.
        /// </summary>
        /// <param name="simCardId">The ID of the SIM card to monitor.</param>
        /// <returns>Data usage metrics including total limit and consumed data.</returns>
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

                // Extract serializable data — SDK objects are NOT JSON-serializable
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

        /// <summary>
        /// Check if a SIM card has reached its data limit.
        /// </summary>
        /// <param name="simCardId">The ID of the SIM card to check.</param>
        /// <returns>Boolean indicating if data limit has been reached.</returns>
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
```

Update `Program.cs` to register services and configure the application:

```csharp
using Microsoft.Extensions.Configuration;
using TelnyxDataUsageMonitor.Configuration;
using TelnyxDataUsageMonitor.Services;

var builder = WebApplication.CreateBuilder(args);

// Load configuration from appsettings.json and environment variables
var configuration = builder.Configuration;

// Register Telnyx configuration
var telnyxConfig = configuration.GetSection("Telnyx").Get<TelnyxConfig>();
if (telnyxConfig == null || string.IsNullOrWhiteSpace(telnyxConfig.ApiKey))
{
    throw new InvalidOperationException("Telnyx API key is not configured. Set TELNYX_API_KEY in appsettings.json or environment variables.");
}

// Register HttpClient for Telnyx API calls
builder.Services.AddHttpClient();

// Register the data usage service as a singleton
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
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/monitor-iot-data-usage-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key."}` with HTTP 401 status. | Verify your `TELNYX_API_KEY` in `appsettings.json` or environment variables matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your configuration and restart the application. |
| SIM Card Not Found (404) | The API returns a 404 error or "SIM card not found" message. | Confirm the SIM card ID is correct by checking the [Telnyx Portal](https://portal.telnyx.com) under IoT → SIM Cards. The ID should be in the format `sim_xxxxxxxxxxxxxxxx`. Verify the SIM card is active and associated with your account. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please retry later."}` with HTTP 429 status. | Implement exponential backoff in your polling logic. The Telnyx API allows 100 requests per minute per API key. Increase the `PollingIntervalSeconds` in `appsettings.json` to reduce request frequency. Consider caching data usage results for a few minutes before making new API calls. |
| Network Error (503) | The endpoint returns `{"error": "Service unavailable."}` with HTTP 503 status. | Check your internet connection and verify that `https://api.telnyx.com` is reachable. If the Telnyx API is experiencing an outage, wait a few minutes and retry. Implement retry logic with exponential backoff in production applications. |
| Invalid Configuration | Application throws `InvalidOperationException: Telnyx API key is not configured` on startup. | Ensure `appsettings.json` contains the `Telnyx` section with a valid `ApiKey` value. Alternatively, set the `TELNYX_API_KEY` environment variable. For development, use `dotnet user-secrets set "Telnyx:ApiKey" "your_key_here"` to store secrets securely. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this IoT example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What C# version do I need?**

.NET 8.0 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [IoT SIM Get Started](https://developers.telnyx.com/docs/iot-sim/get-started)
- [SIM Card API Reference](https://developers.telnyx.com/api-reference/sim-cards/get-all-sim-cards)
- [Telnyx IoT SIM Cards](https://telnyx.com/products/iot-sim-card)
- [IoT Data Plans Pricing](https://telnyx.com/pricing/iot-data-plans)

## Related Examples

- [Activate SIM Cards with C# and ASP.NET](/tutorials/iot/csharp/sim-activation).
- [Monitor SIM Status Changes with Webhooks](/tutorials/iot/csharp/sim-status-webhook).
- [Configure APN Settings for IoT Devices](/tutorials/iot/csharp/apn-configuration).
