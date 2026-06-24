// Program.cs
using TelnyxIvrMenu.Configuration;
using TelnyxIvrMenu.Services;

var builder = WebApplicationBuilder.CreateBuilder(args);

// Add services to the container
builder.Services.AddControllers();
builder.Services.Configure<TelnyxSettings>(
    builder.Configuration.GetSection("Telnyx"));
builder.Services.AddHttpClient<TelnyxCallService>();
builder.Services.AddLogging();

var app = builder.Build();

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

app.Run();

// Configuration/TelnyxSettings.cs
namespace TelnyxIvrMenu.Configuration
{
    public class TelnyxSettings
    {
        public string ApiKey { get; set; }
        public string PhoneNumber { get; set; }
        public string ConnectionId { get; set; }
    }
}

// Services/TelnyxCallService.cs
using System.Net.Http.Headers;
using Microsoft.Extensions.Options;
using TelnyxIvrMenu.Configuration;

namespace TelnyxIvrMenu.Services
{
    public class TelnyxCallService
    {
        private readonly HttpClient _httpClient;
        private readonly TelnyxSettings _settings;
        private readonly ILogger<TelnyxCallService> _logger;

        public TelnyxCallService(
            HttpClient httpClient,
            IOptions<TelnyxSettings> settings,
            ILogger<TelnyxCallService> logger)
        {
            _httpClient = httpClient;
            _settings = settings.Value;
            _logger = logger;

            _httpClient.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", _settings.ApiKey);
            _httpClient.BaseAddress = new Uri("https://api.telnyx.com/v2");
        }

        public async Task<bool> AnswerCallAsync(string callControlId)
        {
            try
            {
                var payload = new
                {
                    command_id = Guid.NewGuid().ToString()
                };

                var content = new StringContent(
                    System.Text.Json.JsonSerializer.Serialize(payload),
                    System.Text.Encoding.UTF8,
                    "application/json");

                var response = await _httpClient.PostAsync(
                    $"/calls/{callControlId}/actions/answer",
                    content);

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogError($"Failed to answer call: {response.StatusCode}");
                    return false;
                }

                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error answering call: {ex.Message}");
                return false;
            }
        }

        public async Task<bool> PlayPromptAsync(string callControlId, string prompt)
        {
            try
            {
                var payload = new
                {
                    payload = prompt,
                    voice = "female",
                    language = "en-US",
                    command_id = Guid.NewGuid().ToString()
                };

                var content = new StringContent(
                    System.Text.Json.JsonSerializer.Serialize(payload),
                    System.Text.Encoding.UTF8,
                    "application/json");

                var response = await _httpClient.PostAsync(
                    $"/calls/{callControlId}/actions/speak",
                    content);

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogError($"Failed to play prompt: {response.StatusCode}");
                    return false;
                }

                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error playing prompt: {ex.Message}");
                return false;
            }
        }

        public async Task<bool> StartGatheringAsync(string callControlId, int maxDigits = 1)
        {
            try
            {
                var payload = new
                {
                    max_digits = maxDigits,
                    timeout_millis = 5000,
                    command_id = Guid.NewGuid().ToString()
                };

                var content = new StringContent(
                    System.Text.Json.JsonSerializer.Serialize(payload),
                    System.Text.Encoding.UTF8,
                    "application/json");

                var response = await _httpClient.PostAsync(
                    $"/calls/{callControlId}/actions/gather_using_audio",
                    content);

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogError($"Failed to start gathering: {response.StatusCode}");
                    return false;
                }

                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error starting gather: {ex.Message}");
                return false;
            }
        }

        public async Task<bool> TransferCallAsync(string callControlId, string toNumber)
        {
            try
            {
                var payload = new
                {
                    to = toNumber,
                    from_ = _settings.PhoneNumber,
                    command_id = Guid.NewGuid().ToString()
                };

                var content = new StringContent(
                    System.Text.Json.JsonSerializer.Serialize(payload),
                    System.Text.Encoding.UTF8,
                    "application/json");

                var response = await _httpClient.PostAsync(
                    $"/calls/{callControlId}/actions/transfer",
                    content);

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogError($"Failed to transfer call: {response.StatusCode}");
                    return false;
                }

                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error transferring call: {ex.Message}");
                return false;
            }
        }

        public async Task<bool> HangupCallAsync(string callControlId)
        {
            try
            {
                var payload = new
                {
                    command_id = Guid.NewGuid().ToString()
                };

                var content = new StringContent(
                    System.Text.Json.JsonSerializer.Serialize(payload),
                    System.Text.Encoding.UTF8,
                    "application/json");

                var response = await _httpClient.PostAsync(
                    $"/calls/{callControlId}/actions/hangup",
                    content);

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogError($"Failed to hangup call: {response.StatusCode}");
                    return false;
                }

                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error hanging up call: {ex.Message}");
                return false;
            }
        }
    }
}

// Controllers/WebhookController.cs
using Microsoft.AspNetCore.Mvc;
using TelnyxIvrMenu.Services;

namespace TelnyxIvrMenu.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class WebhookController : ControllerBase
    {
        private readonly TelnyxCallService _callService;
        private readonly ILogger<WebhookController> _logger;

        public WebhookController(
            TelnyxCallService callService,
            ILogger<WebhookController> logger)
        {
            _callService = callService;
            _logger = logger;
        }

        [HttpPost("events")]
        public async Task<IActionResult> HandleWebhook([FromBody] dynamic webhookData)
        {
            try
            {
                string eventType = webhookData?.data?.event_type;
                string callControlId = webhookData?.data?.call_control_id;

                _logger.LogInformation($"Received event: {eventType} for call: {callControlId}");

                switch (eventType)
                {
                    case "call.initiated":
                        await HandleCallInitiated(callControlId);
                        break;

                    case "call.answered":
                        await HandleCallAnswered(callControlId);
                        break;

                    case "call.dtmf.received":
                        string digit = webhookData?.data?.dtmf_digit;
                        await HandleDtmfReceived(callControlId, digit);
                        break;

                    case "call.hangup":
                        _logger.LogInformation($"Call {callControlId} ended");
                        break;

                    default:
                        _logger.LogWarning($"Unhandled event type: {eventType}");
                        break;
                }

                return Ok(new { success = true });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error processing webhook: {ex.Message}");
                return StatusCode(500, new { error = ex.Message });
            }
        }

        private async Task HandleCallInitiated(string callControlId)
        {
            _logger.LogInformation($"Call initiated: {callControlId}");
            await _callService.AnswerCallAsync(callControlId);
        }

        private async Task HandleCallAnswered(string callControlId)
        {
            _logger.LogInformation($"Call answered: {callControlId}");

            string prompt = "Welcome to our IVR system. Press 1 for Sales, Press 2 for Support, or Press 3 to speak with an operator.";
            await _callService.PlayPromptAsync(callControlId, prompt);
            await _callService.StartGatheringAsync(callControlId, maxDigits: 1);
        }

        private async Task HandleDtmfReceived(string callControlId, string digit)
        {
            _logger.LogInformation($"DTMF received: {digit} for call: {callControlId}");

            switch (digit)
            {
                case "1":
                    await _callService.PlayPromptAsync(callControlId, "Transferring you to Sales.");
                    await _callService.TransferCallAsync(callControlId, "+15559876543");
                    break;

                case "2":
                    await _callService.PlayPromptAsync(callControlId, "Transferring you to Support.");
                    await _callService.TransferCallAsync(callControlId, "+15559876544");
                    break;

                case "3":
                    await _callService.PlayPromptAsync(callControlId, "Transferring you to an operator.");
                    await _callService.TransferCallAsync(callControlId, "+15559876545");
                    break;

                default:
                    string prompt = "Invalid selection. Press 1 for Sales, Press 2 for Support, or Press 3 for an operator.";
                    await _callService.PlayPromptAsync(callControlId, prompt);
                    await _callService.StartGatheringAsync(callControlId, maxDigits: 1);
                    break;
            }
        }
    }
}

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
    "PhoneNumber": "+15551234567",
    "ConnectionId": "YOUR_CONNECTION_ID_HERE"
  }
}
