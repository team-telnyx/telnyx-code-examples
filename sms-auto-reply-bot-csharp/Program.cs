// Program.cs
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using TelnyxAutoresponder.Configuration;
using TelnyxAutoresponder.Services;

var builder = WebApplication.CreateBuilder(args);

// Load user secrets in development
if (builder.Environment.IsDevelopment())
{
    builder.Configuration.AddUserSecrets<Program>();
}

// Add services to the container
builder.Services.Configure<TelnyxOptions>(
    builder.Configuration.GetSection("Telnyx"));

builder.Services.AddHttpClient<SmsService>();
builder.Services.AddScoped<WebhookService>();

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

// Configuration/TelnyxOptions.cs
namespace TelnyxAutoresponder.Configuration
{
    public class TelnyxOptions
    {
        public string ApiKey { get; set; }
        public string PhoneNumber { get; set; }
        public string WebhookUrl { get; set; }
    }
}

// ============================================================================

// Services/SmsService.cs
using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using TelnyxAutoresponder.Configuration;
using Microsoft.Extensions.Options;

namespace TelnyxAutoresponder.Services
{
    public class SmsService
    {
        private readonly HttpClient _httpClient;
        private readonly TelnyxOptions _options;
        private const string TelnyxApiUrl = "https://api.telnyx.com/v2/messages";

        public SmsService(HttpClient httpClient, IOptions<TelnyxOptions> options)
        {
            _httpClient = httpClient;
            _options = options.Value;
            
            _httpClient.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", _options.ApiKey);
        }

        public async Task<SmsResponse> SendSmsAsync(string toNumber, string messageText)
        {
            if (string.IsNullOrWhiteSpace(toNumber) || !toNumber.StartsWith("+"))
            {
                throw new ArgumentException(
                    "Phone number must be in E.164 format (e.g., +15551234567)", 
                    nameof(toNumber));
            }

            if (string.IsNullOrWhiteSpace(messageText))
            {
                throw new ArgumentException("Message text cannot be empty", nameof(messageText));
            }

            var payload = new
            {
                from = _options.PhoneNumber,
                to = toNumber,
                text = messageText
            };

            var content = new StringContent(
                JsonConvert.SerializeObject(payload),
                Encoding.UTF8,
                "application/json");

            try
            {
                var response = await _httpClient.PostAsync(TelnyxApiUrl, content);

                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    throw new HttpRequestException(
                        $"Telnyx API error: {response.StatusCode} - {errorContent}");
                }

                var responseContent = await response.Content.ReadAsStringAsync();
                var result = JsonConvert.DeserializeObject<TelnyxApiResponse>(responseContent);

                return new SmsResponse
                {
                    MessageId = result?.Data?.Id,
                    Status = result?.Data?.To?[0]?.Status ?? "unknown",
                    From = _options.PhoneNumber,
                    To = toNumber
                };
            }
            catch (HttpRequestException ex) when (ex.Message.Contains("401"))
            {
                throw new UnauthorizedAccessException("Invalid Telnyx API key", ex);
            }
            catch (HttpRequestException ex) when (ex.Message.Contains("429"))
            {
                throw new InvalidOperationException("Rate limit exceeded. Please slow down.", ex);
            }
        }
    }

    public class TelnyxApiResponse
    {
        [JsonProperty("data")]
        public MessageData Data { get; set; }
    }

    public class MessageData
    {
        [JsonProperty("id")]
        public string Id { get; set; }

        [JsonProperty("to")]
        public ToRecipient[] To { get; set; }
    }

    public class ToRecipient
    {
        [JsonProperty("status")]
        public string Status { get; set; }
    }

    public class SmsResponse
    {
        public string MessageId { get; set; }
        public string Status { get; set; }
        public string From { get; set; }
        public string To { get; set; }
    }
}

// ============================================================================

// Services/WebhookService.cs
using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace TelnyxAutoresponder.Services
{
    public class WebhookService
    {
        public string GenerateAutoResponse(InboundSmsWebhook webhook)
        {
            var messageText = webhook?.Data?.Payload?.Text ?? "";
            var senderNumber = webhook?.Data?.Payload?.From?.PhoneNumber ?? "Unknown";

            if (messageText.Contains("help", StringComparison.OrdinalIgnoreCase))
            {
                return "Thanks for contacting us! Our support team will respond shortly. " +
                       "For urgent issues, please call our hotline.";
            }

            if (messageText.Contains("hours", StringComparison.OrdinalIgnoreCase) ||
                messageText.Contains("open", StringComparison.OrdinalIgnoreCase))
            {
                return "We're open Monday-Friday, 9 AM - 6 PM EST. " +
                       "Your message has been received and we'll respond during business hours.";
            }

            return "Thank you for your message! We've received it and will respond as soon as possible.";
        }

        public bool IsValidWebhook(InboundSmsWebhook webhook)
        {
            return webhook?.Data?.Payload?.Text != null &&
                   webhook?.Data?.Payload?.From?.PhoneNumber != null &&
                   webhook?.Data?.Payload?.To != null;
        }
    }

    public class InboundSmsWebhook
    {
        [JsonProperty("data")]
        public WebhookData Data { get; set; }

        [JsonProperty("meta")]
        public WebhookMeta Meta { get; set; }
    }

    public class WebhookData
    {
        [JsonProperty("payload")]
        public SmsPayload Payload { get; set; }
    }

    public class SmsPayload
    {
        [JsonProperty("id")]
        public string Id { get; set; }

        [JsonProperty("text")]
        public string Text { get; set; }

        [JsonProperty("from")]
        public PhoneInfo From { get; set; }

        [JsonProperty("to")]
        public string[] To { get; set; }

        [JsonProperty("received_at")]
        public string ReceivedAt { get; set; }
    }

    public class PhoneInfo
    {
        [JsonProperty("phone_number")]
        public string PhoneNumber { get; set; }
    }

    public class WebhookMeta
    {
        [JsonProperty("attempt_number")]
        public int AttemptNumber { get; set; }

        [JsonProperty("delivered_to")]
        public string DeliveredTo { get; set; }
    }
}

// ============================================================================

// Controllers/WebhooksController.cs
using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using TelnyxAutoresponder.Services;

namespace TelnyxAutoresponder.Controllers
{
    [ApiController]
    [Route("webhooks")]
    public class WebhooksController : ControllerBase
    {
        private readonly SmsService _smsService;
        private readonly WebhookService _webhookService;
        private readonly ILogger<WebhooksController> _logger;

        public WebhooksController(
            SmsService smsService,
            WebhookService webhookService,
            ILogger<WebhooksController> logger)
        {
            _smsService = smsService;
            _webhookService = webhookService;
            _logger = logger;
        }

        [HttpPost("sms")]
        public async Task<IActionResult> HandleSmsWebhook([FromBody] InboundSmsWebhook webhook)
        {
            if (webhook == null)
            {
                _logger.LogWarning("Received null webhook payload");
                return BadRequest(new { error = "Webhook payload required" });
            }

            if (!_webhookService.IsValidWebhook(webhook))
            {
                _logger.LogWarning("Received malformed webhook: missing required fields");
                return BadRequest(new { error = "Invalid webhook structure" });
            }

            try
            {
                var messageText = webhook.Data.Payload.Text;
                var senderNumber = webhook.Data.Payload.From.PhoneNumber;
                var messageId = webhook.Data.Payload.Id;

                _logger.LogInformation(
                    "Received SMS from {SenderNumber}: {MessageText}",
                    senderNumber, messageText);

                var autoResponse = _webhookService.GenerateAutoResponse(webhook);

                var smsResponse = await _smsService.SendSmsAsync(senderNumber, autoResponse);

                _logger.LogInformation(
                    "Sent auto-response to {SenderNumber} with message ID {ResponseMessageId}",
                    senderNumber, smsResponse.MessageId);

                return Ok(new
                {
                    success = true,
                    inbound_message_id = messageId,
                    response_message_id = smsResponse.MessageId,
                    response_text = autoResponse
                });
            }
            catch (ArgumentException ex)
            {
                _logger.LogError(ex, "Validation error processing webhook");
                return BadRequest(new { error = ex.Message });
            }
            catch (UnauthorizedAccessException ex)
            {
                _logger.LogError(ex, "Authentication error with Telnyx API");
                return StatusCode(401, new { error = "Invalid API credentials" });
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("Rate limit"))
            {
                _logger.LogError(ex, "Rate limit exceeded");
                return StatusCode(429, new { error = "Rate limit exceeded" });
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "HTTP error communicating with Telnyx API");
                return StatusCode(503, new { error = "Service unavailable" });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error processing webhook");
                return StatusCode(500, new { error = "Internal server error" });
            }
        }
    }
}
