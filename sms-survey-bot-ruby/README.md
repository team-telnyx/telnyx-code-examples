# SMS Survey with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready SMS survey system using Ruby and Sinatra that collects customer feedback via text messages. This tutorial demonstrates how to send survey questions, receive responses via webhooks, track survey state, and handle multi-step conversations using the Telnyx SMS API. You'll learn proper error handling, webhook validation, and how to persist survey data across multiple message exchanges.

## Who Is This For?

- **Ruby developers** building sms features with Sinatra.
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
- A Telnyx phone number enabled for inbound and outbound SMS.
- Bundler (Ruby dependency manager).
- A publicly accessible URL for webhook callbacks (ngrok recommended for local development).
- Basic familiarity with REST APIs and JSON.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-survey-bot-ruby
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

# In-memory survey state storage (use a database in production)
survey_state = {}

# Survey questions in order
SURVEY_QUESTIONS = [
  "How satisfied are you with our service? (1-5)",
  "Would you recommend us to a friend? (yes/no)",
  "What could we improve?"
].freeze

# Helper function to send survey question
def send_survey_question(client, to_number, question_index)
  from_number = ENV["TELNYX_PHONE_NUMBER"]
  
  if !from_number
    raise "TELNYX_PHONE_NUMBER environment variable not set"
  end
  
  if !to_number.start_with?("+")
    raise "Phone number must be in E.164 format (e.g., +15551234567)"
  end
  
  question = SURVEY_QUESTIONS[question_index]
  message_text = "Survey Q#{question_index + 1}/#{SURVEY_QUESTIONS.length}: #{question}"
  
  response = client.messages.send_(
    from_: from_number,
    to: to_number,
    text: message_text
  )
  
  # Return serializable response data
  {
    message_id: response.data.id,
    status: response.data.to&.first&.status || "pending",
    from: from_number,
    to: to_number,
    question_index: question_index
  }
end

# Helper function to process survey response
def process_survey_response(survey_state, from_number, response_text, question_index)
  if !survey_state[from_number]
    survey_state[from_number] = {
      responses: [],
      current_question: 0,
      started_at: Time.now
    }
  end
  
  # Store the response
  survey_state[from_number][:responses] << {
    question_index: question_index,
    answer: response_text,
    received_at: Time.now
  }
  
  # Move to next question
  survey_state[from_number][:current_question] = question_index + 1
  
  survey_state[from_number]
end

# Route to initiate survey
post "/survey/start" do
  content_type :json
  
  data = JSON.parse(request.body.read) rescue {}
  to_number = data["to"]
  
  if !to_number
    return [400, { error: "Missing required field: 'to'" }.to_json]
  end
  
  begin
    result = send_survey_question(client, to_number, 0)
    survey_state[to_number] = {
      responses: [],
      current_question: 0,
      started_at: Time.now
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

# Webhook endpoint to receive inbound SMS
post "/webhooks/sms" do
  content_type :json
  
  begin
    payload = JSON.parse(request.body.read)
    
    # Validate webhook event type
    if payload["data"]["event_type"] != "message.received"
      return [200, { status: "ignored" }.to_json]
    end
    
    message_data = payload["data"]["payload"]
    from_number = message_data["from"]["phone_number"]
    response_text = message_data["text"]
    
    # Check if this number is in an active survey
    if !survey_state[from_number]
      return [200, { status: "no_active_survey" }.to_json]
    end
    
    current_state = survey_state[from_number]
    current_question_index = current_state[:current_question]
    
    # Process the response
    updated_state = process_survey_response(
      survey_state,
      from_number,
      response_text,
      current_question_index
    )
    
    # Check if survey is complete
    if updated_state[:current_question] >= SURVEY_QUESTIONS.length
      # Survey complete — send thank you message
      send_survey_question(client, from_number, -1) rescue nil
      
      return [200, {
        status: "survey_complete",
        responses: updated_state[:responses]
      }.to_json]
    end
    
    # Send next question
    next_question_index = updated_state[:current_question]
    send_survey_question(client, from_number, next_question_index)
    
    [200, {
      status: "response_received",
      next_question_index: next_question_index
    }.to_json]
    
  rescue Telnyx::AuthenticationError
    [401, { error: "Invalid API key" }.to_json]
  rescue Telnyx::APIStatusError => e
    [e.status_code, { error: e.message }.to_json]
  rescue Telnyx::APIConnectionError
    [503, { error: "Network error connecting to Telnyx" }.to_json]
  rescue StandardError => e
    [400, { error: e.message }.to_json]
  end
end

# Route to retrieve survey results
get "/survey/results/:phone_number" do
  content_type :json
  
  phone_number = params[:phone_number]
  
  if !survey_state[phone_number]
    return [404, { error: "No survey found for this phone number" }.to_json]
  end
  
  state = survey_state[phone_number]
  
  [200, {
    phone_number: phone_number,
    responses: state[:responses],
    started_at: state[:started_at],
    completed: state[:current_question] >= SURVEY_QUESTIONS.length
  }.to_json]
end

# Health check endpoint
get "/health" do
  content_type :json
  [200, { status: "ok" }.to_json]
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-survey-bot-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Sinatra server. |
| Webhook Not Receiving Messages | The `/webhooks/sms` endpoint is not being called when inbound SMS arrives. | Confirm your Messaging Profile in the Telnyx Portal has the webhook URL set correctly. Use ngrok to expose your local server and update the webhook URL to your ngrok domain. Verify the URL is publicly accessible by testing with curl from another terminal. Check Sinatra logs for incoming requests. |
| Phone Number Format Error | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl commands to use properly formatted numbers. |
| Survey State Not Persisting | Survey responses are lost when the server restarts or responses are not being tracked. | The current implementation uses in-memory storage which is lost on restart. For production, replace the `survey_state` hash with a database (PostgreSQL, Redis, or MongoDB). Store survey metadata including phone number, question index, and responses in a persistent data store. |
| Webhook Payload Parsing Error | The webhook endpoint returns a 400 error when receiving messages. | Verify the webhook payload structure matches Telnyx's format. Check that `payload["data"]["event_type"]` equals `"message.received"` and that `payload["data"]["payload"]["from"]["phone_number"]` exists. Log the raw payload to debug: `puts request.body.read` before parsing. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What Ruby version do I need?**

Ruby 3.1 or higher. Ruby 3.3 is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Ruby SDK](https://developers.telnyx.com/development/sdk/ruby)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)

## Related Examples

- [Receive SMS Webhooks with Ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/ruby/receive-sms-webhook).
- [Send Bulk SMS Messages](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/ruby/send-bulk-sms).
- [Implement Two-Factor Authentication with SMS](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/ruby/otp-2fa).
