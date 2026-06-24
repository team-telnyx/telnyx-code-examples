# Hold Music with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready Sinatra application that places callers on hold with custom music using the Telnyx Voice API. This tutorial demonstrates the command-event model for call control, webhook handling for real-time call state management, and audio streaming integration. You'll learn how to initiate calls, detect when they're answered, and stream hold music while managing the call lifecycle.

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
- A Telnyx Call Control Application configured with a webhook URL.
- A publicly accessible URL for receiving webhooks (use ngrok for local development).
- A valid audio file URL (MP3 or WAV) for hold music.
- Bundler (Ruby package manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/hold-music-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` with the Sinatra application, webhook handler, and call control logic:

```ruby
#!/usr/bin/env ruby
"""Production-ready Sinatra app for hold music with Telnyx Voice API."""

require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize Telnyx client with the new SDK pattern
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# In-memory store for active calls (use Redis in production)
$active_calls = {}

# Configure Sinatra
set :port, 4567
set :bind, "0.0.0.0"

# Helper function to initiate an outbound call
def initiate_call(to_number, client)
  """Initiate an outbound call and return call_control_id."""
  from_number = ENV["TELNYX_PHONE_NUMBER"]
  connection_id = ENV["TELNYX_CONNECTION_ID"]
  
  unless from_number && connection_id
    raise ArgumentError, "TELNYX_PHONE_NUMBER and TELNYX_CONNECTION_ID must be set"
  end
  
  # Validate E.164 format
  unless to_number.start_with?("+")
    raise ArgumentError, "Phone number must be in E.164 format (e.g., +15551234567)"
  end
  
  # Use client.calls.dial() — returns CallDialResponse
  response = client.calls.dial(
    from_: from_number,
    to: to_number,
    connection_id: connection_id
  )
  
  # Extract call_control_id from response — this is returned, not passed in
  {
    call_control_id: response.data.call_control_id,
    from: from_number,
    to: to_number
  }
end

# Helper function to start hold music playback
def start_hold_music(call_control_id, client)
  """Stream hold music to an active call."""
  hold_music_url = ENV["HOLD_MUSIC_URL"]
  
  unless hold_music_url
    raise ArgumentError, "HOLD_MUSIC_URL environment variable not set"
  end
  
  # Use client.calls.actions.playback_start() to stream audio
  response = client.calls.actions.playback_start(
    call_control_id,
    audio_url: hold_music_url
  )
  
  {
    call_control_id: response.data.call_control_id,
    state: response.data.state
  }
end

# Helper function to stop hold music
def stop_hold_music(call_control_id, client)
  """Stop audio playback on a call."""
  response = client.calls.actions.playback_stop(call_control_id)
  
  {
    call_control_id: response.data.call_control_id,
    state: response.data.state
  }
end

# Helper function to hangup a call
def hangup_call(call_control_id, client)
  """Terminate an active call."""
  response = client.calls.actions.hangup(call_control_id)
  
  {
    call_control_id: response.data.call_control_id,
    state: response.data.state
  }
end

# POST /calls/initiate — Initiate an outbound call
post "/calls/initiate" do
  content_type :json
  
  data = JSON.parse(request.body.read) rescue {}
  
  to_number = data["to"]
  
  unless to_number
    return [400, { error: "Missing required field: 'to'" }.to_json]
  end
  
  begin
    result = initiate_call(to_number, client)
    
    # Store call in memory for webhook correlation
    $active_calls[result[:call_control_id]] = {
      to: to_number,
      from: result[:from],
      initiated_at: Time.now.to_i,
      state: "initiated"
    }
    
    [200, result.to_json]
    
  rescue Telnyx::AuthenticationError
    [401, { error: "Invalid API key" }.to_json]
  rescue Telnyx::RateLimitError
    [429, { error: "Rate limit exceeded. Please slow down." }.to_json]
  rescue Telnyx::APIStatusError => e
    [e.status_code, { error: e.message, status_code: e.status_code }.to_json]
  rescue Telnyx::APIConnectionError
    [503, { error: "Network error connecting to Telnyx" }.to_json]
  rescue ArgumentError => e
    [400, { error: e.message }.to_json]
  end
end

# POST /calls/:call_control_id/hold — Start hold music on a call
post "/calls/:call_control_id/hold" do
  content_type :json
  call_control_id = params[:call_control_id]
  
  unless $active_calls[call_control_id]
    return [404, { error: "Call not found" }.to_json]
  end
  
  begin
    result = start_hold_music(call_control_id, client)
    
    # Update call state
    $active_calls[call_control_id][:state] = "on_hold"
    
    [200, result.to_json]
    
  rescue Telnyx::AuthenticationError
    [401, { error: "Invalid API key" }.to_json]
  rescue Telnyx::RateLimitError
    [429, { error: "Rate limit exceeded. Please slow down." }.to_json]
  rescue Telnyx::APIStatusError => e
    [e.status_code, { error: e.message, status_code: e.status_code }.to_json]
  rescue Telnyx::APIConnectionError
    [503, { error: "Network error connecting to Telnyx" }.to_json]
  rescue ArgumentError => e
    [400, { error: e.message }.to_json]
  end
end

# POST /calls/:call_control_id/resume — Stop hold music and resume call
post "/calls/:call_control_id/resume" do
  content_type :json
  call_control_id = params[:call_control_id]
  
  unless $active_calls[call_control_id]
    return [404, { error: "Call not found" }.to_json]
  end
  
  begin
    result = stop_hold_music(call_control_id, client)
    
    # Update call state
    $active_calls[call_control_id][:state] = "active"
    
    [200, result.to_json]
    
  rescue Telnyx::AuthenticationError
    [401, { error: "Invalid API key" }.to_json]
  rescue Telnyx::RateLimitError
    [429, { error: "Rate limit exceeded. Please slow down." }.to_json]
  rescue Telnyx::APIStatusError => e
    [e.status_code, { error: e.message, status_code: e.status_code }.to_json]
  rescue Telnyx::APIConnectionError
    [503, { error: "Network error connecting to Telnyx" }.to_json]
  rescue ArgumentError => e
    [400, { error: e.message }.to_json]
  end
end

# POST /calls/:call_control_id/hangup — Terminate a call
post "/calls/:call_control_id/hangup" do
  content_type :json
  call_control_id = params[:call_control_id]
  
  unless $active_calls[call_control_id]
    return [404, { error: "Call not found" }.to_json]
  end
  
  begin
    result = hangup_call(call_control_id, client)
    
    # Remove call from memory
    $active_calls.delete(call_control_id)
    
    [200, result.to_json]
    
  rescue Telnyx::AuthenticationError
    [401, { error: "Invalid API key" }.to_json]
  rescue Telnyx::RateLimitError
    [429, { error: "Rate limit exceeded. Please slow down." }.to_json]
  rescue Telnyx::APIStatusError => e
    [e.status_code, { error: e.message, status_code: e.status_code }.to_json]
  rescue Telnyx::APIConnectionError
    [503, { error: "Network error connecting to Telnyx" }.to_json]
  rescue ArgumentError => e
    [400, { error: e.message }.to_json]
  end
end

# POST /webhooks/call — Receive call state change events
post "/webhooks/call" do
  content_type :json
  
  payload = JSON.parse(request.body.read) rescue {}
  event_type = payload["data"]&.dig("event_type")
  call_control_id = payload["data"]&.dig("call_control_id")
  
  # Log event for debugging
  puts "[#{Time.now}] Webhook: #{event_type} for call #{call_control_id}"
  
  case event_type
  when "call.initiated"
    # Call started — update state
    if $active_calls[call_control_id]
      $active_calls[call_control_id][:state] = "initiated"
    end
    
  when "call.answered"
    # Call answered — automatically start hold music
    if $active_calls[call_control_id]
      $active_calls[call_control_id][:state] = "answered"
      $active_calls[call_control_id][:answered_at] = Time.now.to_i
      
      # Automatically place on hold
      begin
        start_hold_music(call_control_id, client)
        $active_calls[call_control_id][:state] = "on_hold"
      rescue => e
        puts "[ERROR] Failed to start hold music: #{e.message}"
      end
    end
    
  when "call.hangup"
    # Call ended — clean up
    if $active_calls[call_control_id]
      $active_calls[call_control_id][:state] = "hangup"
      $active_calls[call_control_id][:ended_at] = Time.now.to_i
    end
    
  when "call.playback.started"
    # Hold music started
    if $active_calls[call_control_id]
      $active_calls[call_control_id][:playback_started] = true
    end
    
  when "call.playback.ended"
    # Hold music finished
    if $active_calls[call_control_id]
      $active_calls[call_control_id][:playback_started] = false
    end
  end
  
  # Always return 200 to acknowledge receipt
  [200, { status: "ok" }.to_json]
end

# GET /calls — List active calls
get "/calls" do
  content_type :json
  
  calls = $active_calls.map do |call_control_id, data|
    {
      call_control_id: call_control_id,
      to: data[:to],
      from: data[:from],
      state: data[:state],
      initiated_at: data[:initiated_at],
      answered_at: data[:answered_at],
      ended_at: data[:ended_at]
    }
  end
  
  [200, { calls: calls }.to_json]
end

# GET /health — Health check
get "/health" do
  content_type :json
  [200, { status: "ok" }.to_json]
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/hold-music-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Sinatra server. |
| Webhook Not Received | Call state changes are not triggering webhook events, and the `/webhooks/call` endpoint is never called. | Confirm your Call Control Application in the Telnyx Portal has the webhook URL set to your ngrok URL with `/webhooks/call` path (e.g., `https://abc123.ngrok.io/webhooks/call`). Ensure ngrok is running and the Sinatra server is accessible. Check ngrok's web interface at `http://localhost:4040` to see if requests are arriving. |
| Hold Music Not Playing | The call connects but no audio is heard, or the API returns an error when starting playback. | Verify `HOLD_MUSIC_URL` in your `.env` file points to a valid, publicly accessible audio file (MP3 or WAV). Test the URL in a browser to confirm it's reachable. Ensure the audio file is in a supported format and the URL uses HTTPS. Check the Sinatra server logs for error messages from the `playback_start` call. |
| Call Control ID Not Found | Requests to `/calls/:call_control_id/hold` or `/calls/:call_control_id/resume` return `{"error": "Call not found"}` with HTTP 404. | Verify the `call_control_id` from the `/calls/initiate` response is correct and matches an active call. Use the `/calls` endpoint to list all active calls and confirm the ID exists. If the call has already ended (hangup event received), it will be removed from the in-memory store. |
| Connection ID Missing | The application raises `ArgumentError: TELNYX_PHONE_NUMBER and TELNYX_CONNECTION_ID must be set` on startup. | Confirm your `.env` file contains both `TELNYX_CONNECTION_ID` and `TELNYX_PHONE_NUMBER`. The `TELNYX_CONNECTION_ID` is your Call Control Application ID from the Telnyx Portal. Ensure the file is named exactly `.env` and is in the same directory as `app.rb`. Restart the Sinatra server after updating the file. |

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

- [Handle Inbound Calls with Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/ruby/inbound-call-webhook).
- [Record Calls](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/ruby/call-recording).
- [Transfer Calls Between Numbers](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/ruby/call-transfer).
