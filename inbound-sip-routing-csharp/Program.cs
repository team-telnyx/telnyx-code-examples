// Program.cs
using DotNetEnv;

var builder = WebApplicationBuilder.CreateBuilder(args);

// Load environment variables from .env file
Env.Load();

// Add services to the container
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Configure HttpClient for Telnyx API
builder.Services.AddHttpClient("TelnyxClient", client =>
{
    client.BaseAddress = new Uri("https://api.telnyx.com/v2/");
    var apiKey = Environment.GetEnvironmentVariable("TELNYX_API_KEY");
    if (string.IsNullOrEmpty(apiKey))
    {
        throw new InvalidOperationException("TELNYX_API_KEY environment variable not set");
    }
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

// Models/SipConnectionRequest.cs
namespace TelnyxSipRouter.Models
{
    public class SipConnectionRequest
    {
        public string Name { get; set; }
        public string Username { get; set; }
        public string Password { get; set; }
        public string SipUri { get; set; }
    }

    public class SipConnectionResponse
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string Username { get; set; }
        public string SipUri { get; set; }
        public string Status { get; set; }
    }

    public class InboundRoutingRequest
    {
        public string PhoneNumber { get; set; }
        public string ConnectionId { get; set; }
    }

    public class InboundRoutingResponse
    {
        public string PhoneNumber { get; set; }
        public string ConnectionId { get; set; }
        public string Status { get; set; }
    }
}

// Controllers/SipRoutingController.cs
using Microsoft.AspNetCore.Mvc;
using TelnyxSipRouter.Models;
using System.Net.Http.Json;
using System.Text.Json;

namespace TelnyxSipRouter.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class SipRoutingController : ControllerBase
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly ILogger<SipRoutingController> _logger;

        public SipRoutingController(IHttpClientFactory httpClientFactory, ILogger<SipRoutingController> logger)
        {
            _httpClientFactory = httpClientFactory;
            _logger = logger;
        }

        [HttpPost("connections")]
        public async Task<IActionResult> CreateSipConnection([FromBody] SipConnectionRequest request)
        {
            if (request == null || string.IsNullOrEmpty(request.Name))
            {
                return BadRequest(new { error = "Missing required fields: name, username, password, sip_uri" });
            }

            try
            {
                var client = _httpClientFactory.CreateClient("TelnyxClient");

                var payload = new
                {
                    connection_name = request.Name,
                    active = true,
                    credentials = new
                    {
                        username = request.Username,
                        password = request.Password
                    },
                    inbound = new
                    {
                        channel_limit = 10,
                        sip_subdomain = request.Name.ToLower().Replace(" ", "-")
                    },
                    outbound = new
                    {
                        outbound_voice_profile_id = "1"
                    }
                };

                var response = await client.PostAsJsonAsync("sip_connections", payload);

                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    _logger.LogError($"Telnyx API error: {response.StatusCode} - {errorContent}");

                    return StatusCode((int)response.StatusCode, new { error = "Failed to create SIP connection" });
                }

                var responseData = await response.Content.ReadAsAsync<JsonElement>();
                var data = responseData.GetProperty("data");

                return Ok(new SipConnectionResponse
                {
                    Id = data.GetProperty("id").GetString(),
                    Name = data.GetProperty("connection_name").GetString(),
                    Username = data.GetProperty("credentials").GetProperty("username").GetString(),
                    Status = data.GetProperty("active").GetBoolean() ? "active" : "inactive"
                });
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Network error: {ex.Message}");
                return StatusCode(503, new { error = "Network error connecting to Telnyx" });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Unexpected error: {ex.Message}");
                return StatusCode(500, new { error = "Internal server error" });
            }
        }

        [HttpGet("connections/{connectionId}")]
        public async Task<IActionResult> GetSipConnection(string connectionId)
        {
            if (string.IsNullOrEmpty(connectionId))
            {
                return BadRequest(new { error = "Connection ID is required" });
            }

            try
            {
                var client = _httpClientFactory.CreateClient("TelnyxClient");
                var response = await client.GetAsync($"sip_connections/{connectionId}");

                if (!response.IsSuccessStatusCode)
                {
                    if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
                    {
                        return NotFound(new { error = "SIP connection not found" });
                    }

                    return StatusCode((int)response.StatusCode, new { error = "Failed to retrieve SIP connection" });
                }

                var responseData = await response.Content.ReadAsAsync<JsonElement>();
                var data = responseData.GetProperty("data");

                return Ok(new SipConnectionResponse
                {
                    Id = data.GetProperty("id").GetString(),
                    Name = data.GetProperty("connection_name").GetString(),
                    Username = data.GetProperty("credentials").GetProperty("username").GetString(),
                    Status = data.GetProperty("active").GetBoolean() ? "active" : "inactive"
                });
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Network error: {ex.Message}");
                return StatusCode(503, new { error = "Network error connecting to Telnyx" });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Unexpected error: {ex.Message}");
                return StatusCode(500, new { error = "Internal server error" });
            }
        }

        [HttpPost("routing")]
        public async Task<IActionResult> ConfigureInboundRouting([FromBody] InboundRoutingRequest request)
        {
            if (request == null || string.IsNullOrEmpty(request.PhoneNumber) || string.IsNullOrEmpty(request.ConnectionId))
            {
                return BadRequest(new { error = "Missing required fields: phone_number, connection_id" });
            }

            if (!request.PhoneNumber.StartsWith("+"))
            {
                return BadRequest(new { error = "Phone number must be in E.164 format (e.g., +15551234567)" });
            }

            try
            {
                var client = _httpClientFactory.CreateClient("TelnyxClient");

                var payload = new
                {
                    connection_id = request.ConnectionId
                };

                var httpRequest = new HttpRequestMessage(HttpMethod.Patch, $"phone_numbers/{request.PhoneNumber}")
                {
                    Content = JsonContent.Create(payload)
                };

                var response = await client.SendAsync(httpRequest);

                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    _logger.LogError($"Telnyx API error: {response.StatusCode} - {errorContent}");

                    return StatusCode((int)response.StatusCode, new { error = "Failed to configure inbound routing" });
                }

                var responseData = await response.Content.ReadAsAsync<JsonElement>();
                var data = responseData.GetProperty("data");

                return Ok(new InboundRoutingResponse
                {
                    PhoneNumber = request.PhoneNumber,
                    ConnectionId = request.ConnectionId,
                    Status = "configured"
                });
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Network error: {ex.Message}");
                return StatusCode(503, new { error = "Network error connecting to Telnyx" });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Unexpected error: {ex.Message}");
                return StatusCode(500, new { error = "Internal server error" });
            }
        }

        [HttpGet("connections")]
        public async Task<IActionResult> ListSipConnections()
        {
            try
            {
                var client = _httpClientFactory.CreateClient("TelnyxClient");
                var response = await client.GetAsync("sip_connections");

                if (!response.IsSuccessStatusCode)
                {
                    return StatusCode((int)response.StatusCode, new { error = "Failed to list SIP connections" });
                }

                var responseData = await response.Content.ReadAsAsync<JsonElement>();
                var dataArray = responseData.GetProperty("data");

                var connections = new List<SipConnectionResponse>();
                foreach (var item in dataArray.EnumerateArray())
                {
                    connections.Add(new SipConnectionResponse
                    {
                        Id = item.GetProperty("id").GetString(),
                        Name = item.GetProperty("connection_name").GetString(),
                        Username = item.GetProperty("credentials").GetProperty("username").GetString(),
                        Status = item.GetProperty("active").GetBoolean() ? "active" : "inactive"
                    });
                }

                return Ok(connections);
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Network error: {ex.Message}");
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
