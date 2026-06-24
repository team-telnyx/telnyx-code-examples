#!/usr/bin/env ruby
"""Production-ready Sinatra webhook endpoint for receiving MMS via Telnyx."""

require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize Telnyx client with API key from environment
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# Configure Sinatra
set :port, 3000
set :bind, "0.0.0.0"

# Helper function to extract media URLs from MMS payload
def extract_media_from_payload(payload)
  """Extract media URLs and metadata from inbound MMS webhook payload."""
  media = []
  
  if payload["data"] && payload["data"]["media"]
    payload["data"]["media"].each do |media_item|
      media << {
        url: media_item["url"],
        mime_type: media_item["mime_type"],
        size: media_item["size"]
      }
    end
  end
  
  media
end

# Helper function to parse inbound MMS message
def parse_inbound_mms(payload)
  """Parse webhook payload and return structured message data."""
  data = payload["data"]
  
  {
    message_id: data["id"],
    from: data["from"]["phone_number"],
    to: data["to"][0]["phone_number"],
    text: data["text"],
    media: extract_media_from_payload(payload),
    received_at: data["received_at"],
    direction: data["direction"]
  }
end

# Webhook endpoint to receive inbound MMS
post "/webhooks/message" do
  content_type :json
  
  # Parse incoming JSON payload
  payload = JSON.parse(request.body.read)
  
  # Validate webhook event type
  unless payload["type"] == "message.received"
    return { error: "Unsupported event type" }.to_json
  end
  
  begin
    # Parse the inbound MMS message
    message_data = parse_inbound_mms(payload)
    
    # Log the received message (in production, persist to database)
    puts "Received MMS from #{message_data[:from]}"
    puts "Message ID: #{message_data[:message_id]}"
    puts "Media count: #{message_data[:media].length}"
    
    # Return success response to acknowledge webhook receipt
    status 200
    { 
      success: true, 
      message_id: message_data[:message_id],
      media_count: message_data[:media].length
    }.to_json
    
  rescue Telnyx::AuthenticationError
    status 401
    { error: "Invalid API key" }.to_json
  rescue Telnyx::APIStatusError => e
    status e.status_code || 400
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
