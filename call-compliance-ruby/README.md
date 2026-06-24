# Call Compliance with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready Sinatra application that enforces call compliance by recording all inbound and outbound calls, logging call metadata, and storing recordings for audit purposes. This tutorial demonstrates the Telnyx Voice API's call control capabilities, webhook event handling, and secure credential management using the Ruby SDK.

Call compliance is critical for regulated industries (finance, healthcare, legal). This guide shows how to automatically record calls, track call duration and participants, and maintain an audit trail using Telnyx's Call Control API with Sinatra webhooks.

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
- A Telnyx phone number enabled for inbound and outbound calls.
- A Call Control Application configured in the Telnyx Portal (note the Connection ID).
- A publicly accessible webhook URL (use ngrok for local development).
- Bundler (Ruby dependency manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-compliance-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` and initialize the Telnyx client with proper error handling:

```ruby
require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize Telnyx client with API key from environment
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# In-memory call registry for tracking active calls and compliance data
# In production, use a database (PostgreSQL, MongoDB, etc.)
CALL_REGISTRY = {}
CALL_LOCK = Mutex.new

# Helper function to log call metadata for compliance
def log_call_metadata(call_control_id, metadata)
  """Store call metadata in registry for audit trail."""
  CALL_LOCK.synchronize do
    CALL_REGISTRY[call_control_id] ||= {}
    CALL_REGISTRY[call_control_id].merge!(metadata)
  end
end

# Helper function to retrieve call metadata
def get_call_metadata(call_control_id)
  """Retrieve stored call metadata."""
  CALL_LOCK.synchronize do
    CALL_REGISTRY[call_control_id] || {}
  end
end

# Helper function to initiate a compliant outbound call with recording
def initiate_compliant_call(to_number)
  """Dial outbound call and automatically start recording."""
  from_number = ENV["TELNYX_PHONE_NUMBER"]
  connection_id = ENV["TELNYX_CONNECTION_ID"]
  
  unless from_number && connection_id
    raise "TELNYX_PHONE_NUMBER and TELNYX_CONNECTION_ID must be set"
  end
  
  # Validate E.164 format
  unless to_number.start_with?("+")
    raise "Phone number must be in E.164 format (e.g., +15551234567)"
  end
  
  # Initiate the call
  response = client.calls.dial(
    from_: from_number,
    to: to_number,
    connection_id: connection_id
  )
  
  call_control_id = response.data.call_control_id
  
  # Log initial call metadata for compliance
  log_call_metadata(call_control_id, {
    call_control_id: call_control_id,
    from: from_number,
    to: to_number,
    initiated_at: Time.now.iso8601,
    status: "initiated",
    recording_enabled: true
  })
  
  # Return serializable response
  {
    call_control_id: call_control_id,
    from: from_number,
    to: to_number,
    status: "initiated"
  }
end

# Webhook endpoint for call.initiated event
post "/webhooks/call-initiated" do
  request.body.rewind
  payload = JSON.parse(request.body.read)
  
  call_control_id = payload.dig("data", "call_control_id")
  from_number = payload.dig("data", "from", "phone_number")
  to_number = payload.dig("data", "to", "phone_number")
  direction = payload.dig("data", "direction")
  
  # Log call initiation for compliance
  log_call_metadata(call_control_id, {
    call_control_id: call_control_id,
    from: from_number,
    to: to_number,
    direction: direction,
    initiated_at: Time.now.iso8601,
    status: "initiated"
  })
  
  puts "[COMPLIANCE] Call initiated: #{call_control_id} from #{from_number} to #{to_number}"
  
  json({ status: "received" })
end

# Webhook endpoint for call.answered event
post "/webhooks/call-answered" do
  request.body.rewind
  payload = JSON.parse(request.body.read)
  
  call_control_id = payload.dig("data", "call_control_id")
  
  # Update call metadata with answer time
  log_call_metadata(call_control_id, {
    answered_at: Time.now.iso8601,
    status: "answered"
  })
  
  # Start recording immediately upon answer for compliance
  begin
    client.calls.actions.start_recording(
      call_control_id,
      format: "wav"
    )
    
    log_call_metadata(call_control_id, {
      recording_started_at: Time.now.iso8601,
      recording_status: "active"
    })
    
    puts "[COMPLIANCE] Recording started for call: #{call_control_id}"
  rescue Telnyx::APIStatusError => e
    puts "[ERROR] Failed to start recording: #{e.message}"
  end
  
  json({ status: "received" })
end

# Webhook endpoint for call.hangup event
post "/webhooks/call-hangup" do
  request.body.rewind
  payload = JSON.parse(request.body.read)
  
  call_control_id = payload.dig("data", "call_control_id")
  hangup_reason = payload.dig("data", "hangup_reason")
  
  # Stop recording before call ends
  begin
    client.calls.actions.stop_recording(call_control_id)
    
    log_call_metadata(call_control_id, {
      recording_stopped_at: Time.now.iso8601,
      recording_status: "stopped"
    })
  rescue Telnyx::APIStatusError => e
    puts "[ERROR] Failed to stop recording: #{e.message}"
  end
  
  # Update call metadata with hangup information
  metadata = get_call_metadata(call_control_id)
  duration_seconds = if metadata[:answered_at] && metadata[:initiated_at]
    (Time.parse(metadata[:answered_at]) - Time.parse(metadata[:initiated_at])).to_i
  else
    0
  end
  
  log_call_metadata(call_control_id, {
    hangup_reason: hangup_reason,
    hangup_at: Time.now.iso8601,
    status: "completed",
    duration_seconds: duration_seconds
  })
  
  puts "[COMPLIANCE] Call completed: #{call_control_id} (#{duration_seconds}s, reason: #{hangup_reason})"
  
  json({ status: "received" })
end

# Webhook endpoint for call.recording.saved event
post "/webhooks/call-recording-saved" do
  request.body.rewind
  payload = JSON.parse(request.body.read)
  
  call_control_id = payload.dig("data", "call_control_id")
  recording_url = payload.dig("data", "recording_urls", 0)
  
  # Store recording URL for audit trail
  log_call_metadata(call_control_id, {
    recording_url: recording_url,
    recording_saved_at: Time.now.iso8601
  })
  
  puts "[COMPLIANCE] Recording saved for call #{call_control_id}: #{recording_url}"
  
  json({ status: "received" })
end

# HTTP endpoint to initiate a compliant outbound call
post "/calls/initiate" do
  data = JSON.parse(request.body.read) rescue {}
  
  to_number = data["to"]
  
  unless to_number
    return [400, { "Content-Type" => "application/json" }, 
            JSON.generate({ error: "Missing required field: 'to'" })]
  end
  
  begin
    result = initiate_compliant_call(to_number)
    [200, { "Content-Type" => "application/json" }, JSON.generate(result)]
  rescue Telnyx::AuthenticationError
    [401, { "Content-Type" => "application/json" }, 
     JSON.generate({ error: "Invalid API key" })]
  rescue Telnyx::RateLimitError
    [429, { "Content-Type" => "application/json" }, 
     JSON.generate({ error: "Rate limit exceeded. Please slow down." })]
  rescue Telnyx::APIStatusError => e
    [e.status_code || 500, { "Content-Type" => "application/json" }, 
     JSON.generate({ error: e.message, status_code: e.status_code })]
  rescue Telnyx::APIConnectionError
    [503, { "Content-Type" => "application/json" }, 
     JSON.generate({ error: "Network error connecting to Telnyx" })]
  rescue StandardError => e
    [400, { "Content-Type" => "application/json" }, 
     JSON.generate({ error: e.message })]
  end
end

# HTTP endpoint to retrieve call compliance metadata
get "/calls/:call_control_id/metadata" do
  call_control_id = params[:call_control_id]
  metadata = get_call_metadata(call_control_id)
  
  if metadata.empty?
    return [404, { "Content-Type" => "application/json" }, 
            JSON.generate({ error: "Call not found" })]
  end
  
  [200, { "Content-Type" => "application/json" }, JSON.generate(metadata)]
end

# HTTP endpoint to list all recorded calls (compliance audit)
get "/calls/audit/list" do
  audit_list = CALL_LOCK.synchronize do
    CALL_REGISTRY.map do |call_id, metadata|
      {
        call_control_id: call_id,
        from: metadata[:from],
        to: metadata[:to],
        direction: metadata[:direction],
        status: metadata[:status],
        duration_seconds: metadata[:duration_seconds],
        initiated_at: metadata[:initiated_at],
        answered_at: metadata[:answered_at],
        hangup_at: metadata[:hangup_at],
        recording_url: metadata[:recording_url],
        recording_status: metadata[:recording_status]
      }
    end
  end
  
  [200, { "Content-Type" => "application/json" }, JSON.generate(audit_list)]
end

# Health check endpoint
get "/health" do
  json({ status: "ok" })
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-compliance-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Sinatra server. |
| Webhooks Not Received | Call events (call.initiated, call.answered, call.hangup) are not triggering webhook endpoints. | Confirm your ngrok URL is set correctly in the Telnyx Portal's Call Control Application webhook settings. Ensure the webhook URL format is `https://your-ngrok-url.ngrok.io/webhooks/call-initiated` (with the full path). Check that your Sinatra server is running and accessible from the internet. Use `ngrok http 4567` to expose your local server. |
| Recording Not Starting | Calls complete but no recording is saved; `recording_status` remains `null`. | Verify that your Call Control Application has recording enabled in the Telnyx Portal. Ensure the `start_recording()` call is made after the call is answered (in the `call.answered` webhook). Check that the call duration is at least a few seconds—very short calls may not generate recordings. Review server logs for `[ERROR] Failed to start recording` messages. |
| Connection ID Not Found | The application raises an error about missing or invalid `TELNYX_CONNECTION_ID`. | Confirm your `.env` file contains the correct Connection ID from the Telnyx Portal (found under Call Control Applications). The Connection ID links your phone number to your Call Control application. Restart the Sinatra server after updating the `.env` file. |
| Phone Number Format Error | Requests fail with "Phone number must be in E.164 format". | Ensure all phone numbers start with `+` followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your curl requests and test data to use properly formatted numbers. |

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
- [Record and Store Call Audio](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/ruby/call-recording).
- [Transfer Calls Between Agents](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/ruby/call-transfer).
