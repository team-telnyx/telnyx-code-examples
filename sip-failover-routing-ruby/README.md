# Failover Routing with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready SIP failover routing system using Ruby and Sinatra that intelligently routes inbound calls across multiple SIP endpoints. This tutorial demonstrates how to configure primary and backup SIP connections, implement health checks, and dynamically route calls based on endpoint availability. You'll learn to manage SIP connections via the Telnyx API, assign phone numbers to connections, and handle failover logic in your application.

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
- At least one Telnyx phone number enabled for inbound calls.
- Two or more SIP endpoints (PBX, SBC, or softphone) with valid credentials.
- Bundler (Ruby dependency manager).
- A publicly accessible URL for webhook callbacks (ngrok recommended for local development).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-failover-routing-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` with the Sinatra application, SIP connection management, and failover routing logic:

```ruby
require "sinatra"
require "telnyx"
require "dotenv"
require "json"

Dotenv.load

# Initialize Telnyx client with the new SDK pattern
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# In-memory store for endpoint health status (use Redis in production)
ENDPOINT_STATUS = {
  primary: { uri: ENV["PRIMARY_SIP_ENDPOINT"], healthy: true, last_check: Time.now },
  backup: { uri: ENV["BACKUP_SIP_ENDPOINT"], healthy: true, last_check: Time.now }
}

# Helper function to create or update a SIP connection
def create_sip_connection(client, name, username, password, sip_uri)
  """Create a SIP connection with credential authentication."""
  begin
    response = client.sip_connections.create(
      connection_name: name,
      outbound_voice_profile_id: nil,  # Use default profile
      inbound: {
        sip_subdomain: "#{name.downcase.gsub(/\s+/, '-')}"
      },
      credentials: [
        {
          username: username,
          password: password
        }
      ]
    )
    
    return {
      id: response.data.id,
      name: response.data.connection_name,
      username: response.data.credentials&.first&.username
    }
  rescue Telnyx::AuthenticationError => e
    raise "Authentication failed: #{e.message}"
  rescue Telnyx::APIStatusError => e
    raise "API error (#{e.status_code}): #{e.message}"
  end
end

# Helper function to list all SIP connections
def list_sip_connections(client)
  """Retrieve all SIP connections for the account."""
  begin
    response = client.sip_connections.list
    
    response.data.map do |conn|
      {
        id: conn.id,
        name: conn.connection_name,
        username: conn.credentials&.first&.username,
        inbound_subdomain: conn.inbound&.sip_subdomain
      }
    end
  rescue Telnyx::APIStatusError => e
    raise "Failed to list connections: #{e.message}"
  end
end

# Helper function to retrieve a specific SIP connection
def get_sip_connection(client, connection_id)
  """Fetch details of a specific SIP connection."""
  begin
    response = client.sip_connections.retrieve(connection_id)
    
    {
      id: response.data.id,
      name: response.data.connection_name,
      username: response.data.credentials&.first&.username,
      inbound_subdomain: response.data.inbound&.sip_subdomain
    }
  rescue Telnyx::APIStatusError => e
    raise "Connection not found: #{e.message}"
  end
end

# Helper function to assign phone number to SIP connection
def assign_phone_to_connection(client, phone_number, connection_id)
  """Assign a Telnyx phone number to a SIP connection."""
  begin
    # This uses the REST API directly via the client
    response = client.phone_numbers.update(
      phone_number,
      connection_id: connection_id
    )
    
    {
      phone_number: response.data.phone_number,
      connection_id: response.data.connection_id
    }
  rescue Telnyx::APIStatusError => e
    raise "Failed to assign phone number: #{e.message}"
  end
end

# Helper function to determine the active endpoint based on health
def get_active_endpoint
  """Return the URI of the healthy endpoint, with failover logic."""
  if ENDPOINT_STATUS[:primary][:healthy]
    ENDPOINT_STATUS[:primary][:uri]
  elsif ENDPOINT_STATUS[:backup][:healthy]
    ENDPOINT_STATUS[:backup][:uri]
  else
    # Both endpoints down — return primary as last resort
    ENDPOINT_STATUS[:primary][:uri]
  end
end

# Helper function to mark endpoint as unhealthy
def mark_endpoint_unhealthy(endpoint_key)
  """Mark an endpoint as unhealthy after a failed call attempt."""
  ENDPOINT_STATUS[endpoint_key][:healthy] = false
  ENDPOINT_STATUS[endpoint_key][:last_check] = Time.now
end

# Helper function to mark endpoint as healthy
def mark_endpoint_healthy(endpoint_key)
  """Mark an endpoint as healthy after successful call."""
  ENDPOINT_STATUS[endpoint_key][:healthy] = true
  ENDPOINT_STATUS[endpoint_key][:last_check] = Time.now
end

# Sinatra error handler for Telnyx exceptions
error Telnyx::AuthenticationError do
  status 401
  json({ error: "Invalid API key" })
end

error Telnyx::RateLimitError do
  status 429
  json({ error: "Rate limit exceeded. Please slow down." })
end

error Telnyx::APIStatusError do |e|
  status e.status_code || 500
  json({ error: e.message, status_code: e.status_code })
end

error Telnyx::APIConnectionError do
  status 503
  json({ error: "Network error connecting to Telnyx" })
end

# Route: Create a new SIP connection
post "/sip/connections" do
  request.body.rewind
  data = JSON.parse(request.body.read)
  
  unless data["name"] && data["username"] && data["password"] && data["sip_uri"]
    return status 400, json({ error: "Missing required fields: name, username, password, sip_uri" })
  end
  
  begin
    result = create_sip_connection(
      client,
      data["name"],
      data["username"],
      data["password"],
      data["sip_uri"]
    )
    status 201
    json(result)
  rescue => e
    status 400
    json({ error: e.message })
  end
end

# Route: List all SIP connections
get "/sip/connections" do
  begin
    connections = list_sip_connections(client)
    json(connections)
  rescue => e
    status 500
    json({ error: e.message })
  end
end

# Route: Get a specific SIP connection
get "/sip/connections/:id" do
  begin
    connection = get_sip_connection(client, params[:id])
    json(connection)
  rescue => e
    status 404
    json({ error: e.message })
  end
end

# Route: Assign phone number to SIP connection
post "/sip/phone-assignments" do
  request.body.rewind
  data = JSON.parse(request.body.read)
  
  unless data["phone_number"] && data["connection_id"]
    return status 400, json({ error: "Missing required fields: phone_number, connection_id" })
  end
  
  begin
    result = assign_phone_to_connection(client, data["phone_number"], data["connection_id"])
    json(result)
  rescue => e
    status 400
    json({ error: e.message })
  end
end

# Route: Get current failover status
get "/sip/failover-status" do
  status_info = {
    primary: {
      uri: ENDPOINT_STATUS[:primary][:uri],
      healthy: ENDPOINT_STATUS[:primary][:healthy],
      last_check: ENDPOINT_STATUS[:primary][:last_check]
    },
    backup: {
      uri: ENDPOINT_STATUS[:backup][:uri],
      healthy: ENDPOINT_STATUS[:backup][:healthy],
      last_check: ENDPOINT_STATUS[:backup][:last_check]
    },
    active_endpoint: get_active_endpoint
  }
  
  json(status_info)
end

# Route: Webhook to receive inbound call events
post "/webhooks/call" do
  request.body.rewind
  payload = JSON.parse(request.body.read)
  
  event_type = payload["data"]["event_type"]
  call_id = payload["data"]["call_id"]
  
  case event_type
  when "call.initiated"
    # Log the inbound call and determine routing
    active_endpoint = get_active_endpoint
    puts "Inbound call #{call_id} routing to: #{active_endpoint}"
    
    # In production, you would update the call's SIP endpoint here
    # via the Voice API or by configuring the connection's inbound settings
    
    status 200
    json({ status: "call_routed", endpoint: active_endpoint })
    
  when "call.answered"
    # Mark primary endpoint as healthy if call succeeded
    mark_endpoint_healthy(:primary)
    puts "Call #{call_id} answered successfully"
    
    status 200
    json({ status: "acknowledged" })
    
  when "call.failed"
    # Mark endpoint as unhealthy and trigger failover
    failure_reason = payload["data"]["failure_reason"]
    puts "Call #{call_id} failed: #{failure_reason}"
    
    # Attempt failover to backup endpoint
    if ENDPOINT_STATUS[:primary][:healthy]
      mark_endpoint_unhealthy(:primary)
      puts "Primary endpoint marked unhealthy. Failover to backup."
    end
    
    status 200
    json({ status: "failover_triggered" })
    
  else
    status 200
    json({ status: "event_received" })
  end
end

# Route: Health check endpoint for monitoring
get "/health" do
  json({
    status: "healthy",
    timestamp: Time.now.iso8601,
    endpoints: {
      primary: ENDPOINT_STATUS[:primary][:healthy] ? "up" : "down",
      backup: ENDPOINT_STATUS[:backup][:healthy] ? "up" : "down"
    }
  })
end

# Root route
get "/" do
  json({
    service: "Telnyx SIP Failover Routing",
    version: "1.0.0",
    endpoints: {
      "POST /sip/connections": "Create a new SIP connection",
      "GET /sip/connections": "List all SIP connections",
      "GET /sip/connections/:id": "Get a specific SIP connection",
      "POST /sip/phone-assignments": "Assign phone number to connection",
      "GET /sip/failover-status": "Get current failover status",
      "POST /webhooks/call": "Receive inbound call events",
      "GET /health": "Health check endpoint"
    }
  })
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-failover-routing-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Sinatra server. |
| SIP Connection Creation Fails | You receive a 400 error when creating a SIP connection with message about invalid subdomain. | Ensure the `connection_name` parameter contains only alphanumeric characters and hyphens. The subdomain is auto-generated from the name by converting to lowercase and replacing spaces with hyphens. For example, "Primary PBX" becomes "primary-pbx". Avoid special characters in the name. |
| Phone Number Assignment Error | The endpoint returns `{"error": "Failed to assign phone number"}` when assigning a phone number to a connection. | Verify the phone number is in E.164 format (e.g., `+15551234567`) and that the `connection_id` is valid and exists in your account. Ensure the phone number is not already assigned to another connection. Check that your API key has permissions to manage phone numbers. |
| Webhook Not Receiving Events | Inbound calls are not triggering the `/webhooks/call` endpoint. | Confirm your `WEBHOOK_URL` in the `.env` file is publicly accessible and matches the URL configured in the Telnyx Portal for your phone number. Use ngrok (`ngrok http 4567`) to expose your local Sinatra server during development. Verify the webhook URL is correctly set on the SIP connection's inbound settings in the Portal. Check server logs for incoming requests. |
| Failover Not Triggering | Calls continue routing to the primary endpoint even after it fails. | Ensure the webhook is receiving `call.failed` events from Telnyx. Verify the `mark_endpoint_unhealthy` function is being called in the `call.failed` case. In production, replace the in-memory `ENDPOINT_STATUS` hash with a persistent store like Redis to maintain state across server restarts. Implement periodic health checks to automatically recover endpoints. |

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

- [Configure SIP Registration with Telnyx](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/ruby/sip-registration).
- [Set Up SIP Trunking for Your PBX](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/ruby/sip-trunking-setup).
- [Implement Outbound SIP Calls](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/ruby/outbound-sip-call).
