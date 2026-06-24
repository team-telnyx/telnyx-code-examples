# Inbound SIP Routing with C# and ASP.NET

## What Does This Example Do?

Build a production-ready ASP.NET Core application that receives inbound SIP calls and routes them to your SIP endpoint using the Telnyx SIP Trunking API. This tutorial demonstrates secure API authentication via environment variables, proper HTTP error handling, and JSON serialization patterns for telecom APIs.

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
- A Telnyx phone number assigned to a SIP connection.
- A SIP endpoint (PBX, SBC, or softphone) accessible at a static IP address or FQDN.
- Visual Studio, Visual Studio Code, or the .NET CLI.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/inbound-sip-routing-csharp
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/inbound-sip-routing-csharp
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a `Models` folder and add a `SipConnectionRequest.cs` class to represent the SIP connection configuration:

```csharp
namespace TelnyxSipRouter.Models
{
    public class SipConnectionRequest
    {
        public string Name { get; set; }
        public string Username { get; set; }
        public string Password { get; set; }
        public string SipUri { get; set; }
    }

    public class SipConnectionResponse
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string Username { get; set; }
        public string SipUri { get; set; }
        public string Status { get; set; }
    }

    public class InboundRoutingRequest
    {
        public string PhoneNumber { get; set; }
        public string ConnectionId { get; set; }
    }

    public class InboundRoutingResponse
    {
        public string PhoneNumber { get; set; }
        public string ConnectionId { get; set; }
        public string Status { get; set; }
    }
}
```

Create a `Controllers` folder and add `SipRoutingController.cs` to handle inbound routing requests:

```csharp
using Microsoft.AspNetCore.Mvc;
using TelnyxSipRouter.Models;
using System.Net.Http.Json;
using System.Text.Json;

namespace TelnyxSipRouter.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class SipRoutingController : ControllerBase
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly ILogger<SipRoutingController> _logger;

        public SipRoutingController(IHttpClientFactory httpClientFactory, ILogger<SipRoutingController> logger)
        {
            _httpClientFactory = httpClientFactory;
            _logger = logger;
        }

        /// <summary>
        /// Create a new SIP connection for inbound routing.
        /// </summary>
        [HttpPost("connections")]
        public async Task<IActionResult> CreateSipConnection([FromBody] SipConnectionRequest request)
        {
            if (request == null || string.IsNullOrEmpty(request.Name))
            {
                return BadRequest(new { error = "Missing required fields: name, username, password, sip_uri" });
            }

            try
            {
                var client = _httpClientFactory.CreateClient("TelnyxClient");

                // Build request payload for Telnyx API
                var payload = new
                {
                    connection_name = request.Name,
                    active = true,
                    credentials = new
                    {
                        username = request.Username,
                        password = request.Password
                    },
                    inbound = new
                    {
                        channel_limit = 10,
                        sip_subdomain = request.Name.ToLower().Replace(" ", "-")
                    },
                    outbound = new
                    {
                        outbound_voice_profile_id = "1"
                    }
                };

                var response = await client.PostAsJsonAsync("sip_connections", payload);

                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    _logger.LogError($"Telnyx API error: {response.StatusCode} - {errorContent}");

                    return StatusCode((int)response.StatusCode, new { error = "Failed to create SIP connection" });
                }

                var responseData = await response.Content.ReadAsAsync<JsonElement>();
                var data = responseData.GetProperty("data");

                return Ok(new SipConnectionResponse
                {
                    Id = data.GetProperty("id").GetString(),
                    Name = data.GetProperty("connection_name").GetString(),
                    Username = data.GetProperty("credentials").GetProperty("username").GetString(),
                    Status = data.GetProperty("active").GetBoolean() ? "active" : "inactive"
                });
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Network error: {ex.Message}");
                return StatusCode(503, new { error = "Network error connecting to Telnyx" });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Unexpected error: {ex.Message}");
                return StatusCode(500, new { error = "Internal server error" });
            }
        }

        /// <summary>
        /// Retrieve a SIP connection by ID.
        /// </summary>
        [HttpGet("connections/{connectionId}")]
        public async Task<IActionResult> GetSipConnection(string connectionId)
        {
            if (string.IsNullOrEmpty(connectionId))
            {
                return BadRequest(new { error = "Connection ID is required" });
            }

            try
            {
                var client = _httpClientFactory.CreateClient("TelnyxClient");
                var response = await client.GetAsync($"sip_connections/{connectionId}");

                if (!response.IsSuccessStatusCode)
                {
                    if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
                    {
                        return NotFound(new { error = "SIP connection not found" });
                    }

                    return StatusCode((int)response.StatusCode, new { error = "Failed to retrieve SIP connection" });
                }

                var responseData = await response.Content.ReadAsAsync<JsonElement>();
                var data = responseData.GetProperty("data");

                return Ok(new SipConnectionResponse
                {
                    Id = data.GetProperty("id").GetString(),
                    Name = data.GetProperty("connection_name").GetString(),
                    Username = data.GetProperty("credentials").GetProperty("username").GetString(),
                    Status = data.GetProperty("active").GetBoolean() ? "active" : "inactive"
                });
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Network error: {ex.Message}");
                return StatusCode(503, new { error = "Network error connecting to Telnyx" });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Unexpected error: {ex.Message}");
                return StatusCode(500, new { error = "Internal server error" });
            }
        }

        /// <summary>
        /// Assign a phone number to a SIP connection for inbound routing.
        /// </summary>
        [HttpPost("routing")]
        public async Task<IActionResult> ConfigureInboundRouting([FromBody] InboundRoutingRequest request)
        {
            if (request == null || string.IsNullOrEmpty(request.PhoneNumber) || string.IsNullOrEmpty(request.ConnectionId))
            {
                return BadRequest(new { error = "Missing required fields: phone_number, connection_id" });
            }

            // Validate E.164 format
            if (!request.PhoneNumber.StartsWith("+"))
            {
                return BadRequest(new { error = "Phone number must be in E.164 format (e.g., +15551234567)" });
            }

            try
            {
                var client = _httpClientFactory.CreateClient("TelnyxClient");

                // Extract phone number ID from the number (in production, you'd look this up)
                // For this example, we assume the phone number is already in your Telnyx account
                var payload = new
                {
                    connection_id = request.ConnectionId
                };

                // PATCH the phone number to assign it to the SIP connection
                var httpRequest = new HttpRequestMessage(HttpMethod.Patch, $"phone_numbers/{request.PhoneNumber}")
                {
                    Content = JsonContent.Create(payload)
                };

                var response = await client.SendAsync(httpRequest);

                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    _logger.LogError($"Telnyx API error: {response.StatusCode} - {errorContent}");

                    return StatusCode((int)response.StatusCode, new { error = "Failed to configure inbound routing" });
                }

                var responseData = await response.Content.ReadAsAsync<JsonElement>();
                var data = responseData.GetProperty("data");

                return Ok(new InboundRoutingResponse
                {
                    PhoneNumber = request.PhoneNumber,
                    ConnectionId = request.ConnectionId,
                    Status = "configured"
                });
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Network error: {ex.Message}");
                return StatusCode(503, new { error = "Network error connecting to Telnyx" });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Unexpected error: {ex.Message}");
                return StatusCode(500, new { error = "Internal server error" });
            }
        }

        /// <summary>
        /// List all SIP connections.
        /// </summary>
        [HttpGet("connections")]
        public async Task<IActionResult> ListSipConnections()
        {
            try
            {
                var client = _httpClientFactory.CreateClient("TelnyxClient");
                var response = await client.GetAsync("sip_connections");

                if (!response.IsSuccessStatusCode)
                {
                    return StatusCode((int)response.StatusCode, new { error = "Failed to list SIP connections" });
                }

                var responseData = await response.Content.ReadAsAsync<JsonElement>();
                var dataArray = responseData.GetProperty("data");

                var connections = new List<SipConnectionResponse>();
                foreach (var item in dataArray.EnumerateArray())
                {
                    connections.Add(new SipConnectionResponse
                    {
                        Id = item.GetProperty("id").GetString(),
                        Name = item.GetProperty("connection_name").GetString(),
                        Username = item.GetProperty("credentials").GetProperty("username").GetString(),
                        Status = item.GetProperty("active").GetBoolean() ? "active" : "inactive"
                    });
                }

                return Ok(connections);
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError($"Network error: {ex.Message}");
                return StatusCode(503, new { error = "Network error connecting to Telnyx" });
            }
            catch (Exception ex)
            {
                _logger.LogError($"Unexpected error: {ex.Message}");
                return StatusCode(500, new { error = "Internal server error" });
            }
        }
    }
}
```

## Complete Code

See [`Program.cs`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/inbound-sip-routing-csharp/Program.cs) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Network error connecting to Telnyx"}` with HTTP 503 or 401 status. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Confirm the `.env` file is in the project root and `Env.Load()` is called in `Program.cs` before the HttpClient is configured. Restart the application after updating the key. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" when configuring inbound routing. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your request JSON to use properly formatted numbers. Verify the phone number is already assigned to your Telnyx account. |
| SIP Connection Not Found | The endpoint returns `{"error": "SIP connection not found"}` with HTTP 404 when retrieving a connection. | Verify the connection ID is correct by listing all connections using the `GET /api/siprouting/connections` endpoint. Ensure the connection was successfully created in the previous step. Check that the connection ID is not truncated or malformed in your request URL. |
| Network Error Connecting to Telnyx | The application logs "Network error connecting to Telnyx" and returns HTTP 503. | Verify your internet connection is active and can reach `https://api.telnyx.com`. Check that your firewall or proxy does not block outbound HTTPS traffic to Telnyx. Ensure the `HttpClient` is properly configured with the correct base address and authorization header in `Program.cs`. |
| Missing Required Fields | The endpoint returns `{"error": "Missing required fields: ..."}` with HTTP 400. | Verify your JSON request body includes all required fields: `name`, `username`, `password`, and `sipUri` for SIP connections; `phoneNumber` and `connectionId` for inbound routing. Check that field names match exactly (case-sensitive in JSON). Ensure the request `Content-Type` header is set to `application/json`. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SIP example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

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

- [Configure SIP Authentication](/tutorials/sip/csharp/sip-authentication).
- [Set Up SIP Trunking](/tutorials/sip/csharp/sip-trunking-setup).
- [Configure Codec Settings](/tutorials/sip/csharp/codec-configuration).
