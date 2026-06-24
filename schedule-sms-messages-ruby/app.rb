#!/usr/bin/env ruby
"""Production-ready Sinatra application for scheduling SMS via Telnyx."""

require "sinatra"
require "json"
require "time"
require "dotenv/load"
require "telnyx"
require "sidekiq"

# Initialize Telnyx client
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# Configure Sidekiq
Sidekiq.configure_server do |config|
  config.redis = { url: ENV["REDIS_URL"] || "redis://localhost:6379/0" }
end

Sidekiq.configure_client do |config|
  config.redis = { url: ENV["REDIS_URL"] || "redis://localhost:6379/0" }
end

# Background job for sending SMS
class SmsJob
  include Sidekiq::Job

  def perform(to_number, message_text)
    from_number = ENV["TELNYX_PHONE_NUMBER"]
    
    unless from_number
      raise StandardError, "TELNYX_PHONE_NUMBER environment variable not set"
    end

    unless to_number.start_with?("+")
      raise StandardError, "Phone number must be in E.164 format (e.g., +15551234567)"
    end

    client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])
    response = client.messages.send_(
      from: from_number,
      to: to_number,
      text: message_text
    )

    puts "SMS sent: #{response.id} to #{to_number}"
    
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
    raise
  rescue Telnyx::APIStatusError => e
    puts "API error (#{e.status_code}): #{e.message}"
    raise
  rescue Telnyx::APIConnectionError => e
    puts "Connection error: #{e.message}"
    raise
  end
end

set :port, 4567
set :bind, "0.0.0.0"

def validate_phone_number(number)
  unless number&.start_with?("+")
    return { error: "Phone number must be in E.164 format (e.g., +15551234567)" }
  end
  nil
end

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

post "/sms/schedule" do
  content_type :json

  data = JSON.parse(request.body.read) rescue {}

  to_number = data["to"]
  message = data["message"]
  scheduled_at = data["scheduled_at"]

  if !to_number || !message || !scheduled_at
    return [400, { error: "Missing required fields: 'to', 'message', 'scheduled_at'" }.to_json]
  end

  phone_error = validate_phone_number(to_number)
  return [400, phone_error.to_json] if phone_error

  time_error = validate_scheduled_time(scheduled_at)
  return [400, time_error.to_json] if time_error

  begin
    scheduled_time = Time.parse(scheduled_at)
    delay_seconds = (scheduled_time - Time.now).to_i

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

get "/sms/schedule/:job_id" do
  content_type :json

  job_id = params[:job_id]

  begin
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

get "/health" do
  content_type :json
  { status: "ok" }.to_json
end
