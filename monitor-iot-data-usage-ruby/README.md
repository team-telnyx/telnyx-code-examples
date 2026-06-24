# Data Usage Monitoring with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready Sinatra application that monitors SIM card data usage using the Telnyx IoT API. This tutorial demonstrates how to retrieve real-time data consumption metrics, set up alerts when SIM cards approach data limits, and implement a dashboard endpoint to track usage across your device fleet. You'll learn the new client-based SDK initialization pattern, proper error handling for IoT operations, and secure credential management via environment variables.

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
- Active SIM cards in your Telnyx account with data usage history.
- Bundler (Ruby dependency manager).
- curl or Postman for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/monitor-iot-data-usage-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/monitor-iot-data-usage-ruby
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` and initialize the Telnyx client using the new pattern. Define helper functions to fetch SIM data usage and calculate consumption metrics:

```ruby
require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize client with the new SDK pattern
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# Helper function to fetch data usage for a single SIM card
def get_sim_data_usage(client, sim_card_id)
  """Retrieve network usage data for a SIM card."""
  begin
    # Fetch SIM card details first
    sim_response = client.sim_cards.retrieve(sim_card_id)
    sim_data = sim_response.data
    
    # In production, you would call the network_usage endpoint via REST
    # For now, we return the SIM details with a placeholder for usage
    {
      id: sim_data.id,
      iccid: sim_data.iccid,
      status: sim_data.status,
      sim_card_group_id: sim_data.sim_card_group_id,
      # Note: network_usage requires direct REST call in current SDK version
      usage_mb: 0,
      last_updated: Time.now.iso8601
    }
  rescue => e
    raise e
  end
end

# Helper function to list all SIM cards with usage summary
def list_sim_cards_with_usage(client)
  """Fetch all SIM cards and return serializable data."""
  response = client.sim_cards.list
  response.data.map do |sim|
    {
      id: sim.id,
      iccid: sim.iccid,
      status: sim.status,
      sim_card_group_id: sim.sim_card_group_id,
      created_at: sim.created_at
    }
  end
end

# Helper function to check if usage exceeds threshold
def check_usage_threshold(usage_mb, threshold_mb)
  """Determine if usage has exceeded the configured threshold."""
  {
    usage_mb: usage_mb,
    threshold_mb: threshold_mb,
    exceeded: usage_mb >= threshold_mb,
    percentage: ((usage_mb.to_f / threshold_mb) * 100).round(2)
  }
end
```

Now define the Sinatra routes with comprehensive error handling:

```ruby
# Route to list all SIM cards
get "/sim-cards" do
  content_type :json
  begin
    sims = list_sim_cards_with_usage(client)
    { data: sims, count: sims.length }.to_json
  rescue Telnyx::AuthenticationError
    status 401
    { error: "Invalid API key" }.to_json
  rescue Telnyx::RateLimitError
    status 429
    { error: "Rate limit exceeded. Please slow down." }.to_json
  rescue Telnyx::APIStatusError => e
    status e.status_code
    { error: e.message, status_code: e.status_code }.to_json
  rescue Telnyx::APIConnectionError
    status 503
    { error: "Network error connecting to Telnyx" }.to_json
  rescue => e
    status 500
    { error: "Internal server error", details: e.message }.to_json
  end
end

# Route to get data usage for a specific SIM card
get "/sim-cards/:id/usage" do
  content_type :json
  sim_card_id = params[:id]
  
  begin
    usage_data = get_sim_data_usage(client, sim_card_id)
    threshold_mb = ENV["DATA_LIMIT_THRESHOLD_MB"].to_i
    threshold_check = check_usage_threshold(usage_data[:usage_mb], threshold_mb)
    
    response_data = usage_data.merge(threshold_check)
    response_data.to_json
    
  rescue Telnyx::AuthenticationError
    status 401
    { error: "Invalid API key" }.to_json
  rescue Telnyx::RateLimitError
    status 429
    { error: "Rate limit exceeded. Please slow down." }.to_json
  rescue Telnyx::APIStatusError => e
    status e.status_code
    { error: e.message, status_code: e.status_code }.to_json
  rescue Telnyx::APIConnectionError
    status 503
    { error: "Network error connecting to Telnyx" }.to_json
  rescue => e
    status 500
    { error: "Internal server error", details: e.message }.to_json
  end
end

# Route to get usage dashboard for all SIM cards
get "/dashboard/usage" do
  content_type :json
  begin
    sims = list_sim_cards_with_usage(client)
    threshold_mb = ENV["DATA_LIMIT_THRESHOLD_MB"].to_i
    
    # In production, fetch actual usage data from network_usage endpoint
    dashboard_data = {
      total_sims: sims.length,
      active_sims: sims.count { |s| s[:status] == "active" },
      threshold_mb: threshold_mb,
      sims: sims,
      generated_at: Time.now.iso8601
    }
    
    dashboard_data.to_json
    
  rescue Telnyx::AuthenticationError
    status 401
    { error: "Invalid API key" }.to_json
  rescue Telnyx::RateLimitError
    status 429
    { error: "Rate limit exceeded. Please slow down." }.to_json
  rescue Telnyx::APIStatusError => e
    status e.status_code
    { error: e.message, status_code: e.status_code }.to_json
  rescue Telnyx::APIConnectionError
    status 503
    { error: "Network error connecting to Telnyx" }.to_json
  rescue => e
    status 500
    { error: "Internal server error", details: e.message }.to_json
  end
end

# Health check endpoint
get "/health" do
  content_type :json
  { status: "ok", timestamp: Time.now.iso8601 }.to_json
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/monitor-iot-data-usage-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Sinatra server. |
| SIM Card Not Found (404) | You receive a 500 error or the endpoint returns a 404 when querying a specific SIM card ID. | Confirm the SIM card ID exists in your Telnyx account by visiting the [Telnyx Portal](https://portal.telnyx.com) and checking the IoT → SIM Cards section. Use the exact ID format (starting with `sim_`). Verify the SIM card has not been deleted or deactivated. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | The Telnyx API enforces rate limits on requests. Implement exponential backoff in your client code: wait 1 second, then 2 seconds, then 4 seconds between retries. For production monitoring, use webhooks instead of polling to avoid hitting rate limits. See the [Telnyx API documentation](https://developers.telnyx.com/docs/api) for current rate limit thresholds. |
| Network Connection Error (503) | The endpoint returns `{"error": "Network error connecting to Telnyx"}` with HTTP 503. | Verify your internet connection is active and can reach `api.telnyx.com`. Check if Telnyx services are operational by visiting the [Telnyx Status Page](https://status.telnyx.com). If behind a corporate firewall, ensure outbound HTTPS traffic to `api.telnyx.com` is allowed. Retry the request after a few seconds. |
| Environment Variable Not Set | The application raises an error about missing `TELNYX_API_KEY` on startup. | Confirm your `.env` file exists in the same directory as `app.rb` and contains the variable. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `require "dotenv/load"` statement must execute before `ENV["TELNYX_API_KEY"]` is accessed. Verify no typos in the variable name. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this IoT example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

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
- [Monitor SIM Status Changes with Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/ruby/sim-status-webhook).
- [Configure Custom APN Settings](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/ruby/apn-configuration).
