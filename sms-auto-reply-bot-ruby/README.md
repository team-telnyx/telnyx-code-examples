# SMS Autoresponder with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready SMS autoresponder using Ruby and Sinatra that receives inbound SMS messages via webhooks and automatically sends replies. This tutorial demonstrates webhook handling, inbound message processing, proper error handling for telecom APIs, and secure credential management via environment variables.

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
cd telnyx-code-examples/sms-auto-reply-bot-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-auto-reply-bot-ruby
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` and initialize the Telnyx client using the new pattern. Define a helper function to handle message creation with proper validation:

```ruby
require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize client with the new SDK pattern
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

def send_sms(client, to_number, message)
  """Send SMS via Telnyx and return response data."""
  from_number = ENV["TELNYX_PHONE_NUMBER"]
  raise "TELNYX_PHONE_NUMBER environment variable not set" unless from_number

  # Validate E.164 format to prevent API errors
  raise "Phone number must be in E.164 format (e.g., +15551234567)" unless to_number.start_with?("+")

  # Use client.messages.create()
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

def parse_webhook_event(request_body)
  """Parse and validate incoming webhook event."""
  begin
    JSON.parse(request_body)
  rescue JSON::ParserError
    raise "Invalid JSON in webhook payload"
  end
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-auto-reply-bot-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The webhook returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Sinatra server. |
| Webhook Not Receiving Events | The `/webhooks/sms/inbound` endpoint is never called when SMS arrives. | Confirm your Messaging Profile in the Telnyx Portal has the webhook URL configured correctly. The URL must be publicly accessible (use ngrok for local development). Verify the webhook URL in your Messaging Profile matches your `WEBHOOK_URL` environment variable exactly, including the `/webhooks/sms/inbound` path. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" when the autoresponder tries to send. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Verify the webhook payload contains properly formatted phone numbers in the `from` and `to` fields. |
| Environment Variable Not Set | The application raises an error about `TELNYX_API_KEY` or `TELNYX_PHONE_NUMBER` not being set. | Confirm your `.env` file exists in the same directory as `app.rb` and contains all required variables. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `require "dotenv/load"` statement must execute before environment variables are accessed. Restart the Sinatra server after updating the `.env` file. |
| Webhook Payload Parsing Error | The endpoint returns `{"error": "Invalid JSON in webhook payload"}` with HTTP 400. | Verify the webhook request contains valid JSON in the request body. Check that your Messaging Profile is sending the correct event format. Test with the curl example provided in Step 4 to confirm the endpoint accepts valid JSON. |

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
