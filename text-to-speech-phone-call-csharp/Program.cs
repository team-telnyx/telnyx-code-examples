// Program.cs
using DotNetEnv;

var builder = WebApplication.CreateBuilder(args);

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
    client.DefaultRequestHeaders.Add("Authorization", 
        $"Bearer {Environment.GetEnvironmentVariable("TELNYX_API_KEY")}");
    client.DefaultRequestHeaders.Add("Accept", "application/json");
});

// Register CallService
builder.Services.AddScoped<TelnyxTTS.Services.CallService>();

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
// Models/CallRequest.cs
namespace TelnyxTTS.Models
{
    public class CallRequest
    {
        public string To { get; set; }
        public string Message { get; set; }
    }

    public class CallResponse
    {
        public string CallControlId { get; set; }
        public string Status { get; set; }
        public string From { get; set; }
        public string To { get; set; }
    }

    public class WebhookEvent
    {
        public string Data { get; set; }
        public string EventType { get; set; }
    }
}

// ============================================================================
// Services/CallService.cs
using System.Text;
using System.Text.Json;
using TelnyxTTS.Models;

namespace TelnyxTTS.Services
{
    public class CallService
    {
        private readonly HttpClient _httpClient;
        private readonly ILogger<CallService> _logger;

        public CallService(IHttpClientFactory httpClientFactory, ILogger<CallService> logger)
        {
            _httpClient = httpClientFactory.CreateClient("TelnyxClient");
            _logger = logger;
        }

        public async Task<CallResponse> InitiateCallAsync(string toNumber, string message)
        {
            var fromNumber = Environment.GetEnvironmentVariable("TELNYX_PHONE_NUMBER");
            var connectionId = Environment.GetEnvironmentVariable("TELNYX_CONNECTION_ID");

            if (string.IsNullOrEmpty(fromNumber))
                throw new InvalidOperationException("TELNYX_PHONE_NUMBER environment variable not set");

            if (string.IsNullOrEmpty(connectionId))
                throw new InvalidOperationException("TELNYX_CONNECTION_ID environment variable not set");

            // Validate E.164 format to prevent API errors
            if (!toNumber.StartsWith("+"))
                throw new ArgumentException("Phone number must be in E.164 format (e.g., +15551234567)");

            var payload = new
            {
                from_ = fromNumber,
                to = toNumber,
                connection_id = connectionId,
                custom_headers = new[] { new { name = "X-TTS-Message", value = message } }
            };

            var content = new StringContent(
                JsonSerializer.Serialize(payload),
                Encoding.UTF8,
                "application/json");

            try
            {
                var response = await _httpClient.PostAsync("calls", content);
                response.EnsureSuccessStatusCode();

                var responseBody = await response.Content.ReadAsStringAsync();
                using var jsonDoc = JsonDocument.Parse(responseBody);
                var root = jsonDoc.RootElement;

                var callControlId = root.GetProperty("data")
                    .GetProperty("call_control_id").GetString();

                return new CallResponse
                {
                    CallControlId = callControlId,
                    Status = "initiated",
                    From = fromNumber,
                    To = toNumber
                };
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Failed to initiate call: {ex.Message}");
                throw;
            }
        }

        public async Task<bool> SpeakAsync(string callControlId, string text)
        {
            var payload = new
            {
                payload = text,
                language = "en-US",
                voice = "female"
            };

            var content = new StringContent(
                JsonSerializer.Serialize(payload),
                Encoding.UTF8,
                "application/json");

            try
            {
                var response = await _httpClient.PostAsync(
                    $"calls/{callControlId}/actions/speak",
                    content);

                return response.IsSuccessStatusCode;
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Failed to speak on call {callControlId}: {ex.Message}");
                throw;
            }
        }

        public async Task<bool> HangupAsync(string callControlId)
        {
            try
            {
                var response = await _httpClient.PostAsync(
                    $"calls/{callControlId}/actions/hangup",
                    new StringContent("", Encoding.UTF8, "application/json"));

                return response.IsSuccessStatusCode;
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Failed to hangup call {callControlId}: {ex.Message}");
                throw;
            }
        }
    }
}

// ============================================================================
// Controllers/CallController.cs
using Microsoft.AspNetCore.Mvc;
using System.Text.Json;
using TelnyxTTS.Models;
using TelnyxTTS.Services;

namespace TelnyxTTS.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class CallController : ControllerBase
    {
        private readonly CallService _callService;
        private readonly ILogger<CallController> _logger;

        public CallController(CallService callService, ILogger<CallController> logger)
        {
            _callService = callService;
            _logger = logger;
        }

        [HttpPost("initiate")]
        public async Task<IActionResult> InitiateCall([FromBody] CallRequest request)
        {
            if (request == null || string.IsNullOrEmpty(request.To) || string.IsNullOrEmpty(request.Message))
            {
                return BadRequest(new { error = "Missing required fields: 'to' and 'message'" });
            }

            try
            {
                var result = await _callService.InitiateCallAsync(request.To, request.Message);
                return Ok(new
                {
                    call_control_id = result.CallControlId,
                    status = result.Status,
                    from = result.From,
                    to = result.To
                });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                return StatusCode(500, new { error = ex.Message });
            }
            catch (HttpRequestException ex)
            {
                if (ex.Message.Contains("401"))
                    return Unauthorized(new { error = "Invalid API key" });

                if (ex.Message.Contains("429"))
                    return StatusCode(429, new { error = "Rate limit exceeded. Please slow down." });

                return StatusCode(503, new { error = "Network error connecting to Telnyx" });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Unexpected error: {ex.Message}");
                return StatusCode(500, new { error = "Internal server error" });
            }
        }

        [HttpPost("webhooks/call")]
        public async Task<IActionResult> HandleCallWebhook([FromBody] JsonElement payload)
        {
            try
            {
                var eventType = payload.GetProperty("data")
                    .GetProperty("event_type").GetString();

                var callControlId = payload.GetProperty("data")
                    .GetProperty("call_control_id").GetString();

                _logger.LogInformation($"Received webhook: {eventType} for call {callControlId}");

                if (eventType == "call.answered")
                {
                    var message = "Hello! This is a text to speech message from Telnyx.";
                    await _callService.SpeakAsync(callControlId, message);
                }

                if (eventType == "call.hangup")
                {
                    _logger.LogInformation($"Call {callControlId} ended");
                }

                return Ok(new { status = "received" });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Webhook processing error: {ex.Message}");
                return StatusCode(500, new { error = "Webhook processing failed" });
            }
        }
    }
}
