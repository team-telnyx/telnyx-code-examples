# Send Bulk SMS with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready Sinatra application that sends bulk SMS messages using the Telnyx Ruby SDK. This tutorial demonstrates efficient batch processing with rate limiting, proper error handling for telecom APIs, and secure credential management via environment variables. You'll learn how to queue multiple messages, track delivery status, and handle API rate limits gracefully.

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
- curl or Postman for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-bulk-sms-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-bulk-sms-ruby
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` and initialize the Telnyx client using the Ruby SDK pattern. Define helper functions to handle bulk message creation with rate limiting and proper validation:

```ruby
require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize Telnyx client with API key from environment
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# Helper function to send a single SMS with error handling
def send_sms(client, from_number, to_number, message)
  # Validate E.164 format to prevent API errors
  unless to_number.start_with?("+")
    raise ArgumentError, "Phone number must be in E.164 format (e.g., +15551234567)"
  end

  # Create message via Telnyx API
  response = client.messages.create(
    from_: from_number,
    to: to_number,
    text: message
  )

  # Extract serializable data — SDK objects are NOT JSON-serializable
  {
    message_id: response.data.id,
    to: to_number,
    status: response.data.to&.first&.status || "pending"
  }
end

# Helper function to send bulk SMS with rate limiting
def send_bulk_sms(client, from_number, recipients, message)
  rate_limit_delay = (ENV["RATE_LIMIT_DELAY"] || "0.1").to_f
  results = []
  errors = []

  recipients.each_with_index do |to_number, index|
    begin
      result = send_sms(client, from_number, to_number, message)
      results << result
      
      # Apply rate limiting between requests (except after the last one)
      sleep(rate_limit_delay) if index < recipients.length - 1
    rescue ArgumentError => e
      errors << { to: to_number, error: e.message }
    end
  end

  {
    sent: results,
    failed: errors,
    total_sent: results.length,
    total_failed: errors.length
  }
end

# POST endpoint to send bulk SMS
post "/sms/bulk" do
  content_type :json

  # Parse request body
  begin
    data = JSON.parse(request.body.read)
  rescue JSON::ParserError
    return [400, { error: "Invalid JSON in request body" }.to_json]
  end

  # Validate required fields
  recipients = data["recipients"]
  message = data["message"]

  unless recipients.is_a?(Array) && recipients.any?
    return [400, { error: "Field 'recipients' must be a non-empty array" }.to_json]
  end

  unless message.is_a?(String) && !message.empty?
    return [400, { error: "Field 'message' must be a non-empty string" }.to_json]
  end

  from_number = ENV["TELNYX_PHONE_NUMBER"]
  unless from_number
    return [500, { error: "TELNYX_PHONE_NUMBER environment variable not set" }.to_json]
  end

  # Send bulk SMS with error handling
  begin
    result = send_bulk_sms(client, from_number, recipients, message)
    [200, result.to_json]
  rescue Telnyx::AuthenticationError
    [401, { error: "Invalid API key" }.to_json]
  rescue Telnyx::RateLimitError
    [429, { error: "Rate limit exceeded. Please slow down." }.to_json]
  rescue Telnyx::APIStatusError => e
    [e.status_code || 500, { error: e.message, status_code: e.status_code }.to_json]
  rescue Telnyx::APIConnectionError
    [503, { error: "Network error connecting to Telnyx" }.to_json]
  rescue StandardError => e
    [500, { error: "Unexpected error: #{e.message}" }.to_json]
  end
end

# GET endpoint to check application health
get "/health" do
  content_type :json
  { status: "ok" }.to_json
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-bulk-sms-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Sinatra server. |
| Invalid Phone Number Format | You receive a 400 error or some recipients fail with "Phone number must be in E.164 format". | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your JSON request body to use properly formatted numbers. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | Increase the `RATE_LIMIT_DELAY` value in your `.env` file (e.g., change from `0.1` to `0.2` seconds). This adds more time between API calls. Alternatively, reduce the number of recipients in a single bulk request and send multiple requests sequentially. |
| Environment Variable Not Set | The application returns `{"error": "TELNYX_PHONE_NUMBER environment variable not set"}` on first request. | Confirm your `.env` file exists in the same directory as `app.rb` and contains both `TELNYX_API_KEY` and `TELNYX_PHONE_NUMBER`. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `require "dotenv/load"` statement must execute before the client is initialized. |
| JSON Parse Error | The endpoint returns `{"error": "Invalid JSON in request body"}` with HTTP 400. | Verify your curl command or HTTP client is sending valid JSON. Ensure all strings are wrapped in double quotes, arrays use square brackets, and there are no trailing commas. Test with a JSON validator tool before sending requests. |

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
- [Implement Two-Factor Authentication with SMS](/tutorials/sms/ruby/otp-2fa).
- [Send a Single SMS with Ruby and Sinatra](/tutorials/sms/ruby/send-single-sms).
