# Conference Call with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready Sinatra application that manages multi-participant conference calls using the Telnyx Voice API. This tutorial demonstrates how to initiate calls, add participants to a conference, handle webhook events, and manage call state in real time. You'll learn the command-event model that powers Telnyx Call Control, including proper error handling and secure credential management.

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
- A Call Control Application configured in the Telnyx Portal (to obtain your `TELNYX_CONNECTION_ID`).
- Bundler (Ruby dependency manager).
- A publicly accessible URL for webhook callbacks (ngrok recommended for local development).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-conference-calling-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-conference-calling-ruby
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` and initialize the Telnyx client using the new SDK pattern. Define helper functions to manage conference participants and handle call state:

```ruby
require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize Telnyx client with API key from environment
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# In-memory store for conference state (use Redis in production)
$conferences = {}
$call_states = {}

def initiate_call(to_number, conference_id)
  """Initiate an outbound call and add to conference."""
  client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])
  
  response = client.calls.dial(
    from_: ENV["TELNYX_PHONE_NUMBER"],
    to: to_number,
    connection_id: ENV["TELNYX_CONNECTION_ID"]
  )
  
  # Extract serializable data — SDK objects are NOT JSON-serializable
  {
    call_control_id: response.data.call_control_id,
    to: to_number,
    conference_id: conference_id,
    status: "initiated"
  }
end

def add_to_conference(call_control_id, conference_id)
  """Add an active call to a conference."""
  client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])
  
  response = client.calls.actions.bridge(
    call_control_id,
    call_control_ids: [call_control_id],
    conference_id: conference_id
  )
  
  {
    call_control_id: response.data.call_control_id,
    conference_id: conference_id,
    status: "added_to_conference"
  }
end

def hangup_call(call_control_id)
  """Terminate a call."""
  client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])
  
  response = client.calls.actions.hangup(call_control_id)
  
  {
    call_control_id: response.data.call_control_id,
    status: "hangup_initiated"
  }
end

def get_conference_status(conference_id)
  """Retrieve current conference state."""
  conference = $conferences[conference_id] || {}
  
  {
    conference_id: conference_id,
    participants: conference[:participants] || [],
    created_at: conference[:created_at],
    participant_count: (conference[:participants] || []).length
  }
end
```

Create routes to manage conference calls:

```ruby
# POST /conferences/create — Create a new conference
post "/conferences/create" do
  content_type :json
  
  conference_id = "conf_#{Time.now.to_i}_#{rand(10000)}"
  
  $conferences[conference_id] = {
    created_at: Time.now.iso8601,
    participants: []
  }
  
  json({
    conference_id: conference_id,
    status: "created"
  })
end

# POST /conferences/:conference_id/invite — Invite participant to conference
post "/conferences/:conference_id/invite" do
  content_type :json
  conference_id = params[:conference_id]
  
  data = JSON.parse(request.body.read)
  to_number = data["to"]
  
  unless to_number
    return [400, json({ error: "Missing required field: 'to'" })]
  end
  
  unless to_number.start_with?("+")
    return [400, json({ error: "Phone number must be in E.164 format (e.g., +15551234567)" })]
  end
  
  begin
    result = initiate_call(to_number, conference_id)
    
    # Track participant in conference state
    $conferences[conference_id] ||= { participants: [], created_at: Time.now.iso8601 }
    $conferences[conference_id][:participants] << result[:call_control_id]
    
    json(result)
    
  rescue Telnyx::AuthenticationError
    [401, json({ error: "Invalid API key" })]
  rescue Telnyx::RateLimitError
    [429, json({ error: "Rate limit exceeded. Please slow down." })]
  rescue Telnyx::APIStatusError => e
    [e.status_code, json({ error: e.message, status_code: e.status_code })]
  rescue Telnyx::APIConnectionError
    [503, json({ error: "Network error connecting to Telnyx" })]
  rescue StandardError => e
    [500, json({ error: e.message })]
  end
end

# GET /conferences/:conference_id/status — Get conference status
get "/conferences/:conference_id/status" do
  content_type :json
  conference_id = params[:conference_id]
  
  status = get_conference_status(conference_id)
  json(status)
end

# POST /conferences/:conference_id/hangup — End conference and disconnect all participants
post "/conferences/:conference_id/hangup" do
  content_type :json
  conference_id = params[:conference_id]
  
  conference = $conferences[conference_id]
  unless conference
    return [404, json({ error: "Conference not found" })]
  end
  
  begin
    results = []
    (conference[:participants] || []).each do |call_control_id|
      result = hangup_call(call_control_id)
      results << result
    end
    
    # Clean up conference state
    $conferences.delete(conference_id)
    
    json({
      conference_id: conference_id,
      disconnected_participants: results.length,
      status: "conference_ended"
    })
    
  rescue Telnyx::AuthenticationError
    [401, json({ error: "Invalid API key" })]
  rescue Telnyx::APIStatusError => e
    [e.status_code, json({ error: e.message, status_code: e.status_code })]
  rescue Telnyx::APIConnectionError
    [503, json({ error: "Network error connecting to Telnyx" })]
  rescue StandardError => e
    [500, json({ error: e.message })]
  end
end

# POST /webhooks/call-events — Receive and process call control webhooks
post "/webhooks/call-events" do
  content_type :json
  
  payload = JSON.parse(request.body.read)
  event_type = payload["data"]["event_type"]
  call_control_id = payload["data"]["call_control_id"]
  
  case event_type
  when "call.initiated"
    $call_states[call_control_id] = { status: "initiated", initiated_at: Time.now.iso8601 }
    puts "Call initiated: #{call_control_id}"
    
  when "call.answered"
    $call_states[call_control_id] ||= {}
    $call_states[call_control_id][:status] = "answered"
    $call_states[call_control_id][:answered_at] = Time.now.iso8601
    puts "Call answered: #{call_control_id}"
    
  when "call.hangup"
    $call_states[call_control_id] ||= {}
    $call_states[call_control_id][:status] = "hangup"
    $call_states[call_control_id][:hangup_at] = Time.now.iso8601
    puts "Call hangup: #{call_control_id}"
    
  when "call.bridge.started"
    $call_states[call_control_id] ||= {}
    $call_states[call_control_id][:status] = "in_conference"
    puts "Call added to conference: #{call_control_id}"
    
  else
    puts "Unhandled event type: #{event_type}"
  end
  
  json({ status: "received" })
end

# GET / — Health check
get "/" do
  content_type :json
  json({ status: "ok", service: "telnyx-conference-call" })
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-conference-calling-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Sinatra server. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Connection ID Not Found | The API returns an error about an invalid or missing `connection_id`. | Verify that `TELNYX_CONNECTION_ID` in your `.env` file matches your Call Control Application ID from the Telnyx Portal. The connection ID is a static configuration value that links your phone number to your Call Control application. Do not confuse it with `call_control_id`, which is returned per call. |
| Webhooks Not Received | Call events are not triggering your webhook handler at `/webhooks/call-events`. | Ensure your Sinatra server is publicly accessible via ngrok or another tunneling service. Update the webhook URL in your Telnyx Call Control Application settings to point to `https://your-ngrok-url.ngrok.io/webhooks/call-events`. Verify that the ngrok tunnel is active and the Sinatra server is running. Check your server logs for incoming POST requests. |
| Conference State Lost on Restart | Participants are lost when the Sinatra server restarts because state is stored in memory. | For production use, replace the in-memory `$conferences` hash with a persistent data store like Redis. Store conference metadata (participants, creation time, status) in Redis with a TTL to auto-clean expired conferences. This ensures state survives server restarts and scales across multiple instances. |

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
- [Record and Retrieve Call Recordings](/tutorials/voice/ruby/call-recording).
- [Transfer Calls Between Participants](/tutorials/voice/ruby/call-transfer).
