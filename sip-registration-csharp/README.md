# SIP Registration with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET Core API endpoint that manages SIP connection registration using the Telnyx REST API. This tutorial demonstrates secure credential management via environment variables, proper error handling for telecom APIs, and how to configure SIP credentials for inbound and outbound call routing.

## Who Is This For?

- **C# developers** building sip features with ASP.NET.
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
- A Telnyx phone number assigned to your account.
- Visual Studio, Visual Studio Code, or the .NET CLI.
- Postman or curl for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-registration-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a `Services` folder and add `TelnyxSipService.cs` to handle SIP connection operations:

```csharp
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using TelnyxSipRegistration.Models;

namespace TelnyxSipRegistration.Services
{
    public class TelnyxSipService
    {
        private readonly HttpClient _httpClient;
        private readonly string _apiKey;
        private readonly string _apiBaseUrl;

        public TelnyxSipService(HttpClient httpClient, IConfiguration configuration)
        {
            _httpClient = httpClient;
            _apiKey = Environment.GetEnvironmentVariable("TELNYX_API_KEY") 
                ?? configuration["Telnyx:ApiKey"];
            _apiBaseUrl = Environment.GetEnvironmentVariable("TELNYX_API_BASE_URL") 
                ?? configuration["Telnyx:ApiBaseUrl"];

            if (string.IsNullOrEmpty(_apiKey))
                throw new InvalidOperationException("TELNYX_API_KEY environment variable not set");
        }

        public async Task<SipConnectionResponse> CreateSipConnectionAsync(SipConnectionRequest request)
        {
            // Validate required fields
            if (string.IsNullOrWhiteSpace(request.Name))
                throw new ArgumentException("SIP connection name is required");
            if (string.IsNullOrWhiteSpace(request.Username))
                throw new ArgumentException("Username is required");
            if (string.IsNullOrWhiteSpace(request.Password))
                throw new ArgumentException("Password is required");
            if (request.SipUris == null || request.SipUris.Count == 0)
                throw new ArgumentException("At least one SIP URI is required");

            var payload = new
            {
                data = new
                {
                    name = request.Name,
                    username = request.Username,
                    password = request.Password,
                    sip_uris = request.SipUris,
                    outbound_voice_profile_id = request.OutboundVoiceProfileId
                }
            };

            var content = new StringContent(
                JsonSerializer.Serialize(payload),
                Encoding.UTF8,
                "application/json");

            var request_msg = new HttpRequestMessage(HttpMethod.Post, $"{_apiBaseUrl}/sip_connections")
            {
                Content = content
            };

            request_msg.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _apiKey);

            var response = await _httpClient.SendAsync(request_msg);

            if (!response.IsSuccessStatusCode)
            {
                var errorContent = await response.Content.ReadAsStringAsync();
                throw new HttpRequestException(
                    $"Telnyx API error: {response.StatusCode} - {errorContent}");
            }

            var responseContent = await response.Content.ReadAsStringAsync();
            var jsonDoc = JsonDocument.Parse(responseContent);
            var dataElement = jsonDoc.RootElement.GetProperty("data");

            return new SipConnectionResponse
            {
                Id = dataElement.GetProperty("id").GetString(),
                Name = dataElement.GetProperty("name").GetString(),
                Username = dataElement.GetProperty("username").GetString(),
                SipUris = dataElement.GetProperty("sip_uris")
                    .EnumerateArray()
                    .Select(x => x.GetString())
                    .ToList(),
                Status = dataElement.GetProperty("status").GetString(),
                CreatedAt = DateTime.Parse(dataElement.GetProperty("created_at").GetString())
            };
        }

        public async Task<SipConnectionResponse> GetSipConnectionAsync(string connectionId)
        {
            if (string.IsNullOrWhiteSpace(connectionId))
                throw new ArgumentException("Connection ID is required");

            var request = new HttpRequestMessage(HttpMethod.Get, $"{_apiBaseUrl}/sip_connections/{connectionId}");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _apiKey);

            var response = await _httpClient.SendAsync(request);

            if (!response.IsSuccessStatusCode)
            {
                var errorContent = await response.Content.ReadAsStringAsync();
                throw new HttpRequestException(
                    $"Telnyx API error: {response.StatusCode} - {errorContent}");
            }

            var responseContent = await response.Content.ReadAsStringAsync();
            var jsonDoc = JsonDocument.Parse(responseContent);
            var dataElement = jsonDoc.RootElement.GetProperty("data");

            return new SipConnectionResponse
            {
                Id = dataElement.GetProperty("id").GetString(),
                Name = dataElement.GetProperty("name").GetString(),
                Username = dataElement.GetProperty("username").GetString(),
                SipUris = dataElement.GetProperty("sip_uris")
                    .EnumerateArray()
                    .Select(x => x.GetString())
                    .ToList(),
                Status = dataElement.GetProperty("status").GetString(),
                CreatedAt = DateTime.Parse(dataElement.GetProperty("created_at").GetString())
            };
        }
    }
}
```

Register the service in `Program.cs`:

```csharp
using TelnyxSipRegistration.Services;

var builder = WebApplicationBuilder.CreateBuilder(args);

// Load environment variables from .env file
DotNetEnv.Env.Load();

builder.Services.AddControllers();
builder.Services.AddHttpClient<TelnyxSipService>();
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

Install the DotNetEnv package to load `.env` files:

```bash
dotnet add package DotNetEnv
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-registration-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Confirm the `.env` file is in the project root and `DotNetEnv.Env.Load()` is called in `Program.cs` before the app builds. |
| Missing SIP URI | You receive a 400 error stating "At least one SIP URI is required". | Ensure your request body includes a `sipUris` array with at least one valid SIP endpoint. Example: `"sipUris": ["sip.example.com:5060"]`. The SIP URI should point to your PBX, SBC, or softphone endpoint. |
| Environment Variable Not Set | The application throws `InvalidOperationException: TELNYX_API_KEY environment variable not set` on startup. | Confirm your `.env` file exists in the project root directory and contains `TELNYX_API_KEY=YOUR_API_KEY_HERE`. Ensure the file is named exactly `.env` (not `.env.txt`). Restart the application after creating or modifying the `.env` file. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | Implement exponential backoff in your client code. Wait 1-2 seconds before retrying the request. Check your API usage in the [Telnyx Portal](https://portal.telnyx.com) to understand your rate limits. Consider batching requests or caching SIP connection data. |
| Network Error (503) | The endpoint returns `{"error": "Network error connecting to Telnyx"}` with HTTP 503. | Verify your internet connection and that the Telnyx API is reachable. Check that `TELNYX_API_BASE_URL` is set to `https://api.telnyx.com/v2`. If the issue persists, check the [Telnyx Status Page](https://status.telnyx.com) for service outages. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SIP example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What C# version do I need?**

.NET 8.0 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [SIP Trunking Get Started](https://developers.telnyx.com/docs/voice/sip-trunking/get-started)
- [SIP Configuration Guides](https://developers.telnyx.com/docs/voice/sip-trunking/configuration-guides)
- [Telnyx SIP Trunks](https://telnyx.com/products/sip-trunks)
- [SIP Trunking Pricing](https://telnyx.com/pricing/elastic-sip)

## Related Examples

- [Configure SIP Trunking Setup](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/csharp/sip-trunking-setup).
- [Make Outbound SIP Calls](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/csharp/outbound-sip-call).
- [Set Up Inbound SIP Routing](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/csharp/inbound-sip-routing).
