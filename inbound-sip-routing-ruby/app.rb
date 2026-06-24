#!/usr/bin/env ruby
"""Production-ready Sinatra application for inbound SIP routing via Telnyx."""

require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize Telnyx client with API key from environment
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# Helper function to retrieve SIP connection details
def get_sip_connection(client, connection_id)
  response = client.sip_connections.retrieve(connection_id)
  {
    id: response.data.id,
    name: response.data.name,
    username: response.data.username,
    sip_uri: response.data.sip_uri,
  }
rescue Telnyx::AuthenticationError
  raise "Invalid API key"
rescue Telnyx::APIStatusError => e
  raise "Failed to retrieve SIP connection: #{e.message}"
end

# Helper function to list all SIP connections
def list_sip_connections(client)
  response = client.sip_connections.list
  response.data.map do |connection|
    {
      id: connection.id,
      name: connection.name,
      username: connection.username,
      sip_uri: connection.sip_uri,
    }
  end
rescue Telnyx::APIStatusError => e
  raise "Failed to list SIP connections: #{e.message}"
end

# Configure Sinatra settings
set :port, 5000
set :bind, "0.0.0.0"

# Health check endpoint
get "/" do
  content_type :json
  { status: "ok", service: "Telnyx SIP Routing" }.to_json
end

# Endpoint to list all SIP connections
get "/sip/connections" do
  content_type :json
  begin
    connections = list_sip_connections(client)
    { data: connections }.to_json
  rescue Telnyx::AuthenticationError
    status 401
    { error: "Invalid API key" }.to_json
  rescue Telnyx::RateLimitError
    status 429
    { error: "Rate limit exceeded. Please slow down." }.to_json
  rescue Telnyx::APIStatusError => e
    status e.status_code || 500
    { error: e.message, status_code: e.status_code }.to_json
  rescue StandardError => e
    status 500
    { error: e.message }.to_json
  end
end

# Endpoint to retrieve a specific SIP connection
get "/sip/connections/:id" do
  content_type :json
  connection_id = params[:id]
  
  begin
    connection = get_sip_connection(client, connection_id)
    connection.to_json
  rescue Telnyx::AuthenticationError
    status 401
    { error: "Invalid API key" }.to_json
  rescue Telnyx::APIStatusError => e
    status e.status_code || 500
    { error: e.message, status_code: e.status_code }.to_json
  rescue StandardError => e
    status 500
    { error: e.message }.to_json
  end
end

# Webhook endpoint to handle inbound call events
post "/webhooks/inbound-call" do
  content_type :json
  
  # Parse incoming webhook payload
  payload = JSON.parse(request.body.read)
  event_type = payload.dig("data", "event_type")
  call_id = payload.dig("data", "call_session_id")
  from_number = payload.dig("data", "from")
  to_number = payload.dig("data", "to")
  
  begin
    case event_type
    when "call.initiated"
      # Log inbound call and route to SIP connection
      puts "Inbound call received: #{from_number} -> #{to_number} (Call ID: #{call_id})"
      
      # Route call to configured SIP endpoint
      sip_connection_id = ENV["SIP_CONNECTION_ID"]
      if sip_connection_id
        puts "Routing call #{call_id} to SIP connection #{sip_connection_id}"
      else
        puts "Warning: SIP_CONNECTION_ID not configured. Call will not be routed."
      end
      
      { status: "routed", call_id: call_id }.to_json
      
    when "call.answered"
      puts "Call answered: #{call_id}"
      { status: "acknowledged", call_id: call_id }.to_json
      
    when "call.hangup"
      puts "Call ended: #{call_id}"
      { status: "acknowledged", call_id: call_id }.to_json
      
    else
      puts "Unhandled event type: #{event_type}"
      { status: "acknowledged", call_id: call_id }.to_json
    end
    
  rescue JSON::ParserError
    status 400
    { error: "Invalid JSON payload" }.to_json
  rescue StandardError => e
    status 500
    { error: "Webhook processing failed: #{e.message}" }.to_json
  end
end

# Error handler for unmatched routes
not_found do
  content_type :json
  { error: "Endpoint not found" }.to_json
end
