# Voicemail with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready Sinatra application that handles voicemail using the Telnyx Voice API. This tutorial demonstrates how to receive inbound calls, detect when a caller leaves a voicemail, record the message, and store metadata for later retrieval. You'll learn the command-event model of Telnyx Call Control, webhook handling, and secure credential management.

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
- A Call Control Application configured in the Telnyx Portal with your webhook URL.
- A publicly accessible URL (use ngrok for local development).
- Bundler (Ruby dependency manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/voicemail-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` with the Sinatra application. Initialize the Telnyx client and define routes to handle inbound call webhooks and voicemail recording:

```ruby
require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize Telnyx client with API key
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# In-memory storage for voicemail metadata (use a database in production)
voicemails = {}

# Configure Sinatra
set :port, 4567
set :bind, "0.0.0.0"

# Helper function to answer an inbound call
def answer_call(client, call_control_id)
  client.calls.actions.answer(call_control_id)
rescue Telnyx::APIStatusError => e
  puts "Error answering call: #{e.message}"
end

# Helper function to play a greeting and start recording
def play_greeting_and_record(client, call_control_id)
  # Play a greeting message
  client.calls.actions.speak(
    call_control_id,
    payload: "Please leave your message after the beep. Press pound when finished.",
    voice: "female",
    language: "en-US"
  )
  
  # Start recording the voicemail
  client.calls.actions.start_recording(
    call_control_id,
    format: "wav"
  )
rescue Telnyx::APIStatusError => e
  puts "Error playing greeting or starting recording: #{e.message}"
end

# Helper function to hang up the call
def hangup_call(client, call_control_id)
  client.calls.actions.hangup(call_control_id)
rescue Telnyx::APIStatusError => e
  puts "Error hanging up call: #{e.message}"
end

# Webhook endpoint to receive call events
post "/webhooks/call" do
  request.body.rewind
  payload = JSON.parse(request.body.read)
  
  event_type = payload.dig("data", "event_type")
  call_control_id = payload.dig("data", "call_control_id")
  from_number = payload.dig("data", "from")
  to_number = payload.dig("data", "to")
  
  puts "Received event: #{event_type} for call #{call_control_id}"
  
  case event_type
  when "call.initiated"
    # Inbound call received — answer and start voicemail
    answer_call(client, call_control_id)
    play_greeting_and_record(client, call_control_id)
    
    # Store call metadata
    voicemails[call_control_id] = {
      from: from_number,
      to: to_number,
      initiated_at: Time.now.iso8601,
      status: "recording"
    }
    
  when "call.answered"
    # Call was answered — update status
    if voicemails[call_control_id]
      voicemails[call_control_id][:status] = "answered"
    end
    
  when "call.dtmf.received"
    # DTMF digit received (e.g., # to end recording)
    digit = payload.dig("data", "dtmf_digit")
    if digit == "#"
      # Stop recording and hang up
      client.calls.actions.stop_recording(call_control_id)
      hangup_call(client, call_control_id)
      
      if voicemails[call_control_id]
        voicemails[call_control_id][:status] = "completed"
      end
    end
    
  when "call.recording.saved"
    # Recording is ready for download
    recording_url = payload.dig("data", "recording_urls", 0)
    if voicemails[call_control_id]
      voicemails[call_control_id][:recording_url] = recording_url
      voicemails[call_control_id][:saved_at] = Time.now.iso8601
    end
    
  when "call.hangup"
    # Call ended — finalize voicemail record
    if voicemails[call_control_id]
      voicemails[call_control_id][:status] = "ended"
      voicemails[call_control_id][:ended_at] = Time.now.iso8601
    end
  end
  
  # Return 200 OK to acknowledge webhook receipt
  status 200
  json({ status: "ok" })
end

# Endpoint to retrieve voicemail metadata
get "/voicemails/:call_control_id" do
  call_control_id = params[:call_control_id]
  
  if voicemails[call_control_id]
    json(voicemails[call_control_id])
  else
    status 404
    json({ error: "Voicemail not found" })
  end
end

# Endpoint to list all voicemails
get "/voicemails" do
  json(voicemails.map { |id, data| { call_control_id: id, **data } })
end

# Health check endpoint
get "/health" do
  json({ status: "ok" })
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voicemail-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not receiving events | The `/webhooks/call` endpoint is not being called when inbound calls arrive. | Verify that your Call Control Application webhook URL in the Telnyx Portal is set to `https://your-ngrok-url.ngrok.io/webhooks/call` (use HTTPS, not HTTP). Confirm ngrok is running and the tunnel is active. Check your Sinatra server logs for incoming POST requests. If using a firewall, ensure port 4567 is accessible. |
| Recording URL is nil | The `recording_url` field in voicemail metadata is empty or missing. | Ensure the `call.recording.saved` webhook event is being received. This event is sent after the recording is processed by Telnyx (typically 10–30 seconds after the call ends). Verify that recording is started with `client.calls.actions.start_recording()` before the caller speaks. Check the Telnyx Portal call logs to confirm the recording was captured. |
| Call not being answered automatically | Inbound calls ring but are not answered by the application. | Verify that the `call.initiated` event is being received in your webhook. Confirm that `answer_call()` is being called without errors. Check that `TELNYX_API_KEY` is valid and has permissions for call control actions. Review Sinatra server logs for any exceptions during the answer action. |
| DTMF digits not detected | Pressing `#` on the phone does not stop the recording. | Ensure the Call Control Application is configured to detect DTMF in the Telnyx Portal. Verify that `call.dtmf.received` webhook events are being sent. Some phone systems may not send DTMF reliably; test with a different phone or add a timeout-based recording stop as a fallback. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this Voice example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

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

- [Handle Inbound Calls with Ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/ruby/inbound-call-webhook).
- [Record Phone Calls with Ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/ruby/call-recording).
- [Build an IVR Menu with Ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/ruby/ivr-menu).
