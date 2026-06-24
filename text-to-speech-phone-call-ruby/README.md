# Text To Speech with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready Sinatra endpoint that plays text-to-speech (TTS) messages during voice calls using the Telnyx Voice API. This tutorial demonstrates the Ruby SDK client initialization pattern, proper error handling for telecom APIs, and secure credential management via environment variables. You'll learn how to initiate calls, handle webhooks, and control call flow with TTS playback.

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
- A publicly accessible webhook URL (use ngrok for local development).
- Bundler (Ruby dependency manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/text-to-speech-phone-call-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/text-to-speech-phone-call-ruby
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` and initialize the Telnyx client using the Ruby SDK pattern. Define helper functions to handle call initiation and TTS playback with proper validation:

```ruby
require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize client with the Ruby SDK pattern
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# Store active calls in memory (use Redis in production)
$active_calls = {}

def initiate_call(to_number, message)
  """Initiate an outbound call and return call control ID."""
  from_number = ENV["TELNYX_PHONE_NUMBER"]
  connection_id = ENV["TELNYX_CONNECTION_ID"]
  
  unless from_number
    raise ValueError, "TELNYX_PHONE_NUMBER environment variable not set"
  end
  
  unless connection_id
    raise ValueError, "TELNYX_CONNECTION_ID environment variable not set"
  end
  
  # Validate E.164 format to prevent API errors
  unless to_number.start_with?("+")
    raise ValueError, "Phone number must be in E.164 format (e.g., +15551234567)"
  end
  
  # Initiate the call using client.calls.dial()
  response = client.calls.dial(
    from_: from_number,
    to: to_number,
    connection_id: connection_id
  )
  
  # Extract call_control_id from response — returned by the API
  call_control_id = response.data.call_control_id
  
  # Store call metadata for webhook handling
  $active_calls[call_control_id] = {
    to: to_number,
    from: from_number,
    message: message,
    initiated_at: Time.now
  }
  
  # Return JSON-serializable data
  {
    call_control_id: call_control_id,
    to: to_number,
    from: from_number,
    status: "initiated"
  }
end

def play_tts(call_control_id, message)
  """Play text-to-speech message on an active call."""
  # Use client.calls.actions.speak() to play TTS
  response = client.calls.actions.speak(
    call_control_id: call_control_id,
    payload: message,
    language: "en-US",
    voice: "female"
  )
  
  # Return JSON-serializable response
  {
    call_control_id: call_control_id,
    message: message,
    status: "speaking"
  }
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/text-to-speech-phone-call-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Sinatra server. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Webhook Not Receiving Events | The `/webhooks/call` endpoint is not being called when call events occur. | Verify that your webhook URL is correctly configured in the Telnyx Portal under your Call Control Application settings. Ensure the URL is publicly accessible (test with `curl https://your-ngrok-url.ngrok.io/health`). Check that ngrok is still running and the forwarding URL hasn't changed. Restart ngrok if needed and update the webhook URL in the Portal. |
| Connection ID Not Set | The application raises an error about `TELNYX_CONNECTION_ID` environment variable not set. | Confirm your `.env` file contains the `TELNYX_CONNECTION_ID` variable with your Call Control Application ID from the Telnyx Portal. Ensure the file is named exactly `.env` (not `.env.txt`). The `require "dotenv/load"` statement must execute before `ENV` variables are accessed. Restart the Sinatra server after updating the `.env` file. |
| TTS Not Playing | The call connects but no audio is heard. | Verify that the `call.answered` webhook event is being received by checking your server logs. Ensure the message text is not empty and is a valid string. Check that the `language` and `voice` parameters in `play_tts()` are supported by Telnyx (e.g., "en-US" with "female" or "male"). Test with a simple message like "Hello" to isolate the issue. |

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

- [Handle Inbound Call Webhooks with Ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/ruby/inbound-call-webhook).
- [Record Voice Calls with Ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/ruby/call-recording).
- [Transfer Calls with Ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/ruby/call-transfer).
