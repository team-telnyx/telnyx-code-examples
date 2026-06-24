# Warm Transfer with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready Sinatra application that implements warm transfer—a call control pattern where an agent speaks with a caller before transferring them to another party. This tutorial demonstrates the Telnyx Voice API's command-event model, webhook handling, and call state management using the Ruby SDK.

Warm transfer differs from blind transfer: the agent confirms the transfer is appropriate before connecting the parties. You'll learn to initiate calls, answer incoming calls, speak to callers, and transfer them while maintaining call control throughout.

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
- A Call Control Application configured in the Telnyx Portal (note the Connection ID).
- Bundler (Ruby dependency manager).
- A publicly accessible URL for webhook delivery (ngrok for local development).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/warm-transfer-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` and initialize the Telnyx client. Define helper functions to manage call state and control actions:

```ruby
require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize Telnyx client with the new SDK pattern
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# In-memory store for call state (use Redis in production)
$call_state = {}

def initiate_call(to_number)
  """Initiate an outbound call and return call control ID."""
  client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])
  
  response = client.calls.dial(
    from_: ENV["TELNYX_PHONE_NUMBER"],
    to: to_number,
    connection_id: ENV["TELNYX_CONNECTION_ID"]
  )
  
  # Store call state for webhook handling
  call_control_id = response.data.call_control_id
  $call_state[call_control_id] = {
    status: "initiated",
    to: to_number,
    created_at: Time.now.to_i
  }
  
  {
    call_control_id: call_control_id,
    status: "initiated"
  }
end

def answer_call(call_control_id)
  """Answer an incoming call."""
  client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])
  
  response = client.calls.actions.answer(call_control_id)
  
  $call_state[call_control_id] ||= {}
  $call_state[call_control_id][:status] = "answered"
  
  {
    call_control_id: call_control_id,
    status: "answered"
  }
end

def speak_to_caller(call_control_id, message)
  """Play text-to-speech message to the caller."""
  client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])
  
  response = client.calls.actions.speak(
    call_control_id,
    payload: message,
    voice: "female",
    language: "en-US"
  )
  
  {
    call_control_id: call_control_id,
    message: message
  }
end

def transfer_call(call_control_id, transfer_to)
  """Transfer the call to another party."""
  client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])
  
  response = client.calls.actions.transfer(
    call_control_id,
    to: transfer_to
  )
  
  $call_state[call_control_id] ||= {}
  $call_state[call_control_id][:status] = "transferred"
  $call_state[call_control_id][:transferred_to] = transfer_to
  
  {
    call_control_id: call_control_id,
    status: "transferred",
    transferred_to: transfer_to
  }
end

def hangup_call(call_control_id)
  """Terminate the call."""
  client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])
  
  response = client.calls.actions.hangup(call_control_id)
  
  $call_state[call_control_id] ||= {}
  $call_state[call_control_id][:status] = "hangup"
  
  {
    call_control_id: call_control_id,
    status: "hangup"
  }
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/warm-transfer-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Sinatra server. |
| Webhook Events Not Received | The `/webhooks/call-events` endpoint is never called, and calls appear stuck in "initiated" state. | Confirm your Call Control Application webhook URL in the Telnyx Portal points to your ngrok URL (e.g., `https://your-ngrok-url.ngrok.io/webhooks/call-events`). Verify ngrok is running and the tunnel is active. Check Sinatra logs for incoming POST requests. Ensure your firewall allows inbound traffic on port 4567. |
| Transfer Fails with "Invalid Destination" | The transfer endpoint returns a 400 error or Telnyx API error about invalid phone number. | Ensure the `transfer_to` parameter uses E.164 format (e.g., `+15551234567`). Verify the destination number is valid and capable of receiving calls. Check that `TRANSFER_DESTINATION` in your `.env` file is correctly formatted. Test with a known working phone number. |
| Call State Not Persisting | After restarting the server, previous call states are lost and `/calls/:call_control_id` returns 404. | The in-memory `$call_state` hash is cleared on server restart. For production, replace it with Redis or a database. For development, this is expected behavior—restart ngrok and your Sinatra server together to maintain state during testing. |
| Connection ID Not Found | The API returns an error about an invalid or missing connection ID. | Verify `TELNYX_CONNECTION_ID` in your `.env` file matches your Call Control Application ID from the Telnyx Portal. Ensure the application is active and linked to your phone number. Regenerate the connection ID in the Portal if needed and update your `.env` file. |

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

- [Implement an IVR Menu with Ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/ruby/ivr-menu).
- [Record Calls with Ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/ruby/call-recording).
- [Handle Inbound Calls with Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/ruby/inbound-call-webhook).
