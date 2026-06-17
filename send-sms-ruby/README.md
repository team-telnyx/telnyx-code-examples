# Send a Single SMS with Ruby on Rails

## What Does This Example Do?

Build a production-ready Rails API endpoint that sends SMS messages using the Telnyx Ruby SDK. This tutorial demonstrates the new client-based initialization pattern, proper error handling for telecom APIs, and secure credential management via environment variables.

## Who Is This For?

- **Ruby developers** building sms features with Rails.
- **Backend engineers** integrating telephony or messaging into existing applications.
- **DevOps teams** looking for containerized, production-ready telecom examples.
- **Startups and enterprises** replacing legacy telecom providers with a modern API-first platform.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform that gives developers a single API for voice, messaging, SIP, AI, and IoT — no Frankenstack required.

- **Integrated platform** — Voice, SMS, SIP trunking, AI assistants, and IoT SIM management under one roof. No stitching together multiple vendors.
- **Global private network** — Calls and messages traverse the Telnyx-owned IP network for lower latency and higher reliability than the public internet.
- **Developer-first** — SDKs for Python, Node.js, Go, Ruby, Java, and PHP. Comprehensive webhook event model. Sandbox environment for testing.
- **Competitive pricing** — Pay-as-you-go with no minimums, contracts, or per-seat fees.

## Prerequisites

- Ruby 3.0 or higher
- Rails 7.0 or higher
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com)
- A Telnyx phone number enabled for outbound SMS
- Bundler (Ruby package manager)

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-sms-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-sms-ruby
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Generate a controller to handle SMS operations:

```bash
rails generate controller Sms send_sms --skip-assets --skip-helper
```

Open `app/controllers/sms_controller.rb` and implement the endpoint with proper validation and error handling:

```ruby
class SmsController < ApplicationController
  # Initialize client per request to ensure fresh connection
  before_action :initialize_client

  def send_sms
    to_number = params[:to]
    message = params[:message]

    # Validate presence of required fields
    unless to_number.present? && message.present?
      return render json: { error: "Missing required fields: 'to' and 'message'" }, status: :bad_request
    end

    # Validate E.164 format to prevent API errors
    unless to_number.start_with?("+")
      return render json: { error: "Phone number must be in E.164 format (e.g., +15551234567)" }, status: :bad_request
    end

    from_number = ENV["TELNYX_PHONE_NUMBER"]
    unless from_number
      return render json: { error: "TELNYX_PHONE_NUMBER environment variable not set" }, status: :internal_server_error
    end

    begin
      # Use client.messages.create() — NOT Telnyx::Message.create()
      response = @client.messages.create(
        from_: from_number,
        to: to_number,
        text: message
      )

      # Extract serializable data — do not return raw response object
      render json: {
        message_id: response.data.id,
        status: response.data.to.first&.status || "unknown",
        from: from_number,
        to: to_number
      }, status: :ok

    rescue Telnyx::AuthenticationError
      render json: { error: "Invalid API key" }, status: :unauthorized
    rescue Telnyx::RateLimitError
      render json: { error: "Rate limit exceeded. Please slow down." }, status: :too_many_requests
    rescue Telnyx::APIStatusError => e
      # e.status_code contains the HTTP status from Telnyx
      render json: { error: e.message, status_code: e.status_code }, status: e.status_code
    rescue Telnyx::APIConnectionError
      render json: { error: "Network error connecting to Telnyx" }, status: :service_unavailable
    end
  end

  private

  def initialize_client
    # Initialize client using new pattern — NOT Telnyx.api_key = ...
    @client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])
  end
end
```

## Complete Code

See [`app.rb`](./app.rb) for the full implementation.

## Troubleshooting

### Issue 1: Authentication Error (401)

**Problem:** The endpoint returns `{"error": "Invalid API key"}` with HTTP 401.

**Solution:** Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Rails server after updating environment variables, as they are loaded at boot time.

### Issue 2: Invalid Phone Number Format

**Problem:** You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination.

**Solution:** Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers.

### Issue 3: uninitialized constant Telnyx::Client

**Problem:** Rails raises `NameError: uninitialized constant Telnyx::Client` when processing a request.

**Solution:** Ensure the `telnyx` gem is included in your `Gemfile` and you have run `bundle install`. If the error persists, verify the gem is not restricted to a specific group (like `:production`) that your current environment doesn't match. Restart the Rails server after modifying the Gemfile.

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

- [Receive SMS Webhooks with Ruby](/tutorials/sms/ruby/receive-sms-webhook)
- [Send Bulk SMS with Ruby](/tutorials/sms/ruby/send-bulk-sms)
- [Implement Two-Factor Authentication with Ruby](/tutorials/sms/ruby/otp-2fa)
