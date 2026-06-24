# MMS Receive with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready Sinatra webhook endpoint that receives inbound MMS messages using the Telnyx Ruby SDK. This tutorial demonstrates webhook configuration, secure credential management via environment variables, and proper error handling for telecom APIs. You'll learn how to parse inbound MMS payloads, extract media attachments, and persist message data for downstream processing.

## Who Is This For?

- **Ruby developers** building sms features with Sinatra.
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
- A Telnyx phone number enabled for inbound MMS.
- Bundler (Ruby dependency manager).
- A publicly accessible URL (ngrok or similar) to expose your local webhook endpoint.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/receive-mms-webhook-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` and initialize the Telnyx client using the Ruby SDK pattern. Define helper functions to parse inbound MMS payloads and extract media attachments:

```ruby
require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize Telnyx client with API key from environment
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# Configure Sinatra
set :port, 3000
set :bind, "0.0.0.0"

# Helper function to extract media URLs from MMS payload
def extract_media_from_payload(payload)
  """Extract media URLs and metadata from inbound MMS webhook payload."""
  media = []
  
  if payload["data"] && payload["data"]["media"]
    payload["data"]["media"].each do |media_item|
      media << {
        url: media_item["url"],
        mime_type: media_item["mime_type"],
        size: media_item["size"]
      }
    end
  end
  
  media
end

# Helper function to parse inbound MMS message
def parse_inbound_mms(payload)
  """Parse webhook payload and return structured message data."""
  data = payload["data"]
  
  {
    message_id: data["id"],
    from: data["from"]["phone_number"],
    to: data["to"][0]["phone_number"],
    text: data["text"],
    media: extract_media_from_payload(payload),
    received_at: data["received_at"],
    direction: data["direction"]
  }
end

# Webhook endpoint to receive inbound MMS
post "/webhooks/message" do
  content_type :json
  
  # Parse incoming JSON payload
  payload = JSON.parse(request.body.read)
  
  # Validate webhook event type
  unless payload["type"] == "message.received"
    return { error: "Unsupported event type" }.to_json
  end
  
  begin
    # Parse the inbound MMS message
    message_data = parse_inbound_mms(payload)
    
    # Log the received message (in production, persist to database)
    puts "Received MMS from #{message_data[:from]}"
    puts "Message ID: #{message_data[:message_id]}"
    puts "Media count: #{message_data[:media].length}"
    
    # Return success response to acknowledge webhook receipt
    status 200
    { 
      success: true, 
      message_id: message_data[:message_id],
      media_count: message_data[:media].length
    }.to_json
    
  rescue Telnyx::AuthenticationError
    status 401
    { error: "Invalid API key" }.to_json
  rescue Telnyx::APIStatusError => e
    status e.status_code || 400
    { error: e.message, status_code: e.status_code }.to_json
  rescue Telnyx::APIConnectionError
    status 503
    { error: "Network error connecting to Telnyx" }.to_json
  rescue StandardError => e
    status 400
    { error: e.message }.to_json
  end
end

# Health check endpoint
get "/health" do
  content_type :json
  { status: "ok" }.to_json
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-mms-webhook-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not receiving events | Your endpoint is configured in the Telnyx Portal but no POST requests arrive. | Verify the webhook URL is publicly accessible and uses HTTPS. Test with `curl -X POST https://your-domain.com/webhooks/message -H "Content-Type: application/json" -d '{"type":"message.received","data":{"id":"test"}}'`. Ensure your Messaging Profile has the webhook URL configured and is subscribed to `message.received` events. Check your firewall and reverse proxy settings if using ngrok. |
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Sinatra server after updating the `.env` file. The `dotenv/load` require statement must execute before the client is initialized. |
| Media URLs are nil or empty | The webhook payload arrives but `media` array is empty or media URLs are missing. | Confirm the MMS was sent with attachments (not just text). Verify the webhook payload structure matches Telnyx's schema—media items should be nested under `data.media`. Log the full payload with `puts payload.inspect` to debug. Ensure your Telnyx phone number is configured to receive MMS (some regions or number types may not support MMS). |
| Sinatra server fails to start | You see `Address already in use` or binding errors on port 3000. | Change the port in `app.rb` with `set :port, 3001` or kill the existing process with `lsof -i :3000` and `kill -9 <PID>`. Ensure no other services are using port 3000. If using ngrok, verify the local port matches the one Sinatra is bound to. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What Ruby version do I need?**

Ruby 3.1 or higher. Ruby 3.3 is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Ruby SDK](https://developers.telnyx.com/development/sdk/ruby)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)

## Related Examples

- [Receive SMS Webhooks with Ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/ruby/receive-sms-webhook).
- [Send Bulk SMS Messages with Ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/ruby/send-bulk-sms).
- [Implement Two-Factor Authentication with SMS](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/ruby/otp-2fa).
