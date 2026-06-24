// Program.cs
using DotNetEnv;
using TelnyxDeliveryReceipts.Services;

var builder = WebApplicationBuilder.CreateBuilder(args);

// Load environment variables from .env file
DotNetEnv.Env.Load();

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Add HttpClient for Telnyx API calls
builder.Services.AddHttpClient<TelnyxService>();

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

// Models/DeliveryReceipt.cs
namespace TelnyxDeliveryReceipts.Models
{
    public class DeliveryReceipt
    {
        public string Id { get; set; }
        public string Type { get; set; }
        public Data Data { get; set; }
    }

    public class Data
    {
        public string Id { get; set; }
        public string Direction { get; set; }
        public string From { get; set; }
        public List<Recipient> To { get; set; }
        public string Text { get; set; }
        public string CreatedAt { get; set; }
        public string UpdatedAt { get; set; }
    }

    public class Recipient
    {
        public string PhoneNumber { get; set; }
        public string Status { get; set; }
        public string ErrorCode { get; set; }
        public string ErrorMessage { get; set; }
    }

    public class MessageStatus
    {
        public string MessageId { get; set; }
        public string PhoneNumber { get; set; }
        public string Status { get; set; }
        public string ErrorCode { get; set; }
        public string ErrorMessage { get; set; }
        public DateTime ReceivedAt { get; set; }
    }
}

// ============================================================================

// Services/TelnyxService.cs
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace TelnyxDeliveryReceipts.Services
{
    public class TelnyxService
    {
        private readonly HttpClient _httpClient;
        private readonly string _apiKey;
        private readonly string _fromNumber;
        private const string BaseUrl = "https://api.telnyx.com/v2";

        public TelnyxService(HttpClient httpClient)
        {
            _httpClient = httpClient;
            _apiKey = Environment.GetEnvironmentVariable("TELNYX_API_KEY");
            _fromNumber = Environment.GetEnvironmentVariable("TELNYX_PHONE_NUMBER");

            if (string.IsNullOrEmpty(_apiKey))
                throw new InvalidOperationException("TELNYX_API_KEY environment variable not set");
            if (string.IsNullOrEmpty(_fromNumber))
                throw new InvalidOperationException("TELNYX_PHONE_NUMBER environment variable not set");

            // Configure default headers for all requests
            _httpClient.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", _apiKey);
            _httpClient.DefaultRequestHeaders.Accept.Add(
                new MediaTypeWithQualityHeaderValue("application/json"));
        }

        public async Task<Dictionary<string, object>> SendSmsAsync(string toNumber, string message)
        {
            if (!toNumber.StartsWith("+"))
                throw new ArgumentException("Phone number must be in E.164 format (e.g., +15551234567)");

            var payload = new
            {
                from_ = _fromNumber,
                to = toNumber,
                text = message
            };

            var json = JsonSerializer.Serialize(payload);
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            try
            {
                var response = await _httpClient.PostAsync($"{BaseUrl}/messages", content);

                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    throw new HttpRequestException(
                        $"Telnyx API error: {response.StatusCode} - {errorContent}");
                }

                var responseBody = await response.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(responseBody);
                var root = doc.RootElement;

                return new Dictionary<string, object>
                {
                    { "message_id", root.GetProperty("data").GetProperty("id").GetString() },
                    { "status", root.GetProperty("data").GetProperty("to")[0].GetProperty("status").GetString() },
                    { "from", _fromNumber },
                    { "to", toNumber }
                };
            }
            catch (HttpRequestException ex) when (ex.Message.Contains("401"))
            {
                throw new UnauthorizedAccessException("Invalid API key", ex);
            }
            catch (HttpRequestException ex) when (ex.Message.Contains("429"))
            {
                throw new InvalidOperationException("Rate limit exceeded. Please slow down.", ex);
            }
        }
    }
}

// ============================================================================

// Controllers/WebhooksController.cs
using Microsoft.AspNetCore.Mvc;
using TelnyxDeliveryReceipts.Models;
using System.Collections.Concurrent;

namespace TelnyxDeliveryReceipts.Controllers
{
    [ApiController]
    [Route("webhooks")]
    public class WebhooksController : ControllerBase
    {
        // In-memory storage for demonstration; use a database in production
        private static readonly ConcurrentDictionary<string, MessageStatus> DeliveryStatuses =
            new ConcurrentDictionary<string, MessageStatus>();

        [HttpPost("sms")]
        public IActionResult ReceiveDeliveryReceipt([FromBody] DeliveryReceipt receipt)
        {
            if (receipt == null || receipt.Data == null)
                return BadRequest(new { error = "Invalid webhook payload" });

            // Only process finalized delivery status events
            if (receipt.Type != "message.finalized")
                return Ok(new { message = "Event type not processed" });

            try
            {
                var messageId = receipt.Data.Id;
                var recipients = receipt.Data.To ?? new List<Recipient>();

                foreach (var recipient in recipients)
                {
                    var status = new MessageStatus
                    {
                        MessageId = messageId,
                        PhoneNumber = recipient.PhoneNumber,
                        Status = recipient.Status,
                        ErrorCode = recipient.ErrorCode,
                        ErrorMessage = recipient.ErrorMessage,
                        ReceivedAt = DateTime.UtcNow
                    };

                    // Store delivery status keyed by message ID + phone number
                    var key = $"{messageId}:{recipient.PhoneNumber}";
                    DeliveryStatuses.AddOrUpdate(key, status, (_, _) => status);

                    // Log delivery status for audit trail
                    Console.WriteLine(
                        $"[{DateTime.UtcNow:O}] Message {messageId} to {recipient.PhoneNumber}: {recipient.Status}");

                    if (!string.IsNullOrEmpty(recipient.ErrorCode))
                        Console.WriteLine($"  Error: {recipient.ErrorCode} - {recipient.ErrorMessage}");
                }

                return Ok(new { message = "Delivery receipt processed successfully" });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error processing webhook: {ex.Message}");
                return StatusCode(500, new { error = "Failed to process delivery receipt" });
            }
        }

        [HttpGet("status/{messageId}")]
        public IActionResult GetDeliveryStatus(string messageId)
        {
            var statuses = DeliveryStatuses
                .Where(kvp => kvp.Key.StartsWith($"{messageId}:"))
                .Select(kvp => new
                {
                    message_id = kvp.Value.MessageId,
                    phone_number = kvp.Value.PhoneNumber,
                    status = kvp.Value.Status,
                    error_code = kvp.Value.ErrorCode,
                    error_message = kvp.Value.ErrorMessage,
                    received_at = kvp.Value.ReceivedAt
                })
                .ToList();

            if (!statuses.Any())
                return NotFound(new { error = "No delivery status found for this message ID" });

            return Ok(new { deliveries = statuses });
        }
    }
}

// ============================================================================

// Controllers/MessagesController.cs
using Microsoft.AspNetCore.Mvc;
using TelnyxDeliveryReceipts.Services;

namespace TelnyxDeliveryReceipts.Controllers
{
    [ApiController]
    [Route("api/messages")]
    public class MessagesController : ControllerBase
    {
        private readonly TelnyxService _telnyxService;

        public MessagesController(TelnyxService telnyxService)
        {
            _telnyxService = telnyxService;
        }

        [HttpPost("send")]
        public async Task<IActionResult> SendSms([FromBody] SendSmsRequest request)
        {
            if (request == null || string.IsNullOrEmpty(request.To) || string.IsNullOrEmpty(request.Message))
                return BadRequest(new { error = "Missing required fields: 'to' and 'message'" });

            try
            {
                var result = await _telnyxService.SendSmsAsync(request.To, request.Message);
                return Ok(result);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
            catch (UnauthorizedAccessException)
            {
                return Unauthorized(new { error = "Invalid API key" });
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("Rate limit"))
            {
                return StatusCode(429, new { error = ex.Message });
            }
            catch (HttpRequestException ex)
            {
                if (ex.Message.Contains("503"))
                    return StatusCode(503, new { error = "Network error connecting to Telnyx" });

                return StatusCode(500, new { error = ex.Message });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { error = $"Unexpected error: {ex.Message}" });
            }
        }
    }

    public class SendSmsRequest
    {
        public string To { get; set; }
        public string Message { get; set; }
    }
}
