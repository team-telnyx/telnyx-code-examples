# Whisper Prompt with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready Sinatra application that initiates outbound calls with a whisper prompt—a message played to the caller before the call is connected to the recipient. This tutorial demonstrates the Telnyx Voice API's call control capabilities, webhook event handling, and the command-event model for managing call state in real time.

A whisper prompt is commonly used in contact centers to inform agents of caller context before they answer, or to play disclaimers to callers before connecting them to a destination.

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
- A Call Control Application configured in the Telnyx Portal with a webhook URL pointing to your server.
- Bundler (Ruby dependency manager).
- A publicly accessible URL for webhook delivery (use ngrok for local development).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-whisper-monitoring-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` and initialize the Telnyx client using the Ruby SDK pattern. Define helper functions to handle call initiation and webhook event processing:

```ruby
require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize Telnyx client with API key from environment
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# Helper function to initiate a call with whisper prompt
def initiate_call_with_whisper(to_number, whisper_text, client)
  """
  Initiate an outbound call and prepare to play a whisper prompt.
  
  The whisper prompt is played to the caller before the call connects
  to the recipient. This is useful for agent context or disclaimers.
  """
  from_number = ENV["TELNYX_PHONE_NUMBER"]
  connection_id = ENV["TELNYX_CONNECTION_ID"]
  
  unless from_number && connection_id
    raise "Missing required environment variables: TELNYX_PHONE_NUMBER or TELNYX_CONNECTION_ID"
  end
  
  # Validate E.164 format to prevent API errors
  unless to_number.start_with?("+")
    raise "Phone number must be in E.164 format (e.g., +15551234567)"
  end
  
  # Initiate the call using client.calls.dial()
  # connection_id is REQUIRED and comes from your Call Control Application
  # Do NOT pass call_control_id to dial() — it is returned in the response
  response = client.calls.dial(
    from_: from_number,
    to: to_number,
    connection_id: connection_id
  )
  
  # Extract call_control_id from response — use it for subsequent actions
  call_control_id = response.data.call_control_id
  
  # Return serializable data (SDK objects are NOT JSON-serializable)
  {
    call_control_id: call_control_id,
    from: from_number,
    to: to_number,
    whisper_text: whisper_text,
    status: "initiated"
  }
end

# Helper function to play whisper prompt to caller
def play_whisper_prompt(call_control_id, whisper_text, client)
  """
  Play a text-to-speech message to the caller before connecting to recipient.
  
  This uses the speak action to play audio. In production, you would typically
  trigger this from a webhook event (call.answered) to ensure the call is ready.
  """
  response = client.calls.actions.speak(
    call_control_id: call_control_id,
    payload: whisper_text,
    voice: "female"
  )
  
  {
    call_control_id: call_control_id,
    action: "speak",
    status: "queued"
  }
end

# Helper function to transfer call to recipient after whisper
def transfer_call(call_control_id, to_number, client)
  """
  Transfer the call to the final recipient after whisper prompt completes.
  
  This is typically triggered by a call.speak.ended webhook event.
  """
  response = client.calls.actions.transfer(
    call_control_id: call_control_id,
    to: to_number
  )
  
  {
    call_control_id: call_control_id,
    action: "transfer",
    to: to_number,
    status: "initiated"
  }
end

# Sinatra route to initiate a call with whisper prompt
post "/calls/initiate-whisper" do
  content_type :json
  
  data = JSON.parse(request.body.read) rescue {}
  
  unless data["to"] && data["whisper_text"]
    return [400, { error: "Missing required fields: 'to' and 'whisper_text'" }.to_json]
  end
  
  to_number = data["to"]
  whisper_text = data["whisper_text"]
  
  begin
    result = initiate_call_with_whisper(to_number, whisper_text, client)
    [200, result.to_json]
    
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

# Webhook endpoint to handle call events
post "/webhooks/call" do
  content_type :json
  
  payload = JSON.parse(request.body.read) rescue {}
  event_type = payload.dig("data", "event_type")
  call_control_id = payload.dig("data", "call_control_id")
  
  case event_type
  when "call.answered"
    # Call has been answered by the caller — play whisper prompt
    whisper_text = payload.dig("data", "custom_headers", "whisper_text") || "Please wait while we connect your call."
    
    begin
      play_whisper_prompt(call_control_id, whisper_text, client)
      [200, { status: "whisper_queued" }.to_json]
    rescue => e
      [500, { error: e.message }.to_json]
    end
    
  when "call.speak.ended"
    # Whisper prompt has finished — transfer to recipient
    to_number = payload.dig("data", "custom_headers", "transfer_to")
    
    if to_number
      begin
        transfer_call(call_control_id, to_number, client)
        [200, { status: "transfer_initiated" }.to_json]
      rescue => e
        [500, { error: e.message }.to_json]
      end
    else
      [400, { error: "Missing transfer_to in custom headers" }.to_json]
    end
    
  when "call.hangup"
    # Call has ended — log for cleanup
    [200, { status: "call_ended", call_control_id: call_control_id }.to_json]
    
  else
    # Acknowledge other events without processing
    [200, { status: "acknowledged" }.to_json]
  end
end

# Health check endpoint
get "/health" do
  content_type :json
  { status: "ok" }.to_json
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-whisper-monitoring-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Sinatra server. |
| Missing Connection ID | The application raises an error about missing `TELNYX_CONNECTION_ID` on the first call. | Confirm your `.env` file contains `TELNYX_CONNECTION_ID` set to your Call Control Application ID from the Telnyx Portal. This is a static configuration value that links your phone number to call control capabilities. Verify it is not empty or malformed. |
| Webhooks Not Received | Call events are initiated but webhook endpoints are never triggered. | Ensure your Call Control Application in the Telnyx Portal has the correct webhook URL configured (e.g., `https://your-domain.com/webhooks/call`). If testing locally, use ngrok to expose your server and update the webhook URL. Verify that your firewall and network allow inbound HTTPS traffic on port 443. Check Sinatra logs for incoming POST requests to `/webhooks/call`. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Call Not Transferring After Whisper | The whisper prompt plays but the call does not transfer to the recipient. | Verify that your webhook is receiving the `call.speak.ended` event. Check that the `transfer_to` value is being passed correctly in custom headers or stored in your application state. Ensure the transfer destination number is in E.164 format. Review Telnyx logs in the Portal for any transfer action errors. |

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

- [Handle Inbound Call Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/ruby/inbound-call-webhook).
- [Record Calls with Ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/ruby/call-recording).
- [Build an IVR Menu](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/ruby/ivr-menu).
