// Program.cs
using TelnyxOTP2FA.Configuration;
using TelnyxOTP2FA.Services;

var builder = WebApplication.CreateBuilder(args);

// Load environment variables from .env file
var envPath = Path.Combine(Directory.GetCurrentDirectory(), ".env");
if (File.Exists(envPath))
{
    var lines = File.ReadAllLines(envPath);
    foreach (var line in lines)
    {
        if (string.IsNullOrWhiteSpace(line) || line.StartsWith("#"))
            continue;
        var parts = line.Split('=', 2);
        if (parts.Length == 2)
            Environment.SetEnvironmentVariable(parts[0].Trim(), parts[1].Trim());
    }
}

// Configure Telnyx and OTP settings from environment variables
builder.Services.Configure<TelnyxSettings>(options =>
{
    options.ApiKey = Environment.GetEnvironmentVariable("TELNYX_API_KEY") ?? "";
    options.PhoneNumber = Environment.GetEnvironmentVariable("TELNYX_PHONE_NUMBER") ?? "";
});

builder.Services.Configure<OtpSettings>(options =>
{
    options.ExpirySeconds = int.Parse(Environment.GetEnvironmentVariable("OTP_EXPIRY_SECONDS") ?? "300");
    options.Length = int.Parse(Environment.GetEnvironmentVariable("OTP_LENGTH") ?? "6");
});

builder.Services.AddScoped<IOtpService, OtpService>();
builder.Services.AddScoped<ISmsService, SmsService>();
builder.Services.AddHttpClient<SmsService>();
builder.Services.AddControllers();

var app = builder.Build();

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

app.Run();

// Configuration/TelnyxSettings.cs
namespace TelnyxOTP2FA.Configuration
{
    public class TelnyxSettings
    {
        public string ApiKey { get; set; }
        public string PhoneNumber { get; set; }
    }

    public class OtpSettings
    {
        public int ExpirySeconds { get; set; }
        public int Length { get; set; }
    }
}

// Services/IOtpService.cs
namespace TelnyxOTP2FA.Services
{
    public interface IOtpService
    {
        string GenerateOtp();
        bool ValidateOtp(string phoneNumber, string otp);
        void StoreOtp(string phoneNumber, string otp);
    }

    public class OtpService : IOtpService
    {
        private readonly IOptions<OtpSettings> _otpSettings;
        private readonly Dictionary<string, (string Otp, DateTime ExpiresAt)> _otpStore = new();

        public OtpService(IOptions<OtpSettings> otpSettings)
        {
            _otpSettings = otpSettings;
        }

        public string GenerateOtp()
        {
            var random = new Random();
            var otp = random.Next(
                (int)Math.Pow(10, _otpSettings.Value.Length - 1),
                (int)Math.Pow(10, _otpSettings.Value.Length)
            ).ToString();
            return otp;
        }

        public void StoreOtp(string phoneNumber, string otp)
        {
            var expiresAt = DateTime.UtcNow.AddSeconds(_otpSettings.Value.ExpirySeconds);
            _otpStore[phoneNumber] = (otp, expiresAt);
        }

        public bool ValidateOtp(string phoneNumber, string otp)
        {
            if (!_otpStore.ContainsKey(phoneNumber))
                return false;

            var (storedOtp, expiresAt) = _otpStore[phoneNumber];

            if (DateTime.UtcNow > expiresAt)
            {
                _otpStore.Remove(phoneNumber);
                return false;
            }

            if (storedOtp != otp)
                return false;

            _otpStore.Remove(phoneNumber);
            return true;
        }
    }
}

// Services/ISmsService.cs
namespace TelnyxOTP2FA.Services
{
    public interface ISmsService
    {
        Task<(bool Success, string MessageId, string Error)> SendOtpAsync(string toNumber, string otp);
    }

    public class SmsService : ISmsService
    {
        private readonly IOptions<TelnyxSettings> _telnyxSettings;
        private readonly HttpClient _httpClient;
        private const string TelnyxApiUrl = "https://api.telnyx.com/v2/messages";

        public SmsService(IOptions<TelnyxSettings> telnyxSettings, HttpClient httpClient)
        {
            _telnyxSettings = telnyxSettings;
            _httpClient = httpClient;
        }

        public async Task<(bool Success, string MessageId, string Error)> SendOtpAsync(string toNumber, string otp)
        {
            if (!toNumber.StartsWith("+"))
                return (false, "", "Phone number must be in E.164 format (e.g., +15551234567)");

            var fromNumber = _telnyxSettings.Value.PhoneNumber;
            if (string.IsNullOrEmpty(fromNumber))
                return (false, "", "TELNYX_PHONE_NUMBER not configured");

            var apiKey = _telnyxSettings.Value.ApiKey;
            if (string.IsNullOrEmpty(apiKey))
                return (false, "", "TELNYX_API_KEY not configured");

            var messageText = $"Your verification code is: {otp}. Do not share this code.";

            var requestBody = new
            {
                from = fromNumber,
                to = toNumber,
                text = messageText
            };

            var request = new HttpRequestMessage(HttpMethod.Post, TelnyxApiUrl)
            {
                Content = new StringContent(
                    System.Text.Json.JsonSerializer.Serialize(requestBody),
                    System.Text.Encoding.UTF8,
                    "application/json"
                )
            };

            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue(
                "Bearer", apiKey);

            try
            {
                var response = await _httpClient.SendAsync(request);

                if (response.IsSuccessStatusCode)
                {
                    var responseContent = await response.Content.ReadAsStringAsync();
                    var jsonDoc = System.Text.Json.JsonDocument.Parse(responseContent);
                    var messageId = jsonDoc.RootElement
                        .GetProperty("data")
                        .GetProperty("id")
                        .GetString() ?? "";

                    return (true, messageId, "");
                }

                if ((int)response.StatusCode == 401)
                    return (false, "", "Invalid API key (401)");
                if ((int)response.StatusCode == 429)
                    return (false, "", "Rate limit exceeded (429)");

                var errorContent = await response.Content.ReadAsStringAsync();
                return (false, "", $"Telnyx API error ({response.StatusCode}): {errorContent}");
            }
            catch (HttpRequestException ex)
            {
                return (false, "", $"Network error: {ex.Message}");
            }
            catch (Exception ex)
            {
                return (false, "", $"Unexpected error: {ex.Message}");
            }
        }
    }
}

// Controllers/AuthController.cs
using Microsoft.AspNetCore.Mvc;
using TelnyxOTP2FA.Services;

namespace TelnyxOTP2FA.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AuthController : ControllerBase
    {
        private readonly IOtpService _otpService;
        private readonly ISmsService _smsService;

        public AuthController(IOtpService otpService, ISmsService smsService)
        {
            _otpService = otpService;
            _smsService = smsService;
        }

        [HttpPost("request-otp")]
        public async Task<IActionResult> RequestOtp([FromBody] RequestOtpRequest request)
        {
            if (string.IsNullOrEmpty(request?.PhoneNumber))
                return BadRequest(new { error = "Phone number is required" });

            var otp = _otpService.GenerateOtp();
            _otpService.StoreOtp(request.PhoneNumber, otp);

            var (success, messageId, error) = await _smsService.SendOtpAsync(request.PhoneNumber, otp);

            if (!success)
                return StatusCode(503, new { error = error });

            return Ok(new
            {
                message = "OTP sent successfully",
                message_id = messageId,
                phone_number = request.PhoneNumber
            });
        }

        [HttpPost("verify-otp")]
        public IActionResult VerifyOtp([FromBody] VerifyOtpRequest request)
        {
            if (string.IsNullOrEmpty(request?.PhoneNumber) || string.IsNullOrEmpty(request?.Otp))
                return BadRequest(new { error = "Phone number and OTP are required" });

            var isValid = _otpService.ValidateOtp(request.PhoneNumber, request.Otp);

            if (!isValid)
                return Unauthorized(new { error = "Invalid or expired OTP" });

            return Ok(new
            {
                message = "OTP verified successfully",
                phone_number = request.PhoneNumber,
                authenticated = true
            });
        }
    }

    public class RequestOtpRequest
    {
        public string PhoneNumber { get; set; }
    }

    public class VerifyOtpRequest
    {
        public string PhoneNumber { get; set; }
        public string Otp { get; set; }
    }
}
