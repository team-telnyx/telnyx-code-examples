// Program.cs
using System;
using TelnyxInboundCall.Services;
using DotNetEnv;

var builder = WebApplication.CreateBuilder(args);

// Load environment variables from .env file
Env.Load();

// Add services to the container
builder.Services.AddControllers();
builder.Services.AddHttpClient<CallService>((serviceProvider, client) =>
{
    var apiKey = Environment.GetEnvironmentVariable("TELNYX_API_KEY");
    if (string.IsNullOrEmpty(apiKey))
    {
        throw new InvalidOperationException("TELNYX_API_KEY environment variable not set");
    }
});

var app = builder.Build();

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

Console.WriteLine("Telnyx Inbound Call Webhook Receiver started");
Console.WriteLine("Listening for webhooks at /api/call/webhook");

app.Run();

// Models/WebhookEvent.cs
using System.Text.Json.Serialization;

namespace TelnyxInboundCall.Models
{
    public class WebhookEvent
    {
        [JsonPropertyName("data")]
        public CallData Data { get; set; }

        [JsonPropertyName("meta")]
        public Meta Meta { get; set; }
    }

    public class CallData
    {
        [JsonPropertyName("event_type")]
        public string EventType { get; set; }

        [JsonPropertyName("call_control_id")]
        public string CallControlId { get; set; }

        [JsonPropertyName("from")]
        public string From { get; set; }

        [JsonPropertyName("to")]
        public string To { get; set; }

        [JsonPropertyName("state")]
        public string State { get; set; }

        [JsonPropertyName("direction")]
        public string Direction { get; set; }

        [JsonPropertyName("connection_id")]
        public string ConnectionId { get; set; }
    }

    public class Meta
    {
        [JsonPropertyName("attempt")]
        public int Attempt { get; set; }

        [JsonPropertyName("delivered_at")]
        public string DeliveredAt { get; set; }
    }
}

// Services/CallService.cs
using System;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace TelnyxInboundCall.Services
{
    public class CallService
    {
        private readonly HttpClient _httpClient;
        private readonly string _apiKey;
        private const string BaseUrl = "https://api.telnyx.com/v2";

        public CallService(HttpClient httpClient, string apiKey)
        {
            _httpClient = httpClient;
            _apiKey = apiKey;
            _httpClient.DefaultRequestHeaders.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue(
                    "Bearer", _apiKey);
        }

        public async Task<bool> AnswerCallAsync(string callControlId)
        {
            try
            {
                var url = $"{BaseUrl}/calls/{callControlId}/actions/answer";
                var content = new StringContent("{}", Encoding.UTF8, "application/json");
                var response = await _httpClient.PostAsync(url, content);
                return response.IsSuccessStatusCode;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error answering call: {ex.Message}");
                return false;
            }
        }

        public async Task<bool> HangupCallAsync(string callControlId)
        {
            try
            {
                var url = $"{BaseUrl}/calls/{callControlId}/actions/hangup";
                var content = new StringContent("{}", Encoding.UTF8, "application/json");
                var response = await _httpClient.PostAsync(url, content);
                return response.IsSuccessStatusCode;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error hanging up call: {ex.Message}");
                return false;
            }
        }

        public async Task<bool> SpeakAsync(string callControlId, string text)
        {
            try
            {
                var url = $"{BaseUrl}/calls/{callControlId}/actions/speak";
                var payload = new
                {
                    payload = text,
                    voice = "female",
                    language = "en-US"
                };
                var json = JsonSerializer.Serialize(payload);
                var content = new StringContent(json, Encoding.UTF8, "application/json");
                var response = await _httpClient.PostAsync(url, content);
                return response.IsSuccessStatusCode;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error speaking: {ex.Message}");
                return false;
            }
        }
    }
}

// Controllers/CallController.cs
using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using TelnyxInboundCall.Models;
using TelnyxInboundCall.Services;

namespace TelnyxInboundCall.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class CallController : ControllerBase
    {
        private readonly CallService _callService;

        public CallController(CallService callService)
        {
            _callService = callService;
        }

        [HttpPost("webhook")]
        public async Task<IActionResult> HandleWebhook([FromBody] WebhookEvent webhookEvent)
        {
            // Validate webhook payload structure
            if (webhookEvent?.Data == null)
            {
                return BadRequest(new { error = "Invalid webhook payload" });
            }

            var callData = webhookEvent.Data;
            var eventType = callData.EventType;

            Console.WriteLine($"Received event: {eventType} for call {callData.CallControlId}");
            Console.WriteLine($"From: {callData.From}, To: {callData.To}");

            try
            {
                // Handle different call lifecycle events
                switch (eventType)
                {
                    case "call.initiated":
                        // Inbound call received — answer automatically
                        await _callService.AnswerCallAsync(callData.CallControlId);
                        await _callService.SpeakAsync(
                            callData.CallControlId,
                            "Thank you for calling. Your call has been connected.");
                        break;

                    case "call.answered":
                        // Call is now active
                        Console.WriteLine("Call answered successfully");
                        break;

                    case "call.hangup":
                        // Call ended — clean up resources
                        Console.WriteLine($"Call ended. State: {callData.State}");
                        break;

                    default:
                        Console.WriteLine($"Unhandled event type: {eventType}");
                        break;
                }

                // Return 200 OK to acknowledge receipt
                return Ok(new { status = "received" });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error processing webhook: {ex.Message}");
                // Return 500 to signal Telnyx to retry
                return StatusCode(500, new { error = "Processing failed" });
            }
        }

        [HttpGet("status")]
        public IActionResult GetStatus()
        {
            return Ok(new { status = "webhook receiver is running" });
        }
    }
}
