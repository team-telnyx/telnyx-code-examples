#!/usr/bin/env ruby
"""Production-ready Sinatra application for sending bulk SMS via Telnyx."""

require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize Telnyx client with API key from environment
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# Helper function to send a single SMS with error handling
def send_sms(client, from_number, to_number, message)
  # Validate E.164 format to prevent API errors
  unless to_number.start_with?("+")
    raise ArgumentError, "Phone number must be in E.164 format (e.g., +15551234567)"
  end

  # Create message via Telnyx API
  response = client.messages.create(
    from_: from_number,
    to: to_number,
    text: message
  )

  # Extract serializable data — SDK objects are NOT JSON-serializable
  {
    message_id: response.data.id,
    to: to_number,
    status: response.data.to&.first&.status || "pending"
  }
end

# Helper function to send bulk SMS with rate limiting
def send_bulk_sms(client, from_number, recipients, message)
  rate_limit_delay = (ENV["RATE_LIMIT_DELAY"] || "0.1").to_f
  results = []
  errors = []

  recipients.each_with_index do |to_number, index|
    begin
      result = send_sms(client, from_number, to_number, message)
      results << result
      
      # Apply rate limiting between requests (except after the last one)
      sleep(rate_limit_delay) if index < recipients.length - 1
    rescue ArgumentError => e
      errors << { to: to_number, error: e.message }
    end
  end

  {
    sent: results,
    failed: errors,
    total_sent: results.length,
    total_failed: errors.length
  }
end

# POST endpoint to send bulk SMS
post "/sms/bulk" do
  content_type :json

  # Parse request body
  begin
    data = JSON.parse(request.body.read)
  rescue JSON::ParserError
    return [400, { error: "Invalid JSON in request body" }.to_json]
  end

  # Validate required fields
  recipients = data["recipients"]
  message = data["message"]

  unless recipients.is_a?(Array) && recipients.any?
    return [400, { error: "Field 'recipients' must be a non-empty array" }.to_json]
  end

  unless message.is_a?(String) && !message.empty?
    return [400, { error: "Field 'message' must be a non-empty string" }.to_json]
  end

  from_number = ENV["TELNYX_PHONE_NUMBER"]
  unless from_number
    return [500, { error: "TELNYX_PHONE_NUMBER environment variable not set" }.to_json]
  end

  # Send bulk SMS with error handling
  begin
    result = send_bulk_sms(client, from_number, recipients, message)
    [200, result.to_json]
  rescue Telnyx::AuthenticationError
    [401, { error: "Invalid API key" }.to_json]
  rescue Telnyx::RateLimitError
    [429, { error: "Rate limit exceeded. Please slow down." }.to_json]
  rescue Telnyx::APIStatusError => e
    [e.status_code || 500, { error: e.message, status_code: e.status_code }.to_json]
  rescue Telnyx::APIConnectionError
    [503, { error: "Network error connecting to Telnyx" }.to_json]
  rescue StandardError => e
    [500, { error: "Unexpected error: #{e.message}" }.to_json]
  end
end

# GET endpoint to check application health
get "/health" do
  content_type :json
  { status: "ok" }.to_json
end
