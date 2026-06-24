# Call Forwarding with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready Sinatra application that implements intelligent call forwarding using the Telnyx Voice API. This tutorial demonstrates how to intercept incoming calls via webhooks, route them to alternative numbers based on custom logic, and handle call control events with proper error handling and state management.

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
- A Telnyx phone number enabled for inbound calls.
- A Call Control Application configured in the Telnyx Portal.
- ngrok or similar tool to expose your local server for webhook testing.
- Bundler (Ruby dependency manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-forwarding-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-forwarding-ruby
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` and initialize the Telnyx client using the new pattern. Define helper functions to handle call forwarding logic with proper state management:

```ruby
require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize Telnyx client with the new SDK pattern
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# In-memory store for call state (use Redis in production)
$call_state = {}

def forward_call(call_control_id, to_number, client)
  """Transfer an incoming call to a forwarding number."""
  from_number = ENV["TELNYX_PHONE_NUMBER"]
  
  if !from_number
    raise StandardError, "TELNYX_PHONE_NUMBER environment variable not set"
  end
  
  if !to_number.start_with?("+")
    raise StandardError, "Phone number must be in E.164 format (e.g., +15551234567)"
  end
  
  # Transfer the call to the forwarding number
  response = client.calls.actions.transfer(
    call_control_id,
    to: to_number
  )
  
  # Extract serializable data — SDK objects are NOT JSON-serializable
  {
    call_control_id: response.data.call_control_id,
    status: "transferred"
  }
end

def answer_call(call_control_id, client)
  """Answer an incoming call."""
  response = client.calls.actions.answer(call_control_id)
  
  {
    call_control_id: response.data.call_control_id,
    status: "answered"
  }
end

def hangup_call(call_control_id, client)
  """Hang up a call."""
  response = client.calls.actions.hangup(call_control_id)
  
  {
    call_control_id: response.data.call_control_id,
    status: "hung_up"
  }
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-forwarding-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The webhook returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Sinatra server after updating the `.env` file. The `dotenv/load` require statement must execute before the client is initialized. |
| Webhook Not Receiving Events | The application starts but no webhook events arrive when you call the Telnyx number. | Confirm your ngrok URL is correctly configured in the Telnyx Portal under your Call Control Application webhook settings. The webhook URL should be `https://your-ngrok-url.ngrok.io/webhooks/call`. Verify ngrok is running and the tunnel is active. Check that your Telnyx phone number is assigned to the Call Control Application. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" when forwarding. | Ensure the `FORWARD_TO_NUMBER` in your `.env` file uses E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update the `.env` file and restart the server. |
| Call State Not Persisting | Call information is lost when the server restarts or multiple instances are running. | The in-memory `$call_state` hash is suitable only for development. For production, use Redis or another persistent data store. Install the `redis` gem, initialize a Redis client, and replace hash operations with Redis commands (e.g., `redis.set(call_control_id, call_info.to_json)`). |
| Connection ID Not Set | The application raises an error about missing `TELNYX_CONNECTION_ID`. | Verify your `.env` file contains `TELNYX_CONNECTION_ID` with your Call Control Application ID from the Telnyx Portal. The `dotenv/load` require must execute before any `ENV` access. Confirm the file is named exactly `.env` (not `.env.txt` or `env`). |

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

- [Handle Inbound Calls with Webhooks](/tutorials/voice/ruby/inbound-call-webhook).
- [Record Calls](/tutorials/voice/ruby/call-recording).
- [Build an IVR Menu](/tutorials/voice/ruby/ivr-menu).
