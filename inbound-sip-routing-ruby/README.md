# Inbound SIP Routing with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready Sinatra application that receives inbound SIP calls and routes them to your SIP endpoint using the Telnyx Ruby SDK. This tutorial demonstrates how to configure SIP connections, handle inbound call webhooks, and implement call routing logic with proper error handling and secure credential management.

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
- A Telnyx phone number enabled for inbound voice calls.
- A publicly accessible URL for webhook callbacks (ngrok or similar for local development).
- Bundler (Ruby dependency manager).
- A SIP endpoint (PBX, SBC, or softphone) to receive routed calls.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/inbound-sip-routing-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/inbound-sip-routing-ruby
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` and initialize the Telnyx client using the Ruby SDK pattern. Define helper functions to manage SIP connections and handle inbound call routing:

```ruby
require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize Telnyx client with API key from environment
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# Helper function to retrieve SIP connection details
def get_sip_connection(client, connection_id)
  response = client.sip_connections.retrieve(connection_id)
  {
    id: response.data.id,
    name: response.data.name,
    username: response.data.username,
    sip_uri: response.data.sip_uri,
  }
rescue Telnyx::AuthenticationError
  raise "Invalid API key"
rescue Telnyx::APIStatusError => e
  raise "Failed to retrieve SIP connection: #{e.message}"
end

# Helper function to list all SIP connections
def list_sip_connections(client)
  response = client.sip_connections.list
  response.data.map do |connection|
    {
      id: connection.id,
      name: connection.name,
      username: connection.username,
      sip_uri: connection.sip_uri,
    }
  end
rescue Telnyx::APIStatusError => e
  raise "Failed to list SIP connections: #{e.message}"
end

# Configure Sinatra settings
set :port, 5000
set :bind, "0.0.0.0"

# Health check endpoint
get "/" do
  content_type :json
  { status: "ok", service: "Telnyx SIP Routing" }.to_json
end

# Endpoint to list all SIP connections
get "/sip/connections" do
  content_type :json
  begin
    connections = list_sip_connections(client)
    { data: connections }.to_json
  rescue Telnyx::AuthenticationError
    status 401
    { error: "Invalid API key" }.to_json
  rescue Telnyx::RateLimitError
    status 429
    { error: "Rate limit exceeded. Please slow down." }.to_json
  rescue Telnyx::APIStatusError => e
    status e.status_code || 500
    { error: e.message, status_code: e.status_code }.to_json
  rescue StandardError => e
    status 500
    { error: e.message }.to_json
  end
end

# Endpoint to retrieve a specific SIP connection
get "/sip/connections/:id" do
  content_type :json
  connection_id = params[:id]
  
  begin
    connection = get_sip_connection(client, connection_id)
    connection.to_json
  rescue Telnyx::AuthenticationError
    status 401
    { error: "Invalid API key" }.to_json
  rescue Telnyx::APIStatusError => e
    status e.status_code || 500
    { error: e.message, status_code: e.status_code }.to_json
  rescue StandardError => e
    status 500
    { error: e.message }.to_json
  end
end

# Webhook endpoint to handle inbound call events
post "/webhooks/inbound-call" do
  content_type :json
  
  # Parse incoming webhook payload
  payload = JSON.parse(request.body.read)
  event_type = payload.dig("data", "event_type")
  call_id = payload.dig("data", "call_session_id")
  from_number = payload.dig("data", "from")
  to_number = payload.dig("data", "to")
  
  begin
    case event_type
    when "call.initiated"
      # Log inbound call and route to SIP connection
      puts "Inbound call received: #{from_number} -> #{to_number} (Call ID: #{call_id})"
      
      # Route call to configured SIP endpoint
      sip_connection_id = ENV["SIP_CONNECTION_ID"]
      if sip_connection_id
        puts "Routing call #{call_id} to SIP connection #{sip_connection_id}"
      else
        puts "Warning: SIP_CONNECTION_ID not configured. Call will not be routed."
      end
      
      { status: "routed", call_id: call_id }.to_json
      
    when "call.answered"
      puts "Call answered: #{call_id}"
      { status: "acknowledged", call_id: call_id }.to_json
      
    when "call.hangup"
      puts "Call ended: #{call_id}"
      { status: "acknowledged", call_id: call_id }.to_json
      
    else
      puts "Unhandled event type: #{event_type}"
      { status: "acknowledged", call_id: call_id }.to_json
    end
    
  rescue JSON::ParserError
    status 400
    { error: "Invalid JSON payload" }.to_json
  rescue StandardError => e
    status 500
    { error: "Webhook processing failed: #{e.message}" }.to_json
  end
end

# Error handler for unmatched routes
not_found do
  content_type :json
  { error: "Endpoint not found" }.to_json
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/inbound-sip-routing-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Sinatra server. |
| SIP Connection Not Found | You receive a 500 error stating "Failed to retrieve SIP connection" when accessing `/sip/connections/:id`. | Confirm the connection ID is correct by listing all connections with `GET /sip/connections`. Verify the SIP connection exists in the [Telnyx Portal](https://portal.telnyx.com) under SIP Connections. Ensure your API key has permissions to access SIP resources. |
| Webhook Not Receiving Events | The `/webhooks/inbound-call` endpoint is not being called when inbound calls arrive. | Verify the webhook URL is publicly accessible and matches the URL configured in the Telnyx Portal for your phone number. Use ngrok to expose your local server: `ngrok http 5000`. Update the webhook URL in the Portal to your ngrok URL. Check server logs for incoming POST requests. Ensure your phone number is assigned to a SIP connection that has webhooks enabled. |
| Environment Variables Not Loading | The application raises errors about missing `TELNYX_API_KEY` or other environment variables. | Confirm your `.env` file exists in the same directory as `app.rb` and contains all required variables. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `require "dotenv/load"` statement must execute before environment variables are accessed. Restart the Sinatra server after updating the `.env` file. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SIP example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

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
- [Configure SIP Authentication](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/ruby/sip-authentication).
- [Implement Failover Routing](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/ruby/failover-routing).
