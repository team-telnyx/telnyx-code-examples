// Program.cs
using TelnyxCallForwarding.Configuration;
using TelnyxCallForwarding.Services;

var builder = WebApplication.CreateBuilder(args);

// Load configuration from user secrets and environment variables
var telnyxConfig = new TelnyxConfig
{
    ApiKey = builder.Configuration["TELNYX_API_KEY"],
    PhoneNumber = builder.Configuration["TELNYX_PHONE_NUMBER"],
    ConnectionId = builder.Configuration["TELNYX_CONNECTION_ID"],
    ForwardToNumber = builder.Configuration["FORWARD_TO_NUMBER"]
};

// Validate required configuration
if (string.IsNullOrEmpty(telnyxConfig.ApiKey) ||
    string.IsNullOrEmpty(telnyxConfig.PhoneNumber) ||
    string.IsNullOrEmpty(telnyxConfig.ConnectionId) ||
    string.IsNullOrEmpty(telnyxConfig.ForwardToNumber))
{
    throw new InvalidOperationException("Missing required Telnyx configuration. Ensure all secrets are set.");
}

builder.Services.AddSingleton(telnyxConfig);
builder.Services.AddScoped<ICallForwardingService, CallForwardingService>();
builder.Services.AddControllers();

var app = builder.Build();

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

app.Run();

// ============================================================================

// Configuration/TelnyxConfig.cs
namespace TelnyxCallForwarding.Configuration
{
    public class TelnyxConfig
    {
        public string ApiKey { get; set; }
        public string PhoneNumber { get; set; }
        public string ConnectionId { get; set; }
        public string ForwardToNumber { get; set; }
    }
}

// ============================================================================

// Services/ICallForwardingService.cs
namespace TelnyxCallForwarding.Services
{
    public interface ICallForwardingService
    {
        Task<CallForwardingResult> HandleInboundCall(string callControlId, string fromNumber);
        Task<bool> TransferCall(string callControlId, string toNumber);
    }

    public class CallForwardingResult
    {
        public string CallControlId { get; set; }
        public string Status { get; set; }
        public string Message { get; set; }
    }
}

// ============================================================================

// Services/CallForwardingService.cs
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using TelnyxCallForwarding.Configuration;

namespace TelnyxCallForwarding.Services
{
    public class CallForwardingService : ICallForwardingService
    {
        private readonly TelnyxConfig _config;
        private readonly HttpClient _httpClient;
        private readonly ILogger<CallForwardingService> _logger;

        public CallForwardingService(TelnyxConfig config, ILogger<CallForwardingService> logger)
        {
            _config = config;
            _logger = logger;
            _httpClient = new HttpClient();
            _httpClient.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", _config.ApiKey);
        }

        public async Task<CallForwardingResult> HandleInboundCall(string callControlId, string fromNumber)
        {
            try
            {
                // Validate E.164 format for the forwarding destination
                if (!_config.ForwardToNumber.StartsWith("+"))
                {
                    throw new ArgumentException("Forward-to number must be in E.164 format");
                }

                _logger.LogInformation($"Handling inbound call {callControlId} from {fromNumber}");

                // Answer the call before transferring
                var answerResult = await AnswerCall(callControlId);
                if (!answerResult)
                {
                    return new CallForwardingResult
                    {
                        CallControlId = callControlId,
                        Status = "failed",
                        Message = "Failed to answer call"
                    };
                }

                // Transfer the call to the forwarding destination
                var transferResult = await TransferCall(callControlId, _config.ForwardToNumber);
                if (!transferResult)
                {
                    return new CallForwardingResult
                    {
                        CallControlId = callControlId,
                        Status = "failed",
                        Message = "Failed to transfer call"
                    };
                }

                return new CallForwardingResult
                {
                    CallControlId = callControlId,
                    Status = "transferred",
                    Message = $"Call forwarded to {_config.ForwardToNumber}"
                };
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error handling inbound call: {ex.Message}");
                throw;
            }
        }

        public async Task<bool> TransferCall(string callControlId, string toNumber)
        {
            try
            {
                var url = $"https://api.telnyx.com/v2/calls/{callControlId}/actions/transfer";
                var payload = new
                {
                    to = toNumber
                };

                var content = new StringContent(
                    JsonSerializer.Serialize(payload),
                    Encoding.UTF8,
                    "application/json"
                );

                var response = await _httpClient.PostAsync(url, content);

                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    _logger.LogError($"Transfer failed: {response.StatusCode} - {errorContent}");
                    return false;
                }

                _logger.LogInformation($"Call {callControlId} transferred to {toNumber}");
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error transferring call: {ex.Message}");
                throw;
            }
        }

        private async Task<bool> AnswerCall(string callControlId)
        {
            try
            {
                var url = $"https://api.telnyx.com/v2/calls/{callControlId}/actions/answer";
                var content = new StringContent(
                    JsonSerializer.Serialize(new { }),
                    Encoding.UTF8,
                    "application/json"
                );

                var response = await _httpClient.PostAsync(url, content);

                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    _logger.LogError($"Answer failed: {response.StatusCode} - {errorContent}");
                    return false;
                }

                _logger.LogInformation($"Call {callControlId} answered");
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error answering call: {ex.Message}");
                throw;
            }
        }
    }
}

// ============================================================================

// Controllers/WebhookController.cs
using Microsoft.AspNetCore.Mvc;
using System.Text.Json;
using TelnyxCallForwarding.Services;

namespace TelnyxCallForwarding.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class WebhookController : ControllerBase
    {
        private readonly ICallForwardingService _callForwardingService;
        private readonly ILogger<WebhookController> _logger;

        public WebhookController(ICallForwardingService callForwardingService, ILogger<WebhookController> logger)
        {
            _callForwardingService = callForwardingService;
            _logger = logger;
        }

        [HttpPost("call-events")]
        public async Task<IActionResult> HandleCallEvent([FromBody] JsonElement payload)
        {
            try
            {
                // Extract event type and call details from webhook payload
                var eventType = payload.GetProperty("data").GetProperty("event_type").GetString();
                var callControlId = payload.GetProperty("data").GetProperty("call_control_id").GetString();
                var fromNumber = payload.GetProperty("data").GetProperty("from").GetString();

                _logger.LogInformation($"Received webhook event: {eventType} for call {callControlId}");

                // Handle call.initiated event to trigger forwarding
                if (eventType == "call.initiated")
                {
                    var result = await _callForwardingService.HandleInboundCall(callControlId, fromNumber);
                    return Ok(new
                    {
                        call_control_id = result.CallControlId,
                        status = result.Status,
                        message = result.Message
                    });
                }

                // Handle call.hangup to log call completion
                if (eventType == "call.hangup")
                {
                    _logger.LogInformation($"Call {callControlId} ended");
                    return Ok(new { status = "acknowledged" });
                }

                return Ok(new { status = "acknowledged" });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Unexpected error: {ex.Message}");
                return StatusCode(500, new { error = "Internal server error" });
            }
        }
    }
}
