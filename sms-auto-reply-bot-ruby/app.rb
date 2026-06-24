#!/usr/bin/env ruby
"""Production-ready Sinatra SMS autoresponder using Telnyx."""

require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize client with the new SDK pattern
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

def send_sms(client, to_number, message)
  """Send SMS via Telnyx and return response data."""
  from_number = ENV["TELNYX_PHONE_NUMBER"]
  raise "TELNYX_PHONE_NUMBER environment variable not set" unless from_number

  # Validate E.164 format to prevent API errors
  raise "Phone number must be in E.164 format (e.g., +15551234567)" unless to_number.start_with?("+")

  # Use client.messages.create()
  response = client.messages.create(
    from_: from_number,
    to: to_number,
    text: message
  )

  # Extract serializable data — SDK objects are NOT JSON-serializable
  {
    message_id: response.data.id,
    status: response.data.to&.first&.status || "unknown",
    from: from_number,
    to: to_number
  }
end

def parse_webhook_event(request_body)
  """Parse and validate incoming webhook event."""
  begin
    JSON.parse(request_body)
  rescue JSON::ParserError
    raise "Invalid JSON in webhook payload"
  end
end

def generate_autoresponse(inbound_text)
  """Generate contextual autoresponse based on inbound message."""
  case inbound_text.downcase
  when /hello|hi|hey/
    "Hello! Thanks for reaching out. We'll respond shortly."
  when /help|support|issue/
    "We're here to help! Please describe your issue and we'll assist you."
  when /hours|open|closed/
    "Our business hours are Monday-Friday, 9 AM - 5 PM EST."
  when /price|cost|quote/
    "For pricing information, please visit our website or reply with your inquiry."
  else
    "Thanks for your message! We've received it and will get back to you soon."
  end
end

# Webhook endpoint to receive inbound SMS
post "/webhooks/sms/inbound" do
  content_type :json

  begin
    event = parse_webhook_event(request.body.read)

    # Verify this is a message.received event
    unless event["data"]&.dig("type") == "message.received"
      return { status: "ignored" }.to_json
    end

    message_data = event["data"]
    from_number = message_data["from"]&.dig("phone_number")
    to_number = message_data["to"]&.first&.dig("phone_number")
    inbound_text = message_data["text"]

    unless from_number && to_number && inbound_text
      return { error: "Missing required message fields" }.to_json, 400
    end

    # Generate autoresponse based on inbound message
    autoresponse = generate_autoresponse(inbound_text)

    # Send autoresponse
    result = send_sms(client, from_number, autoresponse)

    { status: "success", message_id: result[:message_id] }.to_json

  rescue Telnyx::AuthenticationError
    status 401
    { error: "Invalid API key" }.to_json
  rescue Telnyx::RateLimitError
    status 429
    { error: "Rate limit exceeded. Please slow down." }.to_json
  rescue Telnyx::APIStatusError => e
    status e.status_code
    { error: e.message, status_code: e.status_code }.to_json
  rescue Telnyx::APIConnectionError
    status 503
    { error: "Network error connecting to Telnyx" }.to_json
  rescue StandardError => e
    status 400
    { error: e.message }.to_json
  end
end

# Health check endpoint
get "/health" do
  content_type :json
  { status: "ok" }.to_json
end
