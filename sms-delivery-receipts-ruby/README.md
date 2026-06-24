# Delivery Receipts with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready Sinatra application that sends SMS messages and receives delivery receipts via webhooks using the Telnyx Ruby SDK. This tutorial demonstrates webhook configuration, message status tracking, and proper error handling for production SMS workflows where knowing delivery status is critical.

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
- A Telnyx phone number enabled for outbound SMS.
- A publicly accessible URL for webhook delivery (use ngrok for local development).
- Bundler (Ruby dependency manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-delivery-receipts-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-delivery-receipts-ruby
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` with the Sinatra application, Telnyx client initialization, and webhook handling:

```ruby
require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize Telnyx client with the new SDK pattern
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# In-memory store for message tracking (use a database in production)
$message_store = {}

# Helper function to send SMS and track delivery
def send_sms_with_tracking(to_number, message_text)
  from_number = ENV["TELNYX_PHONE_NUMBER"]
  raise "TELNYX_PHONE_NUMBER environment variable not set" unless from_number

  # Validate E.164 format to prevent API errors
  raise "Phone number must be in E.164 format (e.g., +15551234567)" unless to_number.start_with?("+")

  # Create message via Telnyx API
  response = client.messages.create(
    from_: from_number,
    to: to_number,
    text: message_text
  )

  # Extract serializable data — SDK objects are NOT JSON-serializable
  message_data = {
    message_id: response.data.id,
    to: to_number,
    from: from_number,
    text: message_text,
    status: response.data.to&.first&.status || "pending",
    created_at: Time.now.iso8601,
    delivery_status: "queued"
  }

  # Store message for webhook tracking
  $message_store[response.data.id] = message_data

  message_data
end

# Sinatra route to send SMS
post "/sms/send" do
  content_type :json

  # Parse request body
  begin
    data = JSON.parse(request.body.read)
  rescue JSON::ParserError
    return [400, { error: "Invalid JSON in request body" }.to_json]
  end

  to_number = data["to"]
  message_text = data["message"]

  # Validate required fields
  unless to_number && message_text
    return [400, { error: "Missing required fields: 'to' and 'message'" }.to_json]
  end

  begin
    result = send_sms_with_tracking(to_number, message_text)
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

# Webhook endpoint to receive delivery receipts
post "/webhooks/message" do
  content_type :json

  # Parse webhook payload
  begin
    payload = JSON.parse(request.body.read)
  rescue JSON::ParserError
    return [400, { error: "Invalid JSON in webhook payload" }.to_json]
  end

  # Extract event data
  event_type = payload["data"]&.dig("event_type")
  message_id = payload["data"]&.dig("id")
  status = payload["data"]&.dig("to")&.first&.dig("status")

  # Handle message.finalized events (final delivery status)
  if event_type == "message.finalized" && message_id
    if $message_store[message_id]
      $message_store[message_id][:delivery_status] = status || "unknown"
      $message_store[message_id][:finalized_at] = Time.now.iso8601

      # Log delivery receipt for debugging
      puts "Delivery receipt: Message #{message_id} → #{status}"
    end
  end

  # Return 200 OK to acknowledge webhook receipt
  [200, { success: true }.to_json]
end

# Route to check message delivery status
get "/messages/:message_id" do
  content_type :json

  message_id = params["message_id"]
  message = $message_store[message_id]

  if message
    [200, message.to_json]
  else
    [404, { error: "Message not found" }.to_json]
  end
end

# Health check endpoint
get "/health" do
  content_type :json
  [200, { status: "ok" }.to_json]
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-delivery-receipts-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not receiving events | The `/webhooks/message` endpoint is not being called after sending SMS. | Verify that your Messaging Profile in the [Telnyx Portal](https://portal.telnyx.com) has the webhook URL configured correctly. Ensure the URL is publicly accessible (test with `curl https://your-ngrok-url.ngrok.io/health`). Check that ngrok is still running and the tunnel is active. Confirm the webhook URL in your `.env` file matches the ngrok URL exactly. |
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Sinatra server. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Message status stuck on "queued" | The delivery status never updates from "queued" to "delivered" or "failed". | Confirm the webhook endpoint is receiving the `message.finalized` event by checking server logs. Verify the Messaging Profile webhook URL is correct in the Telnyx Portal. Check that the message was actually sent by reviewing the Telnyx Portal message logs. If using a test number, ensure it is a valid, active phone number. |
| Sinatra server won't start | Error like "Address already in use" or port 4567 is unavailable. | Kill the existing process using port 4567 with `lsof -ti:4567 \| xargs kill -9` on macOS/Linux, or use a different port by running `ruby app.rb -p 5000`. Ensure no other Sinatra instances are running. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

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

- [Send Bulk SMS Messages](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/ruby/send-bulk-sms).
- [Receive SMS Webhooks with Ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/ruby/receive-sms-webhook).
- [Implement Two-Factor Authentication with SMS](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/ruby/otp-2fa).
