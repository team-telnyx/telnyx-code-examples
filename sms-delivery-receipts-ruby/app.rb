#!/usr/bin/env ruby
"""Production-ready Sinatra application for SMS delivery receipts via Telnyx."""

require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize Telnyx client with the new SDK pattern
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# In-memory store for message tracking (use a database in production)
$message_store = {}

# Helper function to send SMS and track delivery
def send_sms_with_tracking(to_number, message_text)
  from_number = ENV["TELNYX_PHONE_NUMBER"]
  raise "TELNYX_PHONE_NUMBER environment variable not set" unless from_number

  # Validate E.164 format to prevent API errors
  raise "Phone number must be in E.164 format (e.g., +15551234567)" unless to_number.start_with?("+")

  # Create message via Telnyx API
  response = client.messages.create(
    from_: from_number,
    to: to_number,
    text: message_text
  )

  # Extract serializable data — SDK objects are NOT JSON-serializable
  message_data = {
    message_id: response.data.id,
    to: to_number,
    from: from_number,
    text: message_text,
    status: response.data.to&.first&.status || "pending",
    created_at: Time.now.iso8601,
    delivery_status: "queued"
  }

  # Store message for webhook tracking
  $message_store[response.data.id] = message_data

  message_data
end

# Sinatra route to send SMS
post "/sms/send" do
  content_type :json

  # Parse request body
  begin
    data = JSON.parse(request.body.read)
  rescue JSON::ParserError
    return [400, { error: "Invalid JSON in request body" }.to_json]
  end

  to_number = data["to"]
  message_text = data["message"]

  # Validate required fields
  unless to_number && message_text
    return [400, { error: "Missing required fields: 'to' and 'message'" }.to_json]
  end

  begin
    result = send_sms_with_tracking(to_number, message_text)
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

# Webhook endpoint to receive delivery receipts
post "/webhooks/message" do
  content_type :json

  # Parse webhook payload
  begin
    payload = JSON.parse(request.body.read)
  rescue JSON::ParserError
    return [400, { error: "Invalid JSON in webhook payload" }.to_json]
  end

  # Extract event data
  event_type = payload["data"]&.dig("event_type")
  message_id = payload["data"]&.dig("id")
  status = payload["data"]&.dig("to")&.first&.dig("status")

  # Handle message.finalized events (final delivery status)
  if event_type == "message.finalized" && message_id
    if $message_store[message_id]
      $message_store[message_id][:delivery_status] = status || "unknown"
      $message_store[message_id][:finalized_at] = Time.now.iso8601

      # Log delivery receipt for debugging
      puts "Delivery receipt: Message #{message_id} → #{status}"
    end
  end

  # Return 200 OK to acknowledge webhook receipt
  [200, { success: true }.to_json]
end

# Route to check message delivery status
get "/messages/:message_id" do
  content_type :json

  message_id = params["message_id"]
  message = $message_store[message_id]

  if message
    [200, message.to_json]
  else
    [404, { error: "Message not found" }.to_json]
  end
end

# Health check endpoint
get "/health" do
  content_type :json
  [200, { status: "ok" }.to_json]
end
