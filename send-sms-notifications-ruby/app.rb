#!/usr/bin/env ruby
"""Production-ready Sinatra application for SMS notifications via Telnyx."""

require "sinatra"
require "dotenv/load"
require "telnyx"
require "json"

# Initialize Telnyx client with API key from environment
$client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# Validate required environment variables on startup
%w[TELNYX_API_KEY TELNYX_PHONE_NUMBER].each do |var|
  raise "Missing environment variable: #{var}" unless ENV[var]
end

# In-memory store for tracking notification status (use a database in production)
$notification_log = {}

# Helper function to send SMS notification
def send_notification(to_number, message)
  from_number = ENV["TELNYX_PHONE_NUMBER"]
  
  # Validate E.164 format to prevent API errors
  unless to_number.start_with?("+")
    raise ArgumentError, "Phone number must be in E.164 format (e.g., +15551234567)"
  end
  
  # Create message via Telnyx API
  response = $client.messages.send_(
    from: from_number,
    to: to_number,
    text: message
  )
  
  # Extract serializable data — SDK objects are NOT JSON-serializable
  {
    message_id: response.id,
    status: response.to&.first&.status || "pending",
    from: from_number,
    to: to_number,
    created_at: Time.now.iso8601
  }
end

# POST endpoint to send a notification
post "/notifications/send" do
  content_type :json
  
  begin
    data = JSON.parse(request.body.read)
  rescue JSON::ParserError
    return [400, { error: "Invalid JSON in request body" }.to_json]
  end
  
  to_number = data["to"]
  message = data["message"]
  
  unless to_number && message
    return [400, { error: "Missing required fields: 'to' and 'message'" }.to_json]
  end
  
  begin
    result = send_notification(to_number, message)
    
    # Log notification for tracking
    $notification_log[result[:message_id]] = result
    
    [200, result.to_json]
    
  rescue Telnyx::AuthenticationError
    [401, { error: "Invalid API key" }.to_json]
  rescue Telnyx::RateLimitError
    [429, { error: "Rate limit exceeded. Please slow down." }.to_json]
  rescue Telnyx::APIStatusError => e
    [e.http_status || 400, { error: e.message, status_code: e.http_status }.to_json]
  rescue Telnyx::APIConnectionError
    [503, { error: "Network error connecting to Telnyx" }.to_json]
  rescue ArgumentError => e
    [400, { error: e.message }.to_json]
  end
end

# POST endpoint to receive webhook callbacks for delivery status
post "/webhooks/sms" do
  content_type :json
  
  begin
    data = JSON.parse(request.body.read)
  rescue JSON::ParserError
    return [400, { error: "Invalid JSON in webhook payload" }.to_json]
  end
  
  event_type = data["data"]&.dig("event_type")
  message_id = data["data"]&.dig("id")
  status = data["data"]&.dig("to")&.first&.dig("status")
  
  # Update notification log with delivery status
  if message_id && $notification_log[message_id]
    $notification_log[message_id][:webhook_status] = status
    $notification_log[message_id][:event_type] = event_type
    $notification_log[message_id][:updated_at] = Time.now.iso8601
  end
  
  # Return 200 to acknowledge webhook receipt
  [200, { success: true }.to_json]
end

# GET endpoint to retrieve notification status
get "/notifications/:message_id" do
  content_type :json
  
  message_id = params["message_id"]
  notification = $notification_log[message_id]
  
  unless notification
    return [404, { error: "Notification not found" }.to_json]
  end
  
  [200, notification.to_json]
end

# Health check endpoint
get "/health" do
  content_type :json
  [200, { status: "ok" }.to_json]
end
