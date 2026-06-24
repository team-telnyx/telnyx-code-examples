# SMS Survey with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET application that sends SMS survey questions and collects responses via inbound webhooks using the Telnyx SMS API. This tutorial demonstrates how to manage survey state, handle two-way SMS communication, and process webhook events securely in a modern ASP.NET environment.

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
- A Telnyx phone number enabled for inbound and outbound SMS.
- A publicly accessible URL for webhook delivery (ngrok or similar for local development).
- Visual Studio, Visual Studio Code, or the .NET CLI.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-survey-bot-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class `Services/SurveyService.cs` to handle survey logic and Telnyx API calls:

```csharp
using System.Net.Http.Headers;
using Newtonsoft.Json;
using TelnyxSMSSurvey.Models;

namespace TelnyxSMSSurvey.Services
{
    public class SurveyService
    {
        private readonly HttpClient _httpClient;
        private readonly SurveyConfig _config;
        private readonly Dictionary<string, SurveyState> _surveyStates;

        // Survey questions
        private readonly List<string> _questions = new()
        {
            "How satisfied are you with our service? Reply: 1 (Very Satisfied), 2 (Satisfied), 3 (Neutral), 4 (Dissatisfied)",
            "How likely are you to recommend us? Reply: 1 (Very Likely), 2 (Likely), 3 (Unlikely), 4 (Very Unlikely)",
            "What is your primary use case? Reply: 1 (Business), 2 (Personal), 3 (Other)"
        };

        public SurveyService(SurveyConfig config)
        {
            _config = config;
            _surveyStates = new Dictionary<string, SurveyState>();
            
            _httpClient = new HttpClient();
            _httpClient.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", _config.TelnyxApiKey);
            _httpClient.DefaultRequestHeaders.Add("User-Agent", "TelnyxSMSSurvey/1.0");
        }

        /// <summary>
        /// Start a new survey by sending the first question to a phone number.
        /// </summary>
        public async Task<Dictionary<string, object>> StartSurveyAsync(string toNumber)
        {
            if (!toNumber.StartsWith("+"))
                throw new ArgumentException("Phone number must be in E.164 format (e.g., +15551234567)");

            // Initialize survey state for this respondent
            _surveyStates[toNumber] = new SurveyState
            {
                PhoneNumber = toNumber,
                CurrentQuestion = 0
            };

            // Send first question
            await SendSurveyQuestionAsync(toNumber, 0);

            return new Dictionary<string, object>
            {
                { "message", "Survey started" },
                { "phone_number", toNumber },
                { "question_count", _questions.Count }
            };
        }

        /// <summary>
        /// Send a survey question via SMS.
        /// </summary>
        private async Task SendSurveyQuestionAsync(string toNumber, int questionIndex)
        {
            if (questionIndex >= _questions.Count)
                return;

            var question = _questions[questionIndex];
            await SendSmsAsync(toNumber, $"Question {questionIndex + 1}/{_questions.Count}: {question}");
        }

        /// <summary>
        /// Process an inbound SMS response and advance the survey.
        /// </summary>
        public async Task<Dictionary<string, object>> ProcessResponseAsync(string fromNumber, string responseText)
        {
            if (!_surveyStates.ContainsKey(fromNumber))
            {
                await SendSmsAsync(fromNumber, "No active survey found. Reply START to begin.");
                return new Dictionary<string, object> { { "status", "no_survey" } };
            }

            var state = _surveyStates[fromNumber];

            // Record the response
            state.Responses[state.CurrentQuestion] = responseText.Trim();

            // Move to next question
            state.CurrentQuestion++;

            if (state.CurrentQuestion >= _questions.Count)
            {
                // Survey complete
                state.IsComplete = true;
                await SendSmsAsync(fromNumber, "Thank you for completing the survey! Your responses have been recorded.");
                return new Dictionary<string, object>
                {
                    { "status", "complete" },
                    { "responses", state.Responses }
                };
            }

            // Send next question
            await SendSurveyQuestionAsync(fromNumber, state.CurrentQuestion);

            return new Dictionary<string, object>
            {
                { "status", "in_progress" },
                { "current_question", state.CurrentQuestion + 1 },
                { "total_questions", _questions.Count }
            };
        }

        /// <summary>
        /// Send an SMS message via Telnyx API.
        /// </summary>
        private async Task SendSmsAsync(string toNumber, string messageText)
        {
            var payload = new
            {
                from_ = _config.TelnyxPhoneNumber,
                to = toNumber,
                text = messageText
            };

            var content = new StringContent(
                JsonConvert.SerializeObject(payload),
                System.Text.Encoding.UTF8,
                "application/json"
            );

            var response = await _httpClient.PostAsync(
                "https://api.telnyx.com/v2/messages",
                content
            );

            if (!response.IsSuccessStatusCode)
            {
                var errorContent = await response.Content.ReadAsStringAsync();
                throw new HttpRequestException(
                    $"Telnyx API error: {response.StatusCode} - {errorContent}"
                );
            }
        }

        /// <summary>
        /// Retrieve survey results for a respondent.
        /// </summary>
        public Dictionary<string, object> GetSurveyResults(string phoneNumber)
        {
            if (!_surveyStates.ContainsKey(phoneNumber))
                throw new KeyNotFoundException($"No survey found for {phoneNumber}");

            var state = _surveyStates[phoneNumber];
            return new Dictionary<string, object>
            {
                { "phone_number", phoneNumber },
                { "is_complete", state.IsComplete },
                { "responses", state.Responses },
                { "created_at", state.CreatedAt }
            };
        }
    }
}
```

Update `Program.cs` to configure dependency injection and load environment variables:

```csharp
using DotNetEnv;
using TelnyxSMSSurvey.Models;
using TelnyxSMSSurvey.Services;

Env.Load();

var builder = WebApplication.CreateBuilder(args);

// Load configuration from environment variables
var surveyConfig = new SurveyConfig
{
    TelnyxApiKey = Environment.GetEnvironmentVariable("TELNYX_API_KEY"),
    TelnyxPhoneNumber = Environment.GetEnvironmentVariable("TELNYX_PHONE_NUMBER"),
    WebhookUrl = Environment.GetEnvironmentVariable("WEBHOOK_URL")
};

// Register services
builder.Services.AddSingleton(surveyConfig);
builder.Services.AddSingleton<SurveyService>();
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
```

Create a controller `Controllers/SurveyController.cs` to handle HTTP requests:

```csharp
using Microsoft.AspNetCore.Mvc;
using TelnyxSMSSurvey.Models;
using TelnyxSMSSurvey.Services;

namespace TelnyxSMSSurvey.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class SurveyController : ControllerBase
    {
        private readonly SurveyService _surveyService;

        public SurveyController(SurveyService surveyService)
        {
            _surveyService = surveyService;
        }

        /// <summary>
        /// Start a new survey for a phone number.
        /// </summary>
        [HttpPost("start")]
        public async Task<IActionResult> StartSurvey([FromBody] StartSurveyRequest request)
        {
            if (string.IsNullOrEmpty(request?.PhoneNumber))
                return BadRequest(new { error = "Phone number is required" });

            try
            {
                var result = await _surveyService.StartSurveyAsync(request.PhoneNumber);
                return Ok(result);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
            catch (HttpRequestException ex)
            {
                return StatusCode(503, new { error = "Failed to send SMS", details = ex.Message });
            }
        }

        /// <summary>
        /// Webhook endpoint to receive inbound SMS messages.
        /// </summary>
        [HttpPost("webhooks/sms")]
        public async Task<IActionResult> ReceiveSmsWebhook([FromBody] WebhookPayload payload)
        {
            if (payload?.Data == null)
                return BadRequest(new { error = "Invalid webhook payload" });

            // Only process inbound messages
            if (payload.Data.Direction != "inbound")
                return Ok(new { status = "ignored" });

            var fromNumber = payload.Data.From?.PhoneNumber;
            var messageText = payload.Data.Text;

            if (string.IsNullOrEmpty(fromNumber) || string.IsNullOrEmpty(messageText))
                return BadRequest(new { error = "Missing required fields" });

            try
            {
                var result = await _surveyService.ProcessResponseAsync(fromNumber, messageText);
                return Ok(result);
            }
            catch (HttpRequestException ex)
            {
                return StatusCode(503, new { error = "Failed to process response", details = ex.Message });
            }
        }

        /// <summary>
        /// Retrieve survey results for a respondent.
        /// </summary>
        [HttpGet("results/{phoneNumber}")]
        public IActionResult GetResults(string phoneNumber)
        {
            try
            {
                var results = _surveyService.GetSurveyResults(phoneNumber);
                return Ok(results);
            }
            catch (KeyNotFoundException ex)
            {
                return NotFound(new { error = ex.Message });
            }
        }
    }

    public class StartSurveyRequest
    {
        public string PhoneNumber { get; set; }
    }
}
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-survey-bot-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| 401 Unauthorized from Telnyx API | The application returns HTTP 401 when attempting to send SMS messages. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key from the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no leading or trailing spaces. Restart the application after updating the `.env` file. The `Env.Load()` call in `Program.cs` must execute before the `SurveyConfig` is instantiated. |
| Invalid Phone Number Format | Requests to `/api/survey/start` return a 400 error stating "Phone number must be in E.164 format". | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your curl requests and test data to use properly formatted numbers. |
| Webhook Not Receiving Messages | Inbound SMS messages are not triggering the webhook endpoint. | Verify your Telnyx Messaging Profile is configured with the correct webhook URL. Use ngrok to expose your local application: `ngrok http 5001`. Update the `WEBHOOK_URL` in your `.env` file to the ngrok URL. Ensure your firewall allows inbound HTTPS traffic on port 5001. Check the Telnyx Portal webhook logs for delivery failures. |
| Survey State Not Persisting | Survey responses are lost when the application restarts. | The current implementation stores survey state in memory. For production, implement persistent storage using a database (SQL Server, PostgreSQL, etc.). Replace the `Dictionary<string, SurveyState>` in `SurveyService` with a database context. Consider using Entity Framework Core for data access. |
| HttpRequestException When Sending SMS | The application throws an exception when calling the Telnyx API. | Check that your `TELNYX_PHONE_NUMBER` is valid and enabled for outbound SMS in the Telnyx Portal. Verify the recipient phone number is in E.164 format. Check your network connectivity and firewall rules. Review the exception message for specific Telnyx API error details. |

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
- [Implement Two-Factor Authentication with C# and ASP.NET](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/csharp/otp-2fa).
