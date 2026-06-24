# Call Analytics with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready Sinatra application that tracks call metrics and analytics using the Telnyx Voice API. This tutorial demonstrates how to initiate outbound calls, receive webhook events, store call data, and generate analytics reports. You'll learn the command-event model of Call Control, proper webhook handling, and secure credential management via environment variables.

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
- A Call Control Application ID (connection_id) configured in the Telnyx Portal.
- A publicly accessible URL for webhook delivery (ngrok recommended for local development).
- Bundler (Ruby dependency manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/voice-call-analytics-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` with the Sinatra application, Telnyx client initialization, and database helpers:

```ruby
require "sinatra"
require "telnyx"
require "dotenv/load"
require "sqlite3"
require "json"
require "time"

# Initialize Telnyx client with the new SDK pattern
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# Database helper to initialize connection
def db
  @db ||= SQLite3::Database.new "db/analytics.db"
  @db.results_as_hash = true
  @db
end

# Helper to initiate an outbound call
def initiate_call(to_number)
  from_number = ENV["TELNYX_PHONE_NUMBER"]
  connection_id = ENV["TELNYX_CONNECTION_ID"]
  
  raise "TELNYX_PHONE_NUMBER not set" unless from_number
  raise "TELNYX_CONNECTION_ID not set" unless connection_id
  
  # Validate E.164 format
  raise "Phone number must be in E.164 format (e.g., +15551234567)" unless to_number.start_with?("+")
  
  # Initiate call using Call Control API
  response = client.calls.dial(
    from_: from_number,
    to: to_number,
    connection_id: connection_id
  )
  
  # Extract call_control_id from response
  call_control_id = response.data.call_control_id
  
  # Store call record in database
  db.execute(
    "INSERT INTO calls (call_control_id, from_number, to_number, status, started_at) VALUES (?, ?, ?, ?, ?)",
    [call_control_id, from_number, to_number, "initiated", Time.now.iso8601]
  )
  
  # Return serializable data
  {
    call_control_id: call_control_id,
    from: from_number,
    to: to_number,
    status: "initiated"
  }
end

# Helper to record call event
def record_call_event(call_control_id, event_type, event_data = {})
  db.execute(
    "INSERT INTO call_events (call_control_id, event_type, event_data) VALUES (?, ?, ?)",
    [call_control_id, event_type, event_data.to_json]
  )
end

# Helper to update call status
def update_call_status(call_control_id, status, ended_at = nil)
  if ended_at
    db.execute(
      "UPDATE calls SET status = ?, ended_at = ? WHERE call_control_id = ?",
      [status, ended_at, call_control_id]
    )
  else
    db.execute(
      "UPDATE calls SET status = ? WHERE call_control_id = ?",
      [status, call_control_id]
    )
  end
end

# Helper to calculate call duration
def calculate_duration(call_control_id)
  result = db.execute(
    "SELECT started_at, ended_at FROM calls WHERE call_control_id = ?",
    [call_control_id]
  ).first
  
  return 0 unless result && result["started_at"] && result["ended_at"]
  
  start_time = Time.parse(result["started_at"])
  end_time = Time.parse(result["ended_at"])
  (end_time - start_time).to_i
end

# Route to initiate a call
post "/calls/initiate" do
  content_type :json
  data = JSON.parse(request.body.read)
  
  to_number = data["to"]
  
  return [400, { error: "Missing required field: 'to'" }.to_json] unless to_number
  
  begin
    result = initiate_call(to_number)
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

# Webhook endpoint to receive call events
post "/webhooks/call" do
  content_type :json
  
  begin
    payload = JSON.parse(request.body.read)
    event_type = payload["data"]["event_type"]
    call_control_id = payload["data"]["call_control_id"]
    
    # Record the event in database
    record_call_event(call_control_id, event_type, payload["data"])
    
    # Update call status based on event type
    case event_type
    when "call.answered"
      update_call_status(call_control_id, "answered")
    when "call.hangup"
      update_call_status(call_control_id, "completed", Time.now.iso8601)
    when "call.initiated"
      update_call_status(call_control_id, "initiated")
    end
    
    # Return 200 OK to acknowledge receipt
    [200, { status: "received" }.to_json]
  rescue StandardError => e
    [400, { error: e.message }.to_json]
  end
end

# Route to get call analytics
get "/analytics/calls" do
  content_type :json
  
  begin
    # Fetch all calls with calculated duration
    calls = db.execute("SELECT * FROM calls ORDER BY created_at DESC")
    
    calls_with_duration = calls.map do |call|
      duration = calculate_duration(call["call_control_id"])
      {
        call_control_id: call["call_control_id"],
        from: call["from_number"],
        to: call["to_number"],
        status: call["status"],
        duration_seconds: duration,
        started_at: call["started_at"],
        ended_at: call["ended_at"],
        created_at: call["created_at"]
      }
    end
    
    [200, calls_with_duration.to_json]
  rescue StandardError => e
    [500, { error: e.message }.to_json]
  end
end

# Route to get analytics summary
get "/analytics/summary" do
  content_type :json
  
  begin
    total_calls = db.execute("SELECT COUNT(*) as count FROM calls").first["count"]
    completed_calls = db.execute("SELECT COUNT(*) as count FROM calls WHERE status = 'completed'").first["count"]
    
    total_duration = db.execute(
      "SELECT SUM(CAST((julianday(ended_at) - julianday(started_at)) * 86400 AS INTEGER)) as total FROM calls WHERE ended_at IS NOT NULL"
    ).first["total"] || 0
    
    average_duration = completed_calls > 0 ? (total_duration / completed_calls).to_i : 0
    
    summary = {
      total_calls: total_calls,
      completed_calls: completed_calls,
      pending_calls: total_calls - completed_calls,
      total_duration_seconds: total_duration,
      average_duration_seconds: average_duration
    }
    
    [200, summary.to_json]
  rescue StandardError => e
    [500, { error: e.message }.to_json]
  end
end

# Route to get call details with events
get "/analytics/calls/:call_control_id" do
  content_type :json
  call_control_id = params[:call_control_id]
  
  begin
    call = db.execute(
      "SELECT * FROM calls WHERE call_control_id = ?",
      [call_control_id]
    ).first
    
    return [404, { error: "Call not found" }.to_json] unless call
    
    events = db.execute(
      "SELECT event_type, event_data, created_at FROM call_events WHERE call_control_id = ? ORDER BY created_at ASC",
      [call_control_id]
    )
    
    duration = calculate_duration(call_control_id)
    
    call_details = {
      call_control_id: call["call_control_id"],
      from: call["from_number"],
      to: call["to_number"],
      status: call["status"],
      duration_seconds: duration,
      started_at: call["started_at"],
      ended_at: call["ended_at"],
      created_at: call["created_at"],
      events: events.map do |event|
        {
          event_type: event["event_type"],
          event_data: JSON.parse(event["event_data"]),
          created_at: event["created_at"]
        }
      end
    }
    
    [200, call_details.to_json]
  rescue StandardError => e
    [500, { error: e.message }.to_json]
  end
end

# Health check endpoint
get "/health" do
  content_type :json
  [200, { status: "ok" }.to_json]
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voice-call-analytics-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Sinatra server. |
| Connection ID Not Set | The application raises an error stating `TELNYX_CONNECTION_ID not set` when initiating a call. | Confirm your `.env` file contains the `TELNYX_CONNECTION_ID` variable with your Call Control Application ID from the Telnyx Portal. Verify the file is named exactly `.env` and is in the same directory as `app.rb`. Restart the server after updating the file. |
| Webhooks Not Received | Call events are not being recorded in the database; the webhook endpoint is not being called. | Ensure your webhook URL in the `.env` file is publicly accessible and matches the URL configured in your Telnyx Call Control Application settings. If testing locally, use ngrok to expose your server and update the webhook URL in the Telnyx Portal. Verify that your firewall allows inbound HTTPS traffic on port 443. |
| Database Locked Error | SQLite returns "database is locked" when multiple requests try to write simultaneously. | SQLite has limited concurrent write support. For production use, migrate to PostgreSQL or MySQL. For development, reduce concurrent requests or add a mutex around database writes using Ruby's `Mutex` class. |
| Phone Number Format Error | The endpoint returns `"Phone number must be in E.164 format"` error. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |

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
- [Record and Store Call Recordings](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/ruby/call-recording).
- [Transfer Calls Between Numbers](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/ruby/call-transfer).
