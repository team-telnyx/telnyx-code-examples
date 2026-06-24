#!/usr/bin/env ruby
"""Production-ready Sinatra application for two-way SMS via Telnyx."""

require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize Telnyx client with API key from environment
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# Helper function to send SMS
def send_sms(to_number, message, client)
  from_number = ENV["TELNYX_PHONE_NUMBER"]
  
  raise "TELNYX_PHONE_NUMBER environment variable not set" unless from_number
  
  # Validate E.164 format to prevent API errors
  raise "Phone number must be in E.164 format (e.g., +15551234567)" unless to_number.start_with?("+")
  
  # Create message via Telnyx API
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

# Helper function to process inbound webhook
def process_inbound_message(payload)
  # Extract message details from webhook payload
  {
    message_id: payload["data"]["id"],
    from: payload["data"]["from"]["phone_number"],
    to: payload["data"]["to"]&.first&.phone_number,
    text: payload["data"]["text"],
    received_at: payload["data"]["received_at"],
    direction: payload["data"]["direction"]
  }
end

# Route to send SMS
post "/sms/send" do
  content_type :json
  
  data = JSON.parse(request.body.read)
  
  to_number = data["to"]
  message = data["message"]
  
  return [400, { error: "Missing required fields: 'to' and 'message'" }.to_json].to_a unless to_number && message
  
  begin
    result = send_sms(to_number, message, client)
    [200, result.to_json].to_a
    
  rescue Telnyx::AuthenticationError
    [401, { error: "Invalid API key" }.to_json].to_a
  rescue Telnyx::RateLimitError
    [429, { error: "Rate limit exceeded. Please slow down." }.to_json].to_a
  rescue Telnyx::APIStatusError => e
    [e.status_code, { error: e.message, status_code: e.status_code }.to_json].to_a
  rescue Telnyx::APIConnectionError
    [503, { error: "Network error connecting to Telnyx" }.to_json].to_a
  rescue StandardError => e
    [400, { error: e.message }.to_json].to_a
  end
end

# Webhook route to receive inbound SMS
post "/sms/webhook" do
  content_type :json
  
  payload = JSON.parse(request.body.read)
  
  # Verify webhook event type
  event_type = payload["type"]
  
  unless event_type == "message.received"
    return [200, { status: "ignored" }.to_json].to_a
  end
  
  begin
    inbound = process_inbound_message(payload)
    
    # Log or store the inbound message
    puts "Received SMS from #{inbound[:from]}: #{inbound[:text]}"
    
    # Auto-reply to demonstrate two-way messaging
    reply_message = "Thanks for your message! We received: '#{inbound[:text]}'"
    send_sms(inbound[:from], reply_message, client)
    
    [200, { status: "processed", message_id: inbound[:message_id] }.to_json].to_a
    
  rescue Telnyx::AuthenticationError
    [401, { error: "Invalid API key" }.to_json].to_a
  rescue Telnyx::RateLimitError
    [429, { error: "Rate limit exceeded" }.to_json].to_a
  rescue Telnyx::APIStatusError => e
    [e.status_code, { error: e.message }.to_json].to_a
  rescue Telnyx::APIConnectionError
    [503, { error: "Network error connecting to Telnyx" }.to_json].to_a
  rescue StandardError => e
    [400, { error: e.message }.to_json].to_a
  end
end

# Health check route
get "/health" do
  content_type :json
  { status: "ok" }.to_json
end
