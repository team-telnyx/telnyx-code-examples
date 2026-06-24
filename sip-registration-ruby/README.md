# SIP Registration with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready Sinatra application that manages SIP connection registration using the Telnyx Ruby SDK. This tutorial demonstrates credential-based SIP authentication, secure API key management, and proper error handling for telecom APIs. By the end, you'll have a working SIP trunk configured for inbound and outbound calls.

## Who Is This For?

- **Ruby developers** building sip features with Sinatra.
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

- Ruby 2.7 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number assigned to your account.
- Bundler (Ruby dependency manager).
- A SIP endpoint (PBX, softphone, or SBC) to register with the trunk.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-registration-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` and initialize the Telnyx client using the Ruby SDK pattern. Define helper functions to manage SIP connections:

```ruby
require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize Telnyx client with API key from environment
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# Helper function to create a SIP connection with credential authentication
def create_sip_connection(client, name, username, password, endpoint_ip)
  """Create a SIP connection for credential-based registration."""
  response = client.sip_connections.create(
    name: name,
    outbound_voice_profile_id: nil,  # Optional: assign later if needed
    inbound_addresses: [endpoint_ip],  # IP address of your SIP endpoint
    outbound_addresses: [endpoint_ip],
    credentials: [
      {
        username: username,
        password: password
      }
    ]
  )
  
  # Extract serializable data — SDK objects are NOT JSON-serializable
  {
    id: response.data.id,
    name: response.data.name,
    username: response.data.credentials&.first&.username,
    inbound_addresses: response.data.inbound_addresses,
    outbound_addresses: response.data.outbound_addresses,
    created_at: response.data.created_at
  }
end

# Helper function to list all SIP connections
def list_sip_connections(client)
  """Retrieve all SIP connections for the account."""
  response = client.sip_connections.list
  
  # Map SDK objects to plain hashes for JSON serialization
  response.data.map do |connection|
    {
      id: connection.id,
      name: connection.name,
      username: connection.credentials&.first&.username,
      inbound_addresses: connection.inbound_addresses,
      outbound_addresses: connection.outbound_addresses,
      created_at: connection.created_at
    }
  end
end

# Helper function to retrieve a specific SIP connection
def get_sip_connection(client, connection_id)
  """Fetch details of a single SIP connection."""
  response = client.sip_connections.retrieve(connection_id)
  
  {
    id: response.data.id,
    name: response.data.name,
    username: response.data.credentials&.first&.username,
    inbound_addresses: response.data.inbound_addresses,
    outbound_addresses: response.data.outbound_addresses,
    created_at: response.data.created_at
  }
end

# Sinatra route to create a new SIP connection
post "/sip/connections" do
  content_type :json
  
  data = JSON.parse(request.body.read)
  
  # Validate required fields
  unless data["name"] && data["username"] && data["password"] && data["endpoint_ip"]
    return [400, { error: "Missing required fields: name, username, password, endpoint_ip" }.to_json]
  end
  
  begin
    result = create_sip_connection(
      client,
      data["name"],
      data["username"],
      data["password"],
      data["endpoint_ip"]
    )
    [201, result.to_json]
    
  rescue Telnyx::AuthenticationError
    [401, { error: "Invalid API key" }.to_json]
  rescue Telnyx::RateLimitError
    [429, { error: "Rate limit exceeded. Please slow down." }.to_json]
  rescue Telnyx::APIStatusError => e
    [e.status_code, { error: e.message, status_code: e.status_code }.to_json]
  rescue Telnyx::APIConnectionError
    [503, { error: "Network error connecting to Telnyx" }.to_json]
  rescue StandardError => e
    [400, { error: e.message }.to_json]
  end
end

# Sinatra route to list all SIP connections
get "/sip/connections" do
  content_type :json
  
  begin
    result = list_sip_connections(client)
    [200, result.to_json]
    
  rescue Telnyx::AuthenticationError
    [401, { error: "Invalid API key" }.to_json]
  rescue Telnyx::RateLimitError
    [429, { error: "Rate limit exceeded. Please slow down." }.to_json]
  rescue Telnyx::APIStatusError => e
    [e.status_code, { error: e.message, status_code: e.status_code }.to_json]
  rescue Telnyx::APIConnectionError
    [503, { error: "Network error connecting to Telnyx" }.to_json]
  rescue StandardError => e
    [400, { error: e.message }.to_json]
  end
end

# Sinatra route to retrieve a specific SIP connection
get "/sip/connections/:id" do
  content_type :json
  
  connection_id = params["id"]
  
  begin
    result = get_sip_connection(client, connection_id)
    [200, result.to_json]
    
  rescue Telnyx::AuthenticationError
    [401, { error: "Invalid API key" }.to_json]
  rescue Telnyx::RateLimitError
    [429, { error: "Rate limit exceeded. Please slow down." }.to_json]
  rescue Telnyx::APIStatusError => e
    [e.status_code, { error: e.message, status_code: e.status_code }.to_json]
  rescue Telnyx::APIConnectionError
    [503, { error: "Network error connecting to Telnyx" }.to_json]
  rescue StandardError => e
    [400, { error: e.message }.to_json]
  end
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-registration-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Sinatra server. |
| SIP Connection Creation Fails | You receive a 400 error or the connection is not created with the expected credentials. | Confirm all required fields are present in your POST request: `name`, `username`, `password`, and `endpoint_ip`. Verify the `endpoint_ip` is reachable and valid. Ensure your SIP endpoint is configured to accept inbound connections from Telnyx's SIP proxy (sip.telnyx.com). |
| Environment Variable Not Set | The application raises an error about missing `TELNYX_API_KEY` on startup. | Confirm your `.env` file exists in the same directory as `app.rb` and contains the variable. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `require "dotenv/load"` statement must execute before the client is initialized. Restart the Sinatra server after updating the `.env` file. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SIP example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What Ruby version do I need?**

Ruby 3.1 or higher. Ruby 3.3 is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [SIP Trunking Get Started](https://developers.telnyx.com/docs/voice/sip-trunking/get-started)
- [SIP Configuration Guides](https://developers.telnyx.com/docs/voice/sip-trunking/configuration-guides)
- [Ruby SDK](https://developers.telnyx.com/development/sdk/ruby)
- [Telnyx SIP Trunks](https://telnyx.com/products/sip-trunks)
- [SIP Trunking Pricing](https://telnyx.com/pricing/elastic-sip)

## Related Examples

- [Set Up SIP Trunking](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/ruby/sip-trunking-setup).
- [Configure Failover Routing](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/ruby/failover-routing).
- [Make an Outbound SIP Call](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/ruby/outbound-sip-call).
