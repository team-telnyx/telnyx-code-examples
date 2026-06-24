# Scheduled SMS with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET Core application that schedules SMS messages to be sent at a future time using the Telnyx SMS API. This tutorial demonstrates how to integrate Telnyx with a background job scheduler, manage credentials securely via environment variables, and implement proper error handling for telecom APIs in a cloud-native architecture.

## Who Is This For?

- **C# developers** building sms features with ASP.NET.
- **Backend engineers** integrating telephony or messaging into existing applications.
- **DevOps teams** looking for containerized, production-ready telecom examples.
- **Startups and enterprises** replacing legacy telecom providers with a modern API-first platform.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform that gives developers a single API for [voice](https://telnyx.com/products/voice-ai-agents), [messaging](https://telnyx.com/products/sms-api), [SIP](https://telnyx.com/products/sip-trunks), [AI](https://telnyx.com/ai-assistants), and [IoT](https://telnyx.com/products/iot-sim-card) — no Frankenstack required.

- **Integrated platform** — [Voice](https://telnyx.com/products/voice-ai-agents), [SMS](https://telnyx.com/products/sms-api), [SIP trunking](https://telnyx.com/products/sip-trunks), [AI assistants](https://telnyx.com/ai-assistants), and [IoT SIM management](https://telnyx.com/products/iot-sim-card) under one roof. No stitching together multiple vendors.
- **Global private network** — Calls and messages traverse the Telnyx-owned IP network for lower latency and higher reliability than the public internet.
- **Developer-first** — SDKs for Python, Node.js, Go, Ruby, Java, and PHP. Comprehensive webhook event model. Sandbox environment for testing.
- **Competitive pricing** — Pay-as-you-go with no minimums, contracts, or per-seat fees.

## Prerequisites

- .NET 6.0 or higher installed.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for outbound SMS.
- Visual Studio, Visual Studio Code, or the .NET CLI.
- Familiarity with ASP.NET Core and dependency injection.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/schedule-sms-messages-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a `Models/ScheduledSmsRequest.cs` file to define the request structure:

```csharp
using System;

namespace TelnyxScheduledSms.Models
{
    public class ScheduledSmsRequest
    {
        public string To { get; set; }
        public string Message { get; set; }
        public DateTime ScheduledTime { get; set; }
    }

    public class SmsResponse
    {
        public string MessageId { get; set; }
        public string Status { get; set; }
        public string From { get; set; }
        public string To { get; set; }
        public DateTime ScheduledTime { get; set; }
    }
}
```

Create a `Services/TelnyxSmsService.cs` to handle SMS sending logic:

```csharp
using System;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace TelnyxScheduledSms.Services
{
    public interface ITelnyxSmsService
    {
        Task<SmsResponse> SendSmsAsync(string toNumber, string message);
    }

    public class SmsResponse
    {
        public string MessageId { get; set; }
        public string Status { get; set; }
        public string From { get; set; }
        public string To { get; set; }
    }

    public class TelnyxSmsService : ITelnyxSmsService
    {
        private readonly HttpClient _httpClient;
        private readonly IConfiguration _configuration;
        private readonly ILogger<TelnyxSmsService> _logger;
        private const string TelnyxApiUrl = "https://api.telnyx.com/v2/messages";

        public TelnyxSmsService(HttpClient httpClient, IConfiguration configuration, ILogger<TelnyxSmsService> logger)
        {
            _httpClient = httpClient;
            _configuration = configuration;
            _logger = logger;
        }

        public async Task<SmsResponse> SendSmsAsync(string toNumber, string message)
        {
            // Validate E.164 format to prevent API errors
            if (string.IsNullOrEmpty(toNumber) || !toNumber.StartsWith("+"))
            {
                throw new ArgumentException("Phone number must be in E.164 format (e.g., +15551234567)");
            }

            var fromNumber = _configuration["Telnyx:PhoneNumber"];
            if (string.IsNullOrEmpty(fromNumber))
            {
                throw new InvalidOperationException("Telnyx:PhoneNumber configuration not set");
            }

            var apiKey = _configuration["Telnyx:ApiKey"];
            if (string.IsNullOrEmpty(apiKey))
            {
                throw new InvalidOperationException("Telnyx:ApiKey configuration not set");
            }

            var requestBody = new
            {
                from_ = fromNumber,
                to = toNumber,
                text = message
            };

            var jsonContent = new StringContent(
                JsonSerializer.Serialize(requestBody),
                Encoding.UTF8,
                "application/json"
            );

            // Set Bearer token authorization
            _httpClient.DefaultRequestHeaders.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", apiKey);

            try
            {
                var response = await _httpClient.PostAsync(TelnyxApiUrl, jsonContent);

                if (response.IsSuccessStatusCode)
                {
                    var responseContent = await response.Content.ReadAsStringAsync();
                    var jsonDoc = JsonDocument.Parse(responseContent);
                    var data = jsonDoc.RootElement.GetProperty("data");

                    return new SmsResponse
                    {
                        MessageId = data.GetProperty("id").GetString(),
                        Status = data.GetProperty("to")[0].GetProperty("status").GetString(),
                        From = fromNumber,
                        To = toNumber
                    };
                }

                // Handle specific HTTP error codes
                if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized)
                {
                    throw new UnauthorizedAccessException("Invalid Telnyx API key");
                }

                if (response.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
                {
                    throw new InvalidOperationException("Rate limit exceeded. Please slow down.");
                }

                var errorContent = await response.Content.ReadAsStringAsync();
                _logger.LogError($"Telnyx API error: {response.StatusCode} - {errorContent}");
                throw new InvalidOperationException($"Telnyx API error: {response.StatusCode}");
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Network error connecting to Telnyx: {ex.Message}");
                throw new InvalidOperationException("Network error connecting to Telnyx", ex);
            }
        }
    }
}
```

Create a `Services/ScheduledSmsService.cs` to manage job scheduling:

```csharp
using System;
using System.Threading.Tasks;
using Hangfire;
using Microsoft.Extensions.Logging;
using TelnyxScheduledSms.Models;

namespace TelnyxScheduledSms.Services
{
    public interface IScheduledSmsService
    {
        string ScheduleSms(string toNumber, string message, DateTime scheduledTime);
        Task<SmsResponse> SendSmsAsync(string toNumber, string message);
    }

    public class ScheduledSmsService : IScheduledSmsService
    {
        private readonly ITelnyxSmsService _telnyxService;
        private readonly ILogger<ScheduledSmsService> _logger;

        public ScheduledSmsService(ITelnyxSmsService telnyxService, ILogger<ScheduledSmsService> logger)
        {
            _telnyxService = telnyxService;
            _logger = logger;
        }

        public string ScheduleSms(string toNumber, string message, DateTime scheduledTime)
        {
            // Validate scheduled time is in the future
            if (scheduledTime <= DateTime.UtcNow)
            {
                throw new ArgumentException("Scheduled time must be in the future");
            }

            // Schedule the job using Hangfire
            var jobId = BackgroundJob.Schedule(
                () => SendSmsAsync(toNumber, message),
                scheduledTime
            );

            _logger.LogInformation($"SMS scheduled with job ID: {jobId} for {scheduledTime:O}");
            return jobId;
        }

        public async Task<SmsResponse> SendSmsAsync(string toNumber, string message)
        {
            _logger.LogInformation($"Executing scheduled SMS to {toNumber}");
            return await _telnyxService.SendSmsAsync(toNumber, message);
        }
    }
}
```

Update `Program.cs` to configure dependency injection and Hangfire:

```csharp
using Hangfire;
using Hangfire.InMemory;
using TelnyxScheduledSms.Services;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Configure Hangfire with in-memory storage for development
builder.Services.AddHangfire(config =>
    config.UseInMemoryStorage()
);
builder.Services.AddHangfireServer();

// Register Telnyx services
builder.Services.AddHttpClient<ITelnyxSmsService, TelnyxSmsService>();
builder.Services.AddScoped<IScheduledSmsService, ScheduledSmsService>();

var app = builder.Build();

// Configure the HTTP request pipeline
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseAuthorization();

// Map Hangfire dashboard (optional, for monitoring)
app.UseHangfireDashboard();

app.MapControllers();

app.Run();
```

Create a `Controllers/SmsController.cs` with endpoints for scheduling and sending SMS:

```csharp
using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using TelnyxScheduledSms.Models;
using TelnyxScheduledSms.Services;

namespace TelnyxScheduledSms.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class SmsController : ControllerBase
    {
        private readonly IScheduledSmsService _scheduledSmsService;
        private readonly ILogger<SmsController> _logger;

        public SmsController(IScheduledSmsService scheduledSmsService, ILogger<SmsController> logger)
        {
            _scheduledSmsService = scheduledSmsService;
            _logger = logger;
        }

        [HttpPost("schedule")]
        public IActionResult ScheduleSms([FromBody] ScheduledSmsRequest request)
        {
            // Validate request
            if (request == null)
            {
                return BadRequest(new { error = "Request body required" });
            }

            if (string.IsNullOrEmpty(request.To) || string.IsNullOrEmpty(request.Message))
            {
                return BadRequest(new { error = "Missing required fields: 'to' and 'message'" });
            }

            try
            {
                var jobId = _scheduledSmsService.ScheduleSms(request.To, request.Message, request.ScheduledTime);

                return Accepted(new
                {
                    jobId = jobId,
                    to = request.To,
                    message = request.Message,
                    scheduledTime = request.ScheduledTime,
                    status = "scheduled"
                });
            }
            catch (ArgumentException ex)
            {
                _logger.LogWarning($"Validation error: {ex.Message}");
                return BadRequest(new { error = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                _logger.LogError($"Configuration error: {ex.Message}");
                return StatusCode(500, new { error = "Server configuration error" });
            }
        }

        [HttpPost("send")]
        public async Task<IActionResult> SendSmsNow([FromBody] ScheduledSmsRequest request)
        {
            // Validate request
            if (request == null)
            {
                return BadRequest(new { error = "Request body required" });
            }

            if (string.IsNullOrEmpty(request.To) || string.IsNullOrEmpty(request.Message))
            {
                return BadRequest(new { error = "Missing required fields: 'to' and 'message'" });
            }

            try
            {
                var result = await _scheduledSmsService.SendSmsAsync(request.To, request.Message);

                return Ok(new
                {
                    messageId = result.MessageId,
                    status = result.Status,
                    from = result.From,
                    to = result.To
                });
            }
            catch (ArgumentException ex)
            {
                _logger.LogWarning($"Validation error: {ex.Message}");
                return BadRequest(new { error = ex.Message });
            }
            catch (UnauthorizedAccessException)
            {
                _logger.LogError("Authentication failed with Telnyx API");
                return Unauthorized(new { error = "Invalid API key" });
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("Rate limit"))
            {
                _logger.LogWarning("Rate limit exceeded");
                return StatusCode(429, new { error = "Rate limit exceeded. Please slow down." });
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("Network error"))
            {
                _logger.LogError($"Network error: {ex.Message}");
                return StatusCode(503, new { error = "Network error connecting to Telnyx" });
            }
            catch (InvalidOperationException ex)
            {
                _logger.LogError($"API error: {ex.Message}");
                return StatusCode(500, new { error = ex.Message });
            }
        }
    }
}
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/schedule-sms-messages-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your API key is correctly set in user secrets using `dotnet user-secrets list`. Ensure there are no trailing spaces or quotes. If the key was regenerated in the Telnyx Portal, update it with `dotnet user-secrets set "Telnyx:ApiKey" "NEW_KEY"` and restart the application. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Scheduled Time in the Past | The endpoint returns `{"error": "Scheduled time must be in the future"}` when scheduling SMS. | Ensure the `scheduledTime` field in your request is set to a future date and time in ISO 8601 format (e.g., `2026-06-25T14:30:00Z`). Use UTC timestamps to avoid timezone confusion. Verify your system clock is synchronized. |
| Hangfire Jobs Not Executing | Scheduled jobs appear in the Hangfire dashboard but are not being sent. | Ensure the Hangfire server is running (it starts automatically with the application). Check application logs for errors during job execution. For production, consider using a persistent storage backend like SQL Server instead of in-memory storage. Verify the `IScheduledSmsService` is properly registered in dependency injection. |
| Configuration Not Found | The application throws `InvalidOperationException: Telnyx:ApiKey configuration not set`. | Verify user secrets are initialized with `dotnet user-secrets init` and the API key is set with `dotnet user-secrets set "Telnyx:ApiKey" "YOUR_KEY"`. Ensure you are running the application in Development environment. Check that `appsettings.json` exists in the project root. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What C# version do I need?**

.NET 8.0 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)

## Related Examples

- [Send a Single SMS with C# and ASP.NET](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/csharp/send-single-sms).
- [Receive SMS Webhooks with C# and ASP.NET](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/csharp/receive-sms-webhook).
- [Send Bulk SMS Messages with C# and ASP.NET](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/csharp/send-bulk-sms).
