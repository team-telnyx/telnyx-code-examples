# Ivr Menu with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready Interactive Voice Response (IVR) system using Ruby, Sinatra, and the Telnyx Voice API. This tutorial demonstrates how to handle inbound calls, collect DTMF (dial tone) input, play voice prompts, and route calls based on user selections. You'll implement a complete call control flow with webhook handling, state management, and proper error handling for a real-world IVR menu system.

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
- A Call Control Application configured in the Telnyx Portal with a webhook URL.
- ngrok or similar tool to expose your local server to the internet for webhook testing.
- Bundler (Ruby package manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-ivr-phone-menu-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-ivr-phone-menu-ruby
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` and implement the IVR system with call control, DTMF collection, and routing logic:

```ruby
require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize Telnyx client with API key
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# In-memory call state storage (use Redis in production)
$call_state = {}

# Helper function to extract serializable data from SDK responses
def serialize_call(call_data)
  {
    call_control_id: call_data.call_control_id,
    state: call_data.state,
    is_alive: call_data.is_alive
  }
end

# Helper function to play a prompt and collect DTMF
def play_prompt_and_collect(client, call_control_id, prompt_text, max_digits)
  """Play a voice prompt and collect DTMF input."""
  begin
    # Speak the prompt using text-to-speech
    client.calls.actions.speak(
      call_control_id,
      payload: prompt_text,
      voice: "female",
      language: "en-US"
    )
    
    # Start DTMF collection
    client.calls.actions.gather_using_speak(
      call_control_id,
      payload: prompt_text,
      voice: "female",
      language: "en-US",
      max_digits: max_digits,
      timeout_millis: 5000
    )
  rescue Telnyx::APIStatusError => e
    puts "Error playing prompt: #{e.message}"
  end
end

# Webhook endpoint to handle inbound calls
post "/webhooks/call" do
  request.body.rewind
  payload = JSON.parse(request.body.read)
  
  event_type = payload["data"]["event_type"]
  call_control_id = payload["data"]["call_control_id"]
  
  case event_type
  when "call.initiated"
    # Inbound call received — answer and start IVR menu
    begin
      client.calls.actions.answer(call_control_id)
      
      # Store call state
      $call_state[call_control_id] = {
        status: "answered",
        menu_level: "main",
        created_at: Time.now
      }
      
      # Play main menu prompt
      play_prompt_and_collect(
        client,
        call_control_id,
        "Welcome to our IVR system. Press 1 for sales, 2 for support, or 3 to repeat this menu.",
        1
      )
      
      status 200
      json({ status: "call_answered" })
    rescue Telnyx::AuthenticationError
      status 401
      json({ error: "Invalid API key" })
    rescue Telnyx::APIStatusError => e
      status e.status_code || 500
      json({ error: e.message })
    rescue Telnyx::APIConnectionError
      status 503
      json({ error: "Network error connecting to Telnyx" })
    end
    
  when "call.dtmf.received"
    # DTMF digit received — route based on selection
    begin
      digit = payload["data"]["dtmf_digit"]
      menu_level = $call_state[call_control_id]&.dig(:menu_level) || "main"
      
      case menu_level
      when "main"
        case digit
        when "1"
          # Route to sales
          $call_state[call_control_id][:menu_level] = "sales"
          client.calls.actions.speak(
            call_control_id,
            payload: "You have selected sales. Transferring you now.",
            voice: "female",
            language: "en-US"
          )
          # Transfer to sales number (replace with actual number)
          client.calls.actions.transfer(
            call_control_id,
            to: "+15551234567"
          )
          
        when "2"
          # Route to support
          $call_state[call_control_id][:menu_level] = "support"
          client.calls.actions.speak(
            call_control_id,
            payload: "You have selected support. Transferring you now.",
            voice: "female",
            language: "en-US"
          )
          # Transfer to support number (replace with actual number)
          client.calls.actions.transfer(
            call_control_id,
            to: "+15559876543"
          )
          
        when "3"
          # Repeat menu
          play_prompt_and_collect(
            client,
            call_control_id,
            "Welcome to our IVR system. Press 1 for sales, 2 for support, or 3 to repeat this menu.",
            1
          )
        else
          # Invalid selection
          client.calls.actions.speak(
            call_control_id,
            payload: "Invalid selection. Please try again.",
            voice: "female",
            language: "en-US"
          )
          play_prompt_and_collect(
            client,
            call_control_id,
            "Press 1 for sales, 2 for support, or 3 to repeat this menu.",
            1
          )
        end
      end
      
      status 200
      json({ status: "dtmf_processed", digit: digit })
    rescue Telnyx::APIStatusError => e
      status e.status_code || 500
      json({ error: e.message })
    end
    
  when "call.hangup"
    # Call ended — clean up state
    $call_state.delete(call_control_id)
    status 200
    json({ status: "call_ended" })
    
  when "call.speak.ended"
    # TTS playback finished
    status 200
    json({ status: "speak_ended" })
    
  else
    status 200
    json({ status: "event_received", event_type: event_type })
  end
end

# Health check endpoint
get "/health" do
  json({ status: "ok" })
end

# Error handler for uncaught exceptions
error do |err|
  status 500
  json({ error: "Internal server error", message: err.message })
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-ivr-phone-menu-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not receiving events | Inbound calls are not triggering the `/webhooks/call` endpoint. | Verify that ngrok is running and the tunnel URL is correct. Update your Call Control Application webhook URL in the Telnyx Portal to match your current ngrok URL (it changes each time you restart ngrok). Ensure the webhook URL is set to `https://your-ngrok-url.ngrok.io/webhooks/call` (not `http`). Check your Sinatra server logs for incoming requests. |
| DTMF digits not being collected | Callers press digits but the IVR does not respond to their input. | Ensure the `call.dtmf.received` webhook event is enabled in your Call Control Application settings. Verify that `gather_using_speak` is being called after the initial prompt. Check that the `max_digits` parameter matches your expected input length. Some phones may require a longer `timeout_millis` value (try 10000 instead of 5000). |
| Call transfer fails with error | The IVR answers the call but transfer to the destination number fails. | Verify that the destination phone numbers in the `transfer` action are in E.164 format (e.g., `+15551234567`). Ensure your Telnyx account has outbound calling permissions. Check that the destination numbers are valid and reachable. Review the Telnyx Portal call logs to see the specific error returned by the API. |
| Authentication error (401) | The application returns `{"error": "Invalid API key"}` when handling webhook events. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes in the `.env` file. Restart the Sinatra server after updating the API key. Confirm that `dotenv/load` is required before any Telnyx client initialization. |
| Call state not persisting across events | The IVR menu level resets or call state is lost between webhook events. | The in-memory `$call_state` hash is suitable only for development. For production, implement persistent state storage using Redis or a database. Ensure the `call_control_id` is correctly extracted from each webhook payload and used as the state key. Add logging to track state changes: `puts "State: #{$call_state[call_control_id]}"`. |

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
- [Transfer Calls Between Numbers](/tutorials/voice/ruby/call-transfer).
- [Record and Store Call Audio](/tutorials/voice/ruby/call-recording).
