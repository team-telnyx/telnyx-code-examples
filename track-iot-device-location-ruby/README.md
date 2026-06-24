# Device Location with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready Sinatra application that tracks SIM card device locations using the Telnyx IoT API. This tutorial demonstrates how to query SIM card network attachment data, handle location webhooks, and display real-time device positions on a map. You'll learn the new SDK initialization pattern, proper error handling for IoT operations, and secure credential management via environment variables.

## Who Is This For?

- **Ruby developers** building iot features with Sinatra.
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
- Active SIM cards with network connectivity.
- Bundler (Ruby dependency manager).
- A publicly accessible URL for webhook testing (ngrok or similar).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/track-iot-device-location-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` with helper functions to query SIM card location data and manage webhooks:

```ruby
require_relative "config"

# Helper function to retrieve SIM card details with network attachment info
def get_sim_location(sim_card_id)
  begin
    response = Telnyx::SimCard.retrieve(sim_card_id)
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    {
      id: response.id,
      iccid: response.iccid,
      status: response.status,
      sim_card_group_id: response.sim_card_group_id,
      phone_number: response.phone_number,
      # Network attachment data (when available from webhooks or polling)
      network_attached: response.network_attached,
      last_seen_at: response.last_seen_at,
    }
  rescue Telnyx::AuthenticationError
    raise "Invalid API key"
  rescue Telnyx::APIStatusError => e
    raise "API error: #{e.message}"
  end
end

# Helper function to list all SIM cards with their status
def list_sim_cards_with_status
  begin
    response = Telnyx::SimCard.list
    
    # Map SDK objects to plain hashes for JSON serialization
    response.data.map do |sim|
      {
        id: sim.id,
        iccid: sim.iccid,
        status: sim.status,
        phone_number: sim.phone_number,
        sim_card_group_id: sim.sim_card_group_id,
        network_attached: sim.network_attached,
      }
    end
  rescue Telnyx::AuthenticationError
    raise "Invalid API key"
  rescue Telnyx::APIStatusError => e
    raise "API error: #{e.message}"
  end
end

# Sinatra route to retrieve a single SIM card's location
get "/api/sim/:id/location" do
  content_type :json
  sim_id = params[:id]
  
  begin
    location_data = get_sim_location(sim_id)
    location_data.to_json
  rescue Telnyx::AuthenticationError
    status 401
    { error: "Invalid API key" }.to_json
  rescue Telnyx::RateLimitError
    status 429
    { error: "Rate limit exceeded. Please slow down." }.to_json
  rescue Telnyx::APIStatusError => e
    status e.status_code || 500
    { error: e.message, status_code: e.status_code }.to_json
  rescue Telnyx::APIConnectionError
    status 503
    { error: "Network error connecting to Telnyx" }.to_json
  rescue StandardError => e
    status 400
    { error: e.message }.to_json
  end
end

# Sinatra route to list all SIM cards with location status
get "/api/sim/list" do
  content_type :json
  
  begin
    sims = list_sim_cards_with_status
    { data: sims }.to_json
  rescue Telnyx::AuthenticationError
    status 401
    { error: "Invalid API key" }.to_json
  rescue Telnyx::RateLimitError
    status 429
    { error: "Rate limit exceeded. Please slow down." }.to_json
  rescue Telnyx::APIStatusError => e
    status e.status_code || 500
    { error: e.message, status_code: e.status_code }.to_json
  rescue Telnyx::APIConnectionError
    status 503
    { error: "Network error connecting to Telnyx" }.to_json
  rescue StandardError => e
    status 400
    { error: e.message }.to_json
  end
end

# Webhook endpoint to receive SIM card network attachment events
post "/webhooks/sim-location" do
  content_type :json
  
  begin
    payload = JSON.parse(request.body.read)
    event_type = payload["data"]["event_type"]
    
    case event_type
    when "sim_card.network.attached"
      # Device connected to network — extract location metadata
      sim_id = payload["data"]["sim_card_id"]
      network_info = payload["data"]["network_info"]
      
      # Log or store location data (example: write to database)
      puts "SIM #{sim_id} attached to network: #{network_info}"
      
      { status: "received", event: event_type }.to_json
      
    when "sim_card.status.changed"
      # SIM status changed (activated/deactivated)
      sim_id = payload["data"]["sim_card_id"]
      new_status = payload["data"]["status"]
      
      puts "SIM #{sim_id} status changed to: #{new_status}"
      
      { status: "received", event: event_type }.to_json
      
    else
      # Unknown event type
      { status: "received", event: event_type }.to_json
    end
  rescue JSON::ParserError
    status 400
    { error: "Invalid JSON payload" }.to_json
  rescue StandardError => e
    status 500
    { error: "Webhook processing error: #{e.message}" }.to_json
  end
end

# Health check endpoint
get "/health" do
  content_type :json
  { status: "ok" }.to_json
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/track-iot-device-location-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error":"Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Sinatra server after updating the `.env` file. Use `echo $TELNYX_API_KEY` to confirm the environment variable is loaded. |
| SIM Card Not Found (404) | You receive a 400 error stating the SIM card ID does not exist. | Verify the SIM card ID is correct by listing all SIM cards with `GET /api/sim/list`. Ensure the SIM card is active and provisioned in your Telnyx account. Check the [Telnyx Portal](https://portal.telnyx.com) under IoT → SIM Cards to confirm the ID. |
| Webhook Not Receiving Events | The webhook endpoint is not receiving network attachment events from Telnyx. | Confirm your webhook URL is publicly accessible using `curl -X POST https://your-url/webhooks/sim-location -d '{}'`. Use ngrok to expose your local server: `ngrok http 4567`. Update the webhook URL in the Telnyx Portal under IoT → Webhooks. Ensure your firewall allows inbound HTTPS traffic on port 443. Check server logs for incoming requests using `tail -f app.log`. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error":"Rate limit exceeded. Please slow down."}` with HTTP 429. | Implement exponential backoff in your client code. Wait 1 second before retrying, then double the wait time on each subsequent retry (1s, 2s, 4s, etc.). Batch SIM card queries to reduce API calls. Consider caching location data for 30–60 seconds if real-time updates are not critical. |
| Network Connection Error (503) | The endpoint returns `{"error":"Network error connecting to Telnyx"}` with HTTP 503. | Verify your internet connection is stable. Check if the Telnyx API is operational by visiting the [Telnyx Status Page](https://status.telnyx.com). Ensure your firewall allows outbound HTTPS traffic to `api.telnyx.com`. If behind a corporate proxy, configure the Telnyx SDK to use the proxy settings. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this IoT example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What Ruby version do I need?**

Ruby 3.1 or higher. Ruby 3.3 is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [IoT SIM Get Started](https://developers.telnyx.com/docs/iot-sim/get-started)
- [SIM Card API Reference](https://developers.telnyx.com/api-reference/sim-cards/get-all-sim-cards)
- [Ruby SDK](https://developers.telnyx.com/development/sdk/ruby)
- [Telnyx IoT SIM Cards](https://telnyx.com/products/iot-sim-card)
- [IoT Data Plans Pricing](https://telnyx.com/pricing/iot-data-plans)

## Related Examples

- [Activate SIM Cards with Ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/ruby/sim-activation).
- [Monitor SIM Card Data Usage](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/ruby/data-usage-monitoring).
- [Handle SIM Status Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/ruby/sim-status-webhook).
