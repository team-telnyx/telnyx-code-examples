# Scheduled SMS with Ruby and Sinatra

## What Does This Example Do?

Build a production-ready Sinatra application that schedules SMS messages to be sent at specific times using the Telnyx Ruby SDK. This tutorial demonstrates scheduling patterns with background job processing, proper error handling for telecom APIs, and secure credential management via environment variables.

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
- A Telnyx phone number enabled for outbound SMS.
- Bundler (Ruby dependency manager).
- Sidekiq or similar background job processor (optional but recommended for production).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/schedule-sms-messages-ruby
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a `jobs/sms_job.rb` file to define the background job that sends SMS messages:

```ruby
require "sidekiq"
require "telnyx"

class SmsJob
  include Sidekiq::Job

  def perform(to_number, message_text)
    from_number = ENV["TELNYX_PHONE_NUMBER"]
    
    unless from_number
      raise StandardError, "TELNYX_PHONE_NUMBER environment variable not set"
    end

    # Validate E.164 format to prevent API errors
    unless to_number.start_with?("+")
      raise StandardError, "Phone number must be in E.164 format (e.g., +15551234567)"
    end

    # Send SMS via Telnyx API
    client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])
    response = client.messages.send_(
      from: from_number,
      to: to_number,
      text: message_text
    )

    # Log successful send
    puts "SMS sent: #{response.id} to #{to_number}"
    
    # Return serializable data
    {
      message_id: response.id,
      status: response.to&.first&.status || "unknown",
      from: from_number,
      to: to_number
    }
  rescue Telnyx::AuthenticationError => e
    puts "Authentication error: #{e.message}"
    raise
  rescue Telnyx::RateLimitError => e
    puts "Rate limit error: #{e.message}"
    # Sidekiq will retry automatically
    raise
  rescue Telnyx::APIStatusError => e
    puts "API error (#{e.status_code}): #{e.message}"
    raise
  rescue Telnyx::APIConnectionError => e
    puts "Connection error: #{e.message}"
    raise
  end
end
```

Create the main Sinatra application in `app.rb`:

```ruby
require "sinatra"
require "json"
require "time"
require_relative "config"
require_relative "jobs/sms_job"

set :port, 4567
set :bind, "0.0.0.0"

# Helper function to validate phone number format
def validate_phone_number(number)
  unless number&.start_with?("+")
    return { error: "Phone number must be in E.164 format (e.g., +15551234567)" }
  end
  nil
end

# Helper function to validate scheduled time
def validate_scheduled_time(scheduled_at)
  begin
    time = Time.parse(scheduled_at)
    if time <= Time.now
      return { error: "Scheduled time must be in the future" }
    end
    nil
  rescue ArgumentError
    { error: "Invalid time format. Use ISO 8601 format (e.g., 2026-06-24T14:30:00Z)" }
  end
end

# POST /sms/schedule - Schedule an SMS to be sent at a specific time
post "/sms/schedule" do
  content_type :json

  data = JSON.parse(request.body.read) rescue {}

  to_number = data["to"]
  message = data["message"]
  scheduled_at = data["scheduled_at"]

  # Validate required fields
  if !to_number || !message || !scheduled_at
    return [400, { error: "Missing required fields: 'to', 'message', 'scheduled_at'" }.to_json]
  end

  # Validate phone number format
  phone_error = validate_phone_number(to_number)
  return [400, phone_error.to_json] if phone_error

  # Validate scheduled time
  time_error = validate_scheduled_time(scheduled_at)
  return [400, time_error.to_json] if time_error

  begin
    scheduled_time = Time.parse(scheduled_at)
    delay_seconds = (scheduled_time - Time.now).to_i

    # Enqueue the job to be executed at the scheduled time
    job_id = SmsJob.perform_in(delay_seconds.seconds, to_number, message)

    [202, {
      job_id: job_id,
      to: to_number,
      message: message,
      scheduled_at: scheduled_at,
      status: "scheduled"
    }.to_json]

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

# GET /sms/schedule/:job_id - Check the status of a scheduled SMS
get "/sms/schedule/:job_id" do
  content_type :json

  job_id = params[:job_id]

  begin
    # Check if job exists in Sidekiq
    job_set = Sidekiq::ScheduledSet.new
    job = job_set.find { |j| j.jid == job_id }

    if job
      [200, {
        job_id: job_id,
        status: "scheduled",
        scheduled_at: Time.at(job.at).iso8601
      }.to_json]
    else
      [404, { error: "Job not found" }.to_json]
    end
  rescue StandardError => e
    [500, { error: e.message }.to_json]
  end
end

# Health check endpoint
get "/health" do
  content_type :json
  { status: "ok" }.to_json
end
```

## Complete Code

See [`app.rb`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/schedule-sms-messages-ruby/app.rb) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart both the Sinatra application and Sidekiq worker. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Scheduled Time in the Past | The endpoint returns `{"error": "Scheduled time must be in the future"}` with HTTP 400. | Ensure the `scheduled_at` timestamp is set to a future time. Use ISO 8601 format (e.g., `2026-06-24T14:30:00Z`). When testing with curl, use `date -u -d '+60 seconds'` to generate a timestamp 60 seconds in the future. |
| Redis Connection Error | Sidekiq fails to start with "Error connecting to Redis" or similar message. | Ensure Redis is running on your system. Start it with `redis-server` in a separate terminal. Verify the `REDIS_URL` environment variable in `.env` matches your Redis configuration (default: `redis://localhost:6379/0`). |
| Job Not Found | The status endpoint returns `{"error": "Job not found"}` with HTTP 404. | The job may have already been executed or removed from the queue. Check the Sidekiq web UI (if enabled) or Sidekiq logs to verify job execution. Jobs are removed from the scheduled set once they complete. |

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

- [Send a Single SMS with Ruby and Sinatra](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/ruby/send-single-sms).
- [Receive SMS Webhooks with Ruby and Sinatra](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/ruby/receive-sms-webhook).
- [Implement Two-Factor Authentication with SMS](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/ruby/otp-2fa).
