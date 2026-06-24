# Call Recording with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready Sinatra application that initiates outbound calls and records them using the Telnyx Voice API. This tutorial demonstrates the Ruby SDK client initialization pattern, webhook handling for call lifecycle events, secure credential management via environment variables, and proper serialization of API responses for JSON endpoints.

## Who Is This For?

- **Ruby developers** building voice features with Sinatra.
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
- A Telnyx phone number enabled for outbound calls.
- A Call Control Application configured in the Telnyx Portal with a connection ID.
- A publicly accessible URL for receiving webhooks (ngrok or similar for local development).
- Bundler (Ruby dependency manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/record-phone-calls-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/record-phone-calls-ruby
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` and initialize the Telnyx client using the Ruby SDK pattern. Define helper functions to handle call initiation and recording control:

```ruby
require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize Telnyx client with API key from environment
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# In-memory store for active calls (use Redis in production)
$active_calls = {}

# Helper function to initiate an outbound call
def initiate_call(to_number, client)
  from_number = ENV["TELNYX_PHONE_NUMBER"]
  connection_id = ENV["TELNYX_CONNECTION_ID"]
  
  unless from_number && connection_id
    raise "TELNYX_PHONE_NUMBER and TELNYX_CONNECTION_ID must be set"
  end
  
  # Validate E.164 format to prevent API errors
  unless to_number.start_with?("+")
    raise "Phone number must be in E.164 format (e.g., +15551234567)"
  end
  
  # Initiate the call using client.calls.dial()
  response = client.calls.dial(
    from_: from_number,
    to: to_number,
    connection_id: connection_id
  )
  
  # Extract serializable data — SDK objects are NOT JSON-serializable
  {
    call_control_id: response.data.call_control_id,
    from: from_number,
    to: to_number,
    state: response.data.state
  }
end

# Helper function to start recording on an active call
def start_recording(call_control_id, client)
  response = client.calls.actions.start_recording(
    call_control_id,
    format: "wav"
  )
  
  {
    call_control_id: response.data.call_control_id,
    recording_state: response.data.recording_state
  }
end

# Helper function to stop recording on an active call
def stop_recording(call_control_id, client)
  response = client.calls.actions.stop_recording(call_control_id)
  
  {
    call_control_id: response.data.call_control_id,
    recording_state: response.data.recording_state
  }
end

# Helper function to hang up a call
def hangup_call(call_control_id, client)
  response = client.calls.actions.hangup(call_control_id)
  
  {
    call_control_id: response.data.call_control_id,
    state: response.data.state
  }
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/record-phone-calls-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Sinatra server. |
| Connection ID Not Found | The application raises an error about missing `TELNYX_CONNECTION_ID` or the API returns a 422 error about invalid connection. | Confirm your Call Control Application is created in the [Telnyx Portal](https://portal.telnyx.com) and the connection ID is correctly copied to your `.env` file. Verify the connection is linked to your Telnyx phone number. Restart the server after updating the `.env` file. |
| Webhook Events Not Received | Call lifecycle events (call.answered, call.hangup) are not triggering the webhook handler. | Ensure your `WEBHOOK_URL` in the `.env` file is publicly accessible and matches the webhook URL configured in your Call Control Application settings in the Telnyx Portal. Use ngrok to expose your local server: `ngrok http 4567`. Update the webhook URL in the Portal to the ngrok URL (e.g., `https://abc123.ngrok.io/webhooks/call`). Verify the server is running and logs show incoming POST requests. |
| Recording Not Starting | The `/recording/start` endpoint returns success but no recording is captured. | Ensure the call has been answered before starting recording. The webhook handler automatically starts recording on `call.answered`, but manual calls to `/recording/start` require the call to be in an active state. Check the call state by examining webhook logs. Recording may fail if the call is in "parked" state—wait for the `call.answered` event. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this Voice example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What Ruby version do I need?**

Ruby 3.1 or higher. Ruby 3.3 is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Voice API Overview](https://developers.telnyx.com/docs/voice)
- [Voice API Commands](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-commands-and-resources)
- [AI Assistant Start](https://developers.telnyx.com/docs/voice/programmable-voice/ai-assistant-start)
- [Call Control API Reference](https://developers.telnyx.com/api-reference/call-commands/dial)
- [Ruby SDK](https://developers.telnyx.com/development/sdk/ruby)
- [Telnyx Voice API](https://telnyx.com/products/voice-api)
- [Voice AI Agents](https://telnyx.com/products/voice-ai-agents)

## Related Examples

- [Handle Inbound Calls with Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/ruby/inbound-call-webhook).
- [Transfer Calls Between Numbers](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/ruby/call-transfer).
- [Build an Interactive Voice Response (IVR) Menu](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/ruby/ivr-menu).
