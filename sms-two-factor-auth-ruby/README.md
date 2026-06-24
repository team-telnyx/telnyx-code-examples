# OTP 2FA with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready two-factor authentication (2FA) system using one-time passwords (OTP) delivered via SMS with Ruby and Sinatra. This tutorial demonstrates secure OTP generation, storage with expiration, verification workflows, and proper error handling for telecom APIs. You'll create endpoints to request OTP codes and verify them, protecting user accounts with SMS-based authentication.

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
- A basic understanding of HTTP endpoints and JSON responses.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-two-factor-auth-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-two-factor-auth-ruby
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` and implement the OTP 2FA system with secure code generation, storage, and verification:

```ruby
require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"
require "securerandom"
require "time"

# Initialize Telnyx client with the new SDK pattern
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# In-memory OTP storage (use Redis or database in production)
# Structure: { phone_number => { code: "123456", expires_at: Time.now + 300 } }
$otp_store = {}

# Helper function to generate a 6-digit OTP code
def generate_otp_code
  SecureRandom.random_bytes(3).unpack1("H*")[0..5].to_i.to_s.rjust(6, "0")
end

# Helper function to send OTP via SMS
def send_otp_sms(to_number, otp_code)
  from_number = ENV["TELNYX_PHONE_NUMBER"]
  raise "TELNYX_PHONE_NUMBER environment variable not set" unless from_number

  # Validate E.164 format to prevent API errors
  raise "Phone number must be in E.164 format (e.g., +15551234567)" unless to_number.start_with?("+")

  message_text = "Your verification code is: #{otp_code}. Valid for 5 minutes."

  response = client.messages.create(
    from_: from_number,
    to: to_number,
    text: message_text
  )

  # Extract serializable data — SDK objects are NOT JSON-serializable
  {
    message_id: response.data.id,
    status: response.data.to&.first&.status || "unknown",
    from: from_number,
    to: to_number
  }
end

# Helper function to store OTP with expiration
def store_otp(phone_number, otp_code)
  expiry_seconds = ENV["OTP_EXPIRY_SECONDS"]&.to_i || 300
  $otp_store[phone_number] = {
    code: otp_code,
    expires_at: Time.now + expiry_seconds
  }
end

# Helper function to verify OTP
def verify_otp(phone_number, provided_code)
  otp_data = $otp_store[phone_number]
  return { valid: false, reason: "No OTP found for this number" } unless otp_data

  if Time.now > otp_data[:expires_at]
    $otp_store.delete(phone_number)
    return { valid: false, reason: "OTP has expired" }
  end

  if otp_data[:code] != provided_code
    return { valid: false, reason: "Invalid OTP code" }
  end

  # OTP verified successfully — delete it to prevent reuse
  $otp_store.delete(phone_number)
  { valid: true, reason: "OTP verified successfully" }
end

# Sinatra route to request OTP
post "/otp/request" do
  content_type :json

  data = JSON.parse(request.body.read) rescue {}

  to_number = data["to"]
  unless to_number
    return [400, { error: "Missing required field: 'to'" }.to_json]
  end

  begin
    otp_code = generate_otp_code
    send_otp_sms(to_number, otp_code)
    store_otp(to_number, otp_code)

    [200, { message: "OTP sent successfully", phone: to_number }.to_json]

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

# Sinatra route to verify OTP
post "/otp/verify" do
  content_type :json

  data = JSON.parse(request.body.read) rescue {}

  phone_number = data["phone"]
  otp_code = data["code"]

  unless phone_number && otp_code
    return [400, { error: "Missing required fields: 'phone' and 'code'" }.to_json]
  end

  begin
    result = verify_otp(phone_number, otp_code)

    if result[:valid]
      [200, { message: result[:reason], authenticated: true }.to_json]
    else
      [401, { error: result[:reason], authenticated: false }.to_json]
    end

  rescue StandardError => e
    [400, { error: e.message }.to_json]
  end
end

# Health check endpoint
get "/health" do
  content_type :json
  { status: "ok" }.to_json
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-two-factor-auth-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Sinatra server. |
| OTP Code Not Received | You request an OTP but don't receive the SMS on your phone. | Confirm your `TELNYX_PHONE_NUMBER` in the `.env` file is a valid Telnyx number in E.164 format (e.g., `+15551234567`). Verify the destination phone number in your curl request is also in E.164 format. Check the Telnyx Portal for any messaging profile or webhook configuration issues. |
| OTP Verification Fails with "No OTP found" | The verification endpoint returns `{"error": "No OTP found for this number"}` even after requesting an OTP. | Ensure you are using the exact same phone number in both the request and verify endpoints. The in-memory `$otp_store` is cleared when the Sinatra server restarts—if you restarted the server between requesting and verifying, the OTP will be lost. For production, use Redis or a database instead of in-memory storage. |
| OTP Expired Before Verification | The verification endpoint returns `{"error": "OTP has expired"}`. | The default OTP expiry is 300 seconds (5 minutes). If you waited longer than this, request a new OTP. To extend the expiry time, increase the `OTP_EXPIRY_SECONDS` value in your `.env` file and restart the server. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format". | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your curl requests to use properly formatted numbers. |

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

- [Send a Single SMS with Ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/ruby/send-single-sms).
- [Receive SMS Webhooks with Ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/ruby/receive-sms-webhook).
- [Send Bulk SMS Messages with Ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/ruby/send-bulk-sms).
