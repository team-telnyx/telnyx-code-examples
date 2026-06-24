// Program.cs
using DotNetEnv;

var builder = WebApplicationBuilder.CreateBuilder(args);

// Load environment variables from .env file
Env.Load();

// Add services to the container
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Register HttpClient for Telnyx API calls
builder.Services.AddHttpClient("TelnyxClient", client =>
{
    var apiKey = Environment.GetEnvironmentVariable("TELNYX_API_KEY");
    client.DefaultRequestHeaders.Authorization =
        new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", apiKey);
    client.BaseAddress = new Uri("https://api.telnyx.com/v2/");
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

// ============================================================================

// Models/SmsMessage.cs
using Newtonsoft.Json;

namespace TelnyxTwoWaySMS.Models
{
    public class SmsWebhookPayload
    {
        [JsonProperty("data")]
        public SmsMessageData Data { get; set; }
    }

    public class SmsMessageData
    {
        [JsonProperty("id")]
        public string Id { get; set; }

        [JsonProperty("type")]
        public string Type { get; set; }

        [JsonProperty("direction")]
        public string Direction { get; set; }

        [JsonProperty("from")]
        public PhoneNumber From { get; set; }

        [JsonProperty("to")]
        public List<PhoneNumber> To { get; set; }

        [JsonProperty("text")]
        public string Text { get; set; }

        [JsonProperty("created_at")]
        public string CreatedAt { get; set; }
    }

    public class PhoneNumber
    {
        [JsonProperty("phone_number")]
        public string Number { get; set; }

        [JsonProperty("status")]
        public string Status { get; set; }
    }

    public class SendSmsRequest
    {
        public string To { get; set; }
        public string Message { get; set; }
    }

    public class SendSmsResponse
    {
        public string MessageId { get; set; }
        public string Status { get; set; }
        public string From { get; set; }
        public string To { get; set; }
    }
}

// ============================================================================

// Controllers/SmsController.cs
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;
using TelnyxTwoWaySMS.Models;

namespace TelnyxTwoWaySMS.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class SmsController : ControllerBase
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly ILogger<SmsController> _logger;

        public SmsController(IHttpClientFactory httpClientFactory, ILogger<SmsController> logger)
        {
            _httpClientFactory = httpClientFactory;
            _logger = logger;
        }

        /// <summary>
        /// Send an outbound SMS message.
        /// </summary>
        [HttpPost("send")]
        public async Task<IActionResult> SendSms([FromBody] SendSmsRequest request)
        {
            // Validate request
            if (string.IsNullOrWhiteSpace(request?.To) || string.IsNullOrWhiteSpace(request?.Message))
            {
                return BadRequest(new { error = "Missing required fields: 'to' and 'message'" });
            }

            // Validate E.164 format
            if (!request.To.StartsWith("+"))
            {
                return BadRequest(new { error = "Phone number must be in E.164 format (e.g., +15551234567)" });
            }

            var fromNumber = Environment.GetEnvironmentVariable("TELNYX_PHONE_NUMBER");
            if (string.IsNullOrWhiteSpace(fromNumber))
            {
                _logger.LogError("TELNYX_PHONE_NUMBER environment variable not set");
                return StatusCode(500, new { error = "Server configuration error" });
            }

            try
            {
                var client = _httpClientFactory.CreateClient("TelnyxClient");

                var payload = new
                {
                    from = fromNumber,
                    to = request.To,
                    text = request.Message
                };

                var content = new StringContent(
                    JsonConvert.SerializeObject(payload),
                    System.Text.Encoding.UTF8,
                    "application/json"
                );

                var response = await client.PostAsync("messages", content);

                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    _logger.LogError($"Telnyx API error: {response.StatusCode} - {errorContent}");

                    return response.StatusCode switch
                    {
                        System.Net.HttpStatusCode.Unauthorized => StatusCode(401, new { error = "Invalid API key" }),
                        System.Net.HttpStatusCode.TooManyRequests => StatusCode(429, new { error = "Rate limit exceeded. Please slow down." }),
                        _ => StatusCode((int)response.StatusCode, new { error = "Failed to send SMS", details = errorContent })
                    };
                }

                var responseContent = await response.Content.ReadAsStringAsync();
                var messageResponse = JsonConvert.DeserializeObject<dynamic>(responseContent);

                var result = new SendSmsResponse
                {
                    MessageId = messageResponse.data.id,
                    Status = messageResponse.data.to[0].status ?? "queued",
                    From = fromNumber,
                    To = request.To
                };

                return Ok(result);
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Network error: {ex.Message}");
                return StatusCode(503, new { error = "Network error connecting to Telnyx" });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Unexpected error: {ex.Message}");
                return StatusCode(500, new { error = "An unexpected error occurred" });
            }
        }

        /// <summary>
        /// Webhook endpoint to receive inbound SMS messages.
        /// </summary>
        [HttpPost("webhooks/receive")]
        public async Task<IActionResult> ReceiveSms([FromBody] SmsWebhookPayload payload)
        {
            if (payload?.Data == null)
            {
                return BadRequest(new { error = "Invalid webhook payload" });
            }

            var messageData = payload.Data;

            // Only process received messages
            if (messageData.Direction != "inbound")
            {
                return Ok(new { status = "ignored" });
            }

            _logger.LogInformation($"Received SMS from {messageData.From?.Number}: {messageData.Text}");

            try
            {
                // Echo back the received message with a prefix
                var replyText = $"Echo: {messageData.Text}";
                var replyRequest = new SendSmsRequest
                {
                    To = messageData.From.Number,
                    Message = replyText
                };

                // Send reply using the same SendSms logic
                var client = _httpClientFactory.CreateClient("TelnyxClient");
                var fromNumber = Environment.GetEnvironmentVariable("TELNYX_PHONE_NUMBER");

                var payload_reply = new
                {
                    from = fromNumber,
                    to = replyRequest.To,
                    text = replyRequest.Message
                };

                var content = new StringContent(
                    JsonConvert.SerializeObject(payload_reply),
                    System.Text.Encoding.UTF8,
                    "application/json"
                );

                var response = await client.PostAsync("messages", content);

                if (response.IsSuccessStatusCode)
                {
                    _logger.LogInformation($"Sent reply to {replyRequest.To}");
                }
                else
                {
                    _logger.LogWarning($"Failed to send reply: {response.StatusCode}");
                }

                return Ok(new { status = "processed", message_id = messageData.Id });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Error processing webhook: {ex.Message}");
                return StatusCode(500, new { error = "Failed to process webhook" });
            }
        }
    }
}
