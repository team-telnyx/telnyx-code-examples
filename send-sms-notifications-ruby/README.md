# SMS Notifications with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready Sinatra application that sends SMS notifications using the Telnyx Ruby SDK. This tutorial demonstrates how to set up a notification system that handles scheduled messages, manages delivery status, and implements proper error handling for telecom APIs. You'll learn to initialize the Telnyx client, send messages with validation, and handle webhook callbacks for delivery confirmation.

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
- Bundler (Ruby dependency manager).
- A publicly accessible URL for webhook testing (ngrok or similar for local development).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-sms-notifications-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` with Sinatra routes for sending notifications and handling webhooks:

```ruby
require "sinatra"
require_relative "config"

# In-memory store for tracking notification status (use a database in production)
$notification_log = {}

# Helper function to send SMS notification
def send_notification(to_number, message)
  from_number = ENV["TELNYX_PHONE_NUMBER"]
  
  # Validate E.164 format to prevent API errors
  unless to_number.start_with?("+")
    raise ArgumentError, "Phone number must be in E.164 format (e.g., +15551234567)"
  end
  
  # Create message via Telnyx API
  response = $client.messages.send_(
    from: from_number,
    to: to_number,
    text: message
  )
  
  # Extract serializable data — SDK objects are NOT JSON-serializable
  {
    message_id: response.id,
    status: response.to&.first&.status || "pending",
    from: from_number,
    to: to_number,
    created_at: Time.now.iso8601
  }
end

# POST endpoint to send a notification
post "/notifications/send" do
  content_type :json
  
  begin
    data = JSON.parse(request.body.read)
  rescue JSON::ParserError
    return [400, { error: "Invalid JSON in request body" }.to_json]
  end
  
  to_number = data["to"]
  message = data["message"]
  
  unless to_number && message
    return [400, { error: "Missing required fields: 'to' and 'message'" }.to_json]
  end
  
  begin
    result = send_notification(to_number, message)
    
    # Log notification for tracking
    $notification_log[result[:message_id]] = result
    
    [200, result.to_json]
    
  rescue Telnyx::AuthenticationError
    [401, { error: "Invalid API key" }.to_json]
  rescue Telnyx::RateLimitError
    [429, { error: "Rate limit exceeded. Please slow down." }.to_json]
  rescue Telnyx::APIStatusError => e
    [e.http_status || 400, { error: e.message, status_code: e.http_status }.to_json]
  rescue Telnyx::APIConnectionError
    [503, { error: "Network error connecting to Telnyx" }.to_json]
  rescue ArgumentError => e
    [400, { error: e.message }.to_json]
  end
end

# POST endpoint to receive webhook callbacks for delivery status
post "/webhooks/sms" do
  content_type :json
  
  begin
    data = JSON.parse(request.body.read)
  rescue JSON::ParserError
    return [400, { error: "Invalid JSON in webhook payload" }.to_json]
  end
  
  event_type = data["data"]&.dig("event_type")
  message_id = data["data"]&.dig("id")
  status = data["data"]&.dig("to")&.first&.dig("status")
  
  # Update notification log with delivery status
  if message_id && $notification_log[message_id]
    $notification_log[message_id][:webhook_status] = status
    $notification_log[message_id][:event_type] = event_type
    $notification_log[message_id][:updated_at] = Time.now.iso8601
  end
  
  # Return 200 to acknowledge webhook receipt
  [200, { success: true }.to_json]
end

# GET endpoint to retrieve notification status
get "/notifications/:message_id" do
  content_type :json
  
  message_id = params["message_id"]
  notification = $notification_log[message_id]
  
  unless notification
    return [404, { error: "Notification not found" }.to_json]
  end
  
  [200, notification.to_json]
end

# Health check endpoint
get "/health" do
  content_type :json
  [200, { status: "ok" }.to_json]
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-notifications-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Sinatra server. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Environment Variable Not Set | The application raises an error on startup: "Missing environment variable: TELNYX_API_KEY". | Confirm your `.env` file exists in the same directory as `app.rb` and contains the required variables. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `require "dotenv/load"` statement must execute before accessing `ENV` variables. Restart the server after updating the `.env` file. |
| Webhook Not Receiving Callbacks | Notifications send successfully but the webhook endpoint never receives delivery status updates. | Verify your webhook URL is publicly accessible and matches the URL configured in your Telnyx Messaging Profile. Use ngrok to expose your local server: `ngrok http 4567`. Update the `WEBHOOK_URL` in your `.env` file and configure it in the [Telnyx Portal](https://portal.telnyx.com) under Messaging Profiles. Test the webhook endpoint directly with curl to ensure it responds with HTTP 200. |
| JSON Parsing Error | The endpoint returns `{"error": "Invalid JSON in request body"}` with HTTP 400. | Verify your curl command includes the `-H "Content-Type: application/json"` header and that the JSON payload is valid. Use a JSON validator tool to check syntax. Ensure the request body is properly formatted with double quotes around keys and string values. |

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
