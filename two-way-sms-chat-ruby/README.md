# Two Way SMS with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready Sinatra application that sends and receives SMS messages using the Telnyx Ruby SDK. This tutorial demonstrates bidirectional messaging, webhook handling for inbound SMS, proper error handling for telecom APIs, and secure credential management via environment variables.

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
- A Telnyx phone number enabled for inbound and outbound SMS.
- A publicly accessible URL for webhook delivery (ngrok for local development).
- Bundler (Ruby dependency manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/two-way-sms-chat-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/two-way-sms-chat-ruby
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` and initialize the Telnyx client using the Ruby SDK pattern. Define helper functions to handle message creation and webhook processing:

```ruby
require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize Telnyx client with API key from environment
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# Helper function to send SMS
def send_sms(to_number, message, client)
  from_number = ENV["TELNYX_PHONE_NUMBER"]
  
  raise "TELNYX_PHONE_NUMBER environment variable not set" unless from_number
  
  # Validate E.164 format to prevent API errors
  raise "Phone number must be in E.164 format (e.g., +15551234567)" unless to_number.start_with?("+")
  
  # Create message via Telnyx API
  response = client.messages.create(
    from_: from_number,
    to: to_number,
    text: message
  )
  
  # Extract serializable data — SDK objects are NOT JSON-serializable
  {
    message_id: response.data.id,
    status: response.data.to&.first&.status || "unknown",
    from: from_number,
    to: to_number
  }
end

# Helper function to process inbound webhook
def process_inbound_message(payload)
  # Extract message details from webhook payload
  {
    message_id: payload["data"]["id"],
    from: payload["data"]["from"]["phone_number"],
    to: payload["data"]["to"]&.first&.phone_number,
    text: payload["data"]["text"],
    received_at: payload["data"]["received_at"],
    direction: payload["data"]["direction"]
  }
end

# Route to send SMS
post "/sms/send" do
  content_type :json
  
  data = JSON.parse(request.body.read)
  
  to_number = data["to"]
  message = data["message"]
  
  return [400, { error: "Missing required fields: 'to' and 'message'" }.to_json].to_a unless to_number && message
  
  begin
    result = send_sms(to_number, message, client)
    [200, result.to_json].to_a
    
  rescue Telnyx::AuthenticationError
    [401, { error: "Invalid API key" }.to_json].to_a
  rescue Telnyx::RateLimitError
    [429, { error: "Rate limit exceeded. Please slow down." }.to_json].to_a
  rescue Telnyx::APIStatusError => e
    [e.status_code, { error: e.message, status_code: e.status_code }.to_json].to_a
  rescue Telnyx::APIConnectionError
    [503, { error: "Network error connecting to Telnyx" }.to_json].to_a
  rescue StandardError => e
    [400, { error: e.message }.to_json].to_a
  end
end

# Webhook route to receive inbound SMS
post "/sms/webhook" do
  content_type :json
  
  payload = JSON.parse(request.body.read)
  
  # Verify webhook event type
  event_type = payload["type"]
  
  unless event_type == "message.received"
    return [200, { status: "ignored" }.to_json].to_a
  end
  
  begin
    inbound = process_inbound_message(payload)
    
    # Log or store the inbound message
    puts "Received SMS from #{inbound[:from]}: #{inbound[:text]}"
    
    # Auto-reply to demonstrate two-way messaging
    reply_message = "Thanks for your message! We received: '#{inbound[:text]}'"
    send_sms(inbound[:from], reply_message, client)
    
    [200, { status: "processed", message_id: inbound[:message_id] }.to_json].to_a
    
  rescue Telnyx::AuthenticationError
    [401, { error: "Invalid API key" }.to_json].to_a
  rescue Telnyx::RateLimitError
    [429, { error: "Rate limit exceeded" }.to_json].to_a
  rescue Telnyx::APIStatusError => e
    [e.status_code, { error: e.message }.to_json].to_a
  rescue Telnyx::APIConnectionError
    [503, { error: "Network error connecting to Telnyx" }.to_json].to_a
  rescue StandardError => e
    [400, { error: e.message }.to_json].to_a
  end
end

# Health check route
get "/health" do
  content_type :json
  { status: "ok" }.to_json
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/two-way-sms-chat-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Sinatra server. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Webhook Not Received | Your application does not receive inbound SMS webhooks even though messages are sent to your Telnyx number. | Verify that your Messaging Profile webhook URL in the [Telnyx Portal](https://portal.telnyx.com) is set to your public ngrok URL with the `/sms/webhook` path. Ensure ngrok is running and the tunnel is active. Check your application logs for incoming POST requests. If using a firewall, allow inbound traffic on port 4567 or your configured port. |
| Environment Variable Not Set | The application raises `TELNYX_PHONE_NUMBER environment variable not set` on startup or first request. | Confirm your `.env` file exists in the same directory as `app.rb` and contains the variable. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `require "dotenv/load"` statement must execute before `ENV` is accessed—verify this import order in your code. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | Telnyx enforces rate limits on API requests. Implement exponential backoff in your client code: wait 1 second, then 2 seconds, then 4 seconds between retries. For bulk messaging, use a queue (e.g., Sidekiq) to distribute requests over time. Check your Telnyx account plan for rate limit details. |

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
- [Implement Two-Factor Authentication with SMS](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/ruby/otp-2fa).
- [Build an SMS Survey Application](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/ruby/sms-survey).
