# Device Location with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET Core API that retrieves and tracks device locations using the Telnyx IoT SIM Management API. This tutorial demonstrates how to query SIM card location data, handle geolocation webhooks, and expose location endpoints with proper error handling and security patterns.

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

- .NET 6.0 or higher installed.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- Active SIM cards in your Telnyx account with network connectivity.
- Visual Studio Code or Visual Studio 2022.
- curl or Postman for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/track-iot-device-location-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service layer to handle SIM card location queries. Add `Services/ISimCardService.cs`:

```csharp
using TelnyxDeviceLocation.Models;

namespace TelnyxDeviceLocation.Services
{
    public interface ISimCardService
    {
        Task<SimCardLocation> GetSimCardLocationAsync(string simCardId);
        Task<List<SimCardLocation>> ListSimCardsWithLocationAsync();
    }
}
```

Implement the service in `Services/SimCardService.cs`:

```csharp
using System.Net.Http.Json;
using TelnyxDeviceLocation.Models;

namespace TelnyxDeviceLocation.Services
{
    public class SimCardService : ISimCardService
    {
        private readonly HttpClient _httpClient;
        private readonly ILogger<SimCardService> _logger;

        public SimCardService(IHttpClientFactory httpClientFactory, ILogger<SimCardService> logger)
        {
            _httpClient = httpClientFactory.CreateClient("TelnyxClient");
            _logger = logger;
        }

        public async Task<SimCardLocation> GetSimCardLocationAsync(string simCardId)
        {
            try
            {
                // Fetch SIM card details from Telnyx API
                var response = await _httpClient.GetAsync($"/sim_cards/{simCardId}");
                
                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogError($"Failed to fetch SIM card {simCardId}: {response.StatusCode}");
                    throw new HttpRequestException($"API returned {response.StatusCode}");
                }

                var jsonContent = await response.Content.ReadAsAsync<dynamic>();
                
                // Extract location data from API response
                // Note: Location data comes from network attachment events and carrier data
                var simCard = new SimCardLocation
                {
                    Id = jsonContent.data.id,
                    Iccid = jsonContent.data.iccid,
                    Status = jsonContent.data.status,
                    SimCardGroupId = jsonContent.data.sim_card_group_id,
                    Location = ExtractLocationFromResponse(jsonContent.data)
                };

                return simCard;
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"HTTP error retrieving SIM card location: {ex.Message}");
                throw;
            }
        }

        public async Task<List<SimCardLocation>> ListSimCardsWithLocationAsync()
        {
            try
            {
                // Fetch all SIM cards with pagination
                var response = await _httpClient.GetAsync("/sim_cards?limit=100");
                
                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogError($"Failed to list SIM cards: {response.StatusCode}");
                    throw new HttpRequestException($"API returned {response.StatusCode}");
                }

                var jsonContent = await response.Content.ReadAsAsync<dynamic>();
                var simCards = new List<SimCardLocation>();

                foreach (var item in jsonContent.data)
                {
                    simCards.Add(new SimCardLocation
                    {
                        Id = item.id,
                        Iccid = item.iccid,
                        Status = item.status,
                        SimCardGroupId = item.sim_card_group_id,
                        Location = ExtractLocationFromResponse(item)
                    });
                }

                return simCards;
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"HTTP error listing SIM cards: {ex.Message}");
                throw;
            }
        }

        private LocationData ExtractLocationFromResponse(dynamic simCardData)
        {
            // Extract location metadata from SIM card response
            // In production, location data comes from network attachment events
            // and is enriched with carrier geolocation databases
            try
            {
                return new LocationData
                {
                    Latitude = simCardData.location?.latitude ?? 0,
                    Longitude = simCardData.location?.longitude ?? 0,
                    Country = simCardData.location?.country ?? "Unknown",
                    Carrier = simCardData.carrier_name ?? "Unknown",
                    Timestamp = simCardData.location?.timestamp ?? null
                };
            }
            catch
            {
                // Return default location if parsing fails
                return new LocationData
                {
                    Latitude = 0,
                    Longitude = 0,
                    Country = "Unknown",
                    Carrier = "Unknown",
                    Timestamp = null
                };
            }
        }
    }
}
```

Create the API controller. Add `Controllers/DeviceLocationController.cs`:

```csharp
using Microsoft.AspNetCore.Mvc;
using TelnyxDeviceLocation.Models;
using TelnyxDeviceLocation.Services;

namespace TelnyxDeviceLocation.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class DeviceLocationController : ControllerBase
    {
        private readonly ISimCardService _simCardService;
        private readonly ILogger<DeviceLocationController> _logger;

        public DeviceLocationController(ISimCardService simCardService, ILogger<DeviceLocationController> logger)
        {
            _simCardService = simCardService;
            _logger = logger;
        }

        /// <summary>
        /// Get location data for a specific SIM card.
        /// </summary>
        [HttpGet("{simCardId}")]
        public async Task<IActionResult> GetSimCardLocation(string simCardId)
        {
            if (string.IsNullOrWhiteSpace(simCardId))
            {
                return BadRequest(new { error = "SIM card ID is required" });
            }

            try
            {
                var location = await _simCardService.GetSimCardLocationAsync(simCardId);
                
                return Ok(new
                {
                    id = location.Id,
                    iccid = location.Iccid,
                    status = location.Status,
                    sim_card_group_id = location.SimCardGroupId,
                    location = new
                    {
                        latitude = location.Location.Latitude,
                        longitude = location.Location.Longitude,
                        country = location.Location.Country,
                        carrier = location.Location.Carrier,
                        timestamp = location.Location.Timestamp
                    }
                });
            }
            catch (HttpRequestException ex) when (ex.Message.Contains("404"))
            {
                _logger.LogWarning($"SIM card not found: {simCardId}");
                return NotFound(new { error = "SIM card not found" });
            }
            catch (HttpRequestException ex) when (ex.Message.Contains("401"))
            {
                _logger.LogError("Authentication failed: Invalid API key");
                return Unauthorized(new { error = "Invalid API key" });
            }
            catch (HttpRequestException ex) when (ex.Message.Contains("429"))
            {
                _logger.LogWarning("Rate limit exceeded");
                return StatusCode(429, new { error = "Rate limit exceeded. Please slow down." });
            }
            catch (HttpRequestException ex)
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

        /// <summary>
        /// List all SIM cards with their location data.
        /// </summary>
        [HttpGet]
        public async Task<IActionResult> ListSimCardsWithLocation()
        {
            try
            {
                var simCards = await _simCardService.ListSimCardsWithLocationAsync();
                
                var result = simCards.Select(s => new
                {
                    id = s.Id,
                    iccid = s.Iccid,
                    status = s.Status,
                    sim_card_group_id = s.SimCardGroupId,
                    location = new
                    {
                        latitude = s.Location.Latitude,
                        longitude = s.Location.Longitude,
                        country = s.Location.Country,
                        carrier = s.Location.Carrier,
                        timestamp = s.Location.Timestamp
                    }
                }).ToList();

                return Ok(result);
            }
            catch (HttpRequestException ex) when (ex.Message.Contains("401"))
            {
                _logger.LogError("Authentication failed: Invalid API key");
                return Unauthorized(new { error = "Invalid API key" });
            }
            catch (HttpRequestException ex) when (ex.Message.Contains("429"))
            {
                _logger.LogWarning("Rate limit exceeded");
                return StatusCode(429, new { error = "Rate limit exceeded. Please slow down." });
            }
            catch (HttpRequestException ex)
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
}
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/track-iot-device-location-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the ASP.NET Core application after updating the environment variable. |
| SIM Card Not Found (404) | You receive a 404 error when querying a specific SIM card ID. | Confirm the SIM card ID exists in your Telnyx account by checking the [Telnyx Portal](https://portal.telnyx.com) under IoT → SIM Cards. Verify you are using the correct UUID format for the SIM card ID. |
| Rate Limit Exceeded (429) | The API returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | Implement exponential backoff retry logic in your service layer. The Telnyx API allows 100 requests per second; space out requests or batch operations. Add a delay between consecutive API calls in your application. |
| Location Data Missing | The location object returns all zeros or "Unknown" values. | Location data is populated only when the SIM card is actively connected to a network. Ensure your SIM card has an active data plan and is currently attached to a carrier network. Location updates are asynchronous; allow time for the device to connect and report its position. |
| HttpClient Configuration Error | The application throws an exception about missing HttpClient factory. | Verify that `builder.Services.AddHttpClient("TelnyxClient", ...)` is called in `Program.cs` before `builder.Build()`. Ensure the named client "TelnyxClient" matches the name used in `IHttpClientFactory.CreateClient("TelnyxClient")`. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this IoT example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

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

- [Activate SIM Cards with C# and ASP.NET](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/csharp/sim-activation).
- [Monitor SIM Card Data Usage with C# and ASP.NET](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/csharp/data-usage-monitoring).
- [Handle SIM Status Webhooks with C# and ASP.NET](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/csharp/sim-status-webhook).
