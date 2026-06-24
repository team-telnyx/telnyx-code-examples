# Call Transfer with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready Sinatra application that initiates outbound calls and transfers them to another number using the Telnyx Voice API. This tutorial demonstrates the command-event model of Call Control, webhook handling for call lifecycle events, and secure credential management via environment variables.

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
cd telnyx-code-examples/transfer-live-phone-calls-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/transfer-live-phone-calls-ruby
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.rb` and initialize the Telnyx client using the new pattern. Define helper functions to handle call initiation and transfer with proper error handling:

```ruby
require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize client with the new SDK pattern
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# Store active calls in memory (use Redis in production)
$active_calls = {}

def initiate_call(to_number, client)
  """Initiate an outbound call and return JSON-serializable response data."""
  from_number = ENV["TELNYX_PHONE_NUMBER"]
  connection_id = ENV["TELNYX_CONNECTION_ID"]
  
  raise "TELNYX_PHONE_NUMBER environment variable not set" unless from_number
  raise "TELNYX_CONNECTION_ID environment variable not set" unless connection_id
  
  # Validate E.164 format to prevent API errors
  raise "Phone number must be in E.164 format (e.g., +15551234567)" unless to_number.start_with?("+")
  
  # Initiate the call using Call Control
  response = client.calls.dial(
    from_: from_number,
    to: to_number,
    connection_id: connection_id
  )
  
  # Extract serializable data — SDK objects are NOT JSON-serializable
  {
    call_control_id: response.data.call_control_id,
    from: from_number,
    to: to_number,
    state: response.data.state
  }
end

def transfer_call(call_control_id, transfer_to, client)
  """Transfer an active call to another number."""
  raise "Phone number must be in E.164 format" unless transfer_to.start_with?("+")
  
  # Transfer the call to the new destination
  response = client.calls.actions.transfer(
    call_control_id,
    to: transfer_to
  )
  
  # Extract serializable data
  {
    call_control_id: response.data.call_control_id,
    state: response.data.state
  }
end

# POST endpoint to initiate a call
post "/calls/initiate" do
  content_type :json
  data = JSON.parse(request.body.read)
  
  to_number = data["to"]
  
  return [400, { error: "Missing required field: 'to'" }.to_json] unless to_number
  
  begin
    result = initiate_call(to_number, client)
    
    # Store call in memory for later transfer
    $active_calls[result[:call_control_id]] = {
      to: to_number,
      initiated_at: Time.now
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
  rescue StandardError => e
    [400, { error: e.message }.to_json]
  end
end

# POST endpoint to transfer an active call
post "/calls/transfer" do
  content_type :json
  data = JSON.parse(request.body.read)
  
  call_control_id = data["call_control_id"]
  transfer_to = data["transfer_to"]
  
  return [400, { error: "Missing required fields: 'call_control_id' and 'transfer_to'" }.to_json] unless call_control_id && transfer_to
  
  begin
    result = transfer_call(call_control_id, transfer_to, client)
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

# POST webhook endpoint to receive call events
post "/webhooks/call-events" do
  content_type :json
  data = JSON.parse(request.body.read)
  
  event_type = data["data"]["event_type"]
  call_control_id = data["data"]["call_control_id"]
  
  case event_type
  when "call.initiated"
    puts "Call initiated: #{call_control_id}"
  when "call.answered"
    puts "Call answered: #{call_control_id}"
  when "call.hangup"
    puts "Call ended: #{call_control_id}"
    $active_calls.delete(call_control_id)
  when "call.transfer.answered"
    puts "Transfer answered: #{call_control_id}"
  else
    puts "Received event: #{event_type}"
  end
  
  [200, { status: "received" }.to_json]
end

# Health check endpoint
get "/health" do
  content_type :json
  { status: "ok" }.to_json
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/transfer-live-phone-calls-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Sinatra server. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Webhook Events Not Received | The `/webhooks/call-events` endpoint is not receiving call lifecycle events from Telnyx. | Verify that your ngrok URL is correctly configured in the Telnyx Portal under your Call Control Application settings. Ensure the webhook URL is set to `https://your-ngrok-url.ngrok.io/webhooks/call-events`. Check that your Sinatra server is running and accessible. Use ngrok's web interface (`http://localhost:4040`) to inspect incoming webhook requests. |

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

- [Handle Inbound Calls with Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/ruby/inbound-call-webhook).
- [Record Calls](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/ruby/call-recording).
- [Build an IVR Menu](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/ruby/ivr-menu).
