// Program.cs
using Microsoft.Extensions.Configuration;
using TelnyxBulkSMS.Configuration;
using TelnyxBulkSMS.Services;

var builder = WebApplication.CreateBuilder(args);

// Load configuration
var telnyxSettings = new TelnyxSettings();
builder.Configuration.GetSection("Telnyx").Bind(telnyxSettings);

// Add services
builder.Services.AddSingleton(telnyxSettings);
builder.Services.AddHttpClient<BulkSmsService>();
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

// Configuration/TelnyxSettings.cs
namespace TelnyxBulkSMS.Configuration
{
    public class TelnyxSettings
    {
        public string ApiKey { get; set; }
        public string PhoneNumber { get; set; }
        public string ApiBaseUrl { get; set; }
        public int RateLimitDelay { get; set; }
    }
}

// Services/BulkSmsService.cs
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using TelnyxBulkSMS.Configuration;

namespace TelnyxBulkSMS.Services
{
    public class BulkSmsService
    {
        private readonly HttpClient _httpClient;
        private readonly TelnyxSettings _settings;
        private readonly ILogger<BulkSmsService> _logger;

        public BulkSmsService(HttpClient httpClient, TelnyxSettings settings, ILogger<BulkSmsService> logger)
        {
            _httpClient = httpClient;
            _settings = settings;
            _logger = logger;
            
            _httpClient.DefaultRequestHeaders.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue(
                    "Bearer", _settings.ApiKey);
            _httpClient.DefaultRequestHeaders.Add("Accept", "application/json");
        }

        public async Task<BulkSmsResult> SendBulkSmsAsync(List<string> phoneNumbers, string message)
        {
            if (string.IsNullOrWhiteSpace(message))
                throw new ArgumentException("Message cannot be empty", nameof(message));

            if (phoneNumbers == null || phoneNumbers.Count == 0)
                throw new ArgumentException("Phone numbers list cannot be empty", nameof(phoneNumbers));

            foreach (var number in phoneNumbers)
            {
                if (!number.StartsWith("+"))
                    throw new ArgumentException($"Phone number {number} must be in E.164 format (e.g., +15551234567)");
            }

            var result = new BulkSmsResult
            {
                TotalRequested = phoneNumbers.Count,
                Successful = new List<SmsResponse>(),
                Failed = new List<SmsError>()
            };

            foreach (var phoneNumber in phoneNumbers)
            {
                try
                {
                    var response = await SendSingleSmsAsync(phoneNumber, message);
                    result.Successful.Add(response);
                    _logger.LogInformation($"SMS sent successfully to {phoneNumber}. Message ID: {response.MessageId}");
                }
                catch (HttpRequestException ex)
                {
                    result.Failed.Add(new SmsError
                    {
                        PhoneNumber = phoneNumber,
                        ErrorMessage = ex.Message,
                        ErrorCode = "NETWORK_ERROR"
                    });
                    _logger.LogError($"Network error sending to {phoneNumber}: {ex.Message}");
                }
                catch (Exception ex)
                {
                    result.Failed.Add(new SmsError
                    {
                        PhoneNumber = phoneNumber,
                        ErrorMessage = ex.Message,
                        ErrorCode = "UNKNOWN_ERROR"
                    });
                    _logger.LogError($"Error sending to {phoneNumber}: {ex.Message}");
                }

                await Task.Delay(_settings.RateLimitDelay);
            }

            result.SuccessCount = result.Successful.Count;
            result.FailureCount = result.Failed.Count;

            return result;
        }

        private async Task<SmsResponse> SendSingleSmsAsync(string toNumber, string message)
        {
            var payload = new
            {
                from = _settings.PhoneNumber,
                to = toNumber,
                text = message
            };

            var content = new StringContent(
                JsonConvert.SerializeObject(payload),
                Encoding.UTF8,
                "application/json");

            var response = await _httpClient.PostAsync(
                $"{_settings.ApiBaseUrl}/messages",
                content);

            if (!response.IsSuccessStatusCode)
            {
                var errorContent = await response.Content.ReadAsStringAsync();
                _logger.LogError($"API Error ({response.StatusCode}): {errorContent}");

                if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized)
                    throw new UnauthorizedAccessException("Invalid API key");

                if (response.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
                    throw new InvalidOperationException("Rate limit exceeded");

                throw new HttpRequestException($"API returned {response.StatusCode}: {errorContent}");
            }

            var responseContent = await response.Content.ReadAsStringAsync();
            var apiResponse = JsonConvert.DeserializeObject<dynamic>(responseContent);

            return new SmsResponse
            {
                MessageId = apiResponse.data.id,
                PhoneNumber = toNumber,
                Status = apiResponse.data.to[0].status ?? "queued",
                Timestamp = DateTime.UtcNow
            };
        }
    }

    public class BulkSmsResult
    {
        public int TotalRequested { get; set; }
        public int SuccessCount { get; set; }
        public int FailureCount { get; set; }
        public List<SmsResponse> Successful { get; set; }
        public List<SmsError> Failed { get; set; }
    }

    public class SmsResponse
    {
        public string MessageId { get; set; }
        public string PhoneNumber { get; set; }
        public string Status { get; set; }
        public DateTime Timestamp { get; set; }
    }

    public class SmsError
    {
        public string PhoneNumber { get; set; }
        public string ErrorMessage { get; set; }
        public string ErrorCode { get; set; }
    }
}

// Controllers/SmsController.cs
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using TelnyxBulkSMS.Services;

namespace TelnyxBulkSMS.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class SmsController : ControllerBase
    {
        private readonly BulkSmsService _bulkSmsService;
        private readonly ILogger<SmsController> _logger;

        public SmsController(BulkSmsService bulkSmsService, ILogger<SmsController> logger)
        {
            _bulkSmsService = bulkSmsService;
            _logger = logger;
        }

        [HttpPost("send-bulk")]
        public async Task<IActionResult> SendBulkSms([FromBody] BulkSmsRequest request)
        {
            if (request == null || request.PhoneNumbers == null || request.PhoneNumbers.Count == 0)
                return BadRequest(new { error = "PhoneNumbers list is required and cannot be empty" });

            if (string.IsNullOrWhiteSpace(request.Message))
                return BadRequest(new { error = "Message is required" });

            try
            {
                var result = await _bulkSmsService.SendBulkSmsAsync(request.PhoneNumbers, request.Message);

                return Ok(new
                {
                    totalRequested = result.TotalRequested,
                    successCount = result.SuccessCount,
                    failureCount = result.FailureCount,
                    successful = result.Successful.ConvertAll(s => new
                    {
                        messageId = s.MessageId,
                        phoneNumber = s.PhoneNumber,
                        status = s.Status,
                        timestamp = s.Timestamp
                    }),
                    failed = result.Failed.ConvertAll(f => new
                    {
                        phoneNumber = f.PhoneNumber,
                        errorMessage = f.ErrorMessage,
                        errorCode = f.ErrorCode
                    })
                });
            }
            catch (ArgumentException ex)
            {
                _logger.LogWarning($"Validation error: {ex.Message}");
                return BadRequest(new { error = ex.Message });
            }
            catch (UnauthorizedAccessException ex)
            {
                _logger.LogError($"Authentication error: {ex.Message}");
                return Unauthorized(new { error = "Invalid API key" });
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("Rate limit"))
            {
                _logger.LogWarning($"Rate limit error: {ex.Message}");
                return StatusCode(429, new { error = "Rate limit exceeded. Please try again later." });
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Network error: {ex.Message}");
                return StatusCode(503, new { error = "Network error connecting to Telnyx API" });
            }
        }
    }

    public class BulkSmsRequest
    {
        public List<string> PhoneNumbers { get; set; }
        public string Message { get; set; }
    }
}

// appsettings.json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information"
    }
  },
  "Telnyx": {
    "ApiKey": "YOUR_API_KEY_HERE",
    "PhoneNumber": "+15551234567",
    "ApiBaseUrl": "https://api.telnyx.com/v2",
    "RateLimitDelay": 100
  },
  "AllowedHosts": "*"
}
