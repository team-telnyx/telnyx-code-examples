# MMS Send with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready Sinatra endpoint that sends MMS messages with media attachments using the Telnyx Ruby SDK. This tutorial demonstrates the new client-based initialization pattern, proper error handling for telecom APIs, secure credential management via environment variables, and media URL handling for multimedia messaging.

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
- A Telnyx phone number enabled for outbound MMS.
- Bundler (Ruby dependency manager).
- A publicly accessible URL or ngrok tunnel for testing webhook callbacks (optional for this tutorial).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-mms-picture-message-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-mms-picture-message-ruby
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` and initialize the Telnyx client using the new pattern. Define a helper function to handle MMS creation with media URL validation:

```ruby
require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize client with the new SDK pattern
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

def send_mms(to_number, message, media_urls)
  """Send MMS via Telnyx and return JSON-serializable response data."""
  from_number = ENV["TELNYX_PHONE_NUMBER"]
  raise "TELNYX_PHONE_NUMBER environment variable not set" unless from_number

  # Validate E.164 format to prevent API errors
  raise "Phone number must be in E.164 format (e.g., +15551234567)" unless to_number.start_with?("+")

  # Validate media_urls is an array and not empty
  raise "media_urls must be a non-empty array of URLs" unless media_urls.is_a?(Array) && media_urls.any?

  # Validate each URL is a string
  media_urls.each do |url|
    raise "Each media URL must be a string" unless url.is_a?(String)
  end

  # Use client.messages.create() with media_urls parameter for MMS
  response = client.messages.create(
    from_: from_number,
    to: to_number,
    text: message,
    media_urls: media_urls
  )

  # Extract serializable data — SDK objects are NOT JSON-serializable
  {
    message_id: response.data.id,
    status: response.data.to&.first&.status || "unknown",
    from: from_number,
    to: to_number,
    media_count: media_urls.length
  }
end

# Error handler for Telnyx exceptions
error Telnyx::AuthenticationError do
  status 401
  json({ error: "Invalid API key" })
end

error Telnyx::RateLimitError do
  status 429
  json({ error: "Rate limit exceeded. Please slow down." })
end

error Telnyx::APIStatusError do |err|
  status err.status_code || 500
  json({ error: err.message, status_code: err.status_code })
end

error Telnyx::APIConnectionError do
  status 503
  json({ error: "Network error connecting to Telnyx" })
end

error StandardError do |err|
  status 400
  json({ error: err.message })
end

# Helper to parse and return JSON
def json(data)
  content_type :json
  data.to_json
end

# MMS send endpoint
post "/mms/send" do
  request.body.rewind
  data = JSON.parse(request.body.read)

  to_number = data["to"]
  message = data["message"]
  media_urls = data["media_urls"]

  raise "Missing required fields: 'to', 'message', and 'media_urls'" unless to_number && message && media_urls

  result = send_mms(to_number, message, media_urls)
  status 200
  json(result)
end

# Health check endpoint
get "/health" do
  json({ status: "ok" })
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-mms-picture-message-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Sinatra server. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Missing or Invalid Media URLs | The endpoint returns `{"error": "media_urls must be a non-empty array of URLs"}` or the API rejects the request. | Verify that `media_urls` is passed as a JSON array of strings, not a single string. Each URL must be publicly accessible and point to a valid image, video, or document file. Test URLs by opening them in a browser to confirm they are reachable. |

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

- [Receive SMS Webhooks with Ruby](/tutorials/sms/ruby/receive-sms-webhook).
- [Send Bulk SMS Messages with Ruby](/tutorials/sms/ruby/send-bulk-sms).
- [Implement Two-Factor Authentication with SMS](/tutorials/sms/ruby/otp-2fa).
