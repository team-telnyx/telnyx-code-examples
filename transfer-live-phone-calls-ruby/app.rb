#!/usr/bin/env ruby
"""Production-ready Sinatra application for call transfer via Telnyx."""

require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize client with the new SDK pattern
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# Store active calls in memory (use Redis in production)
$active_calls = {}

def initiate_call(to_number, client)
  """Initiate an outbound call and return JSON-serializable response data."""
  from_number = ENV["TELNYX_PHONE_NUMBER"]
  connection_id = ENV["TELNYX_CONNECTION_ID"]
  
  raise "TELNYX_PHONE_NUMBER environment variable not set" unless from_number
  raise "TELNYX_CONNECTION_ID environment variable not set" unless connection_id
  
  # Validate E.164 format to prevent API errors
  raise "Phone number must be in E.164 format (e.g., +15551234567)" unless to_number.start_with?("+")
  
  # Initiate the call using Call Control
  response = client.calls.dial(
    from_: from_number,
    to: to_number,
    connection_id: connection_id
  )
  
  # Extract serializable data — SDK objects are NOT JSON-serializable
  {
    call_control_id: response.data.call_control_id,
    from: from_number,
    to: to_number,
    state: response.data.state
  }
end

def transfer_call(call_control_id, transfer_to, client)
  """Transfer an active call to another number."""
  raise "Phone number must be in E.164 format" unless transfer_to.start_with?("+")
  
  # Transfer the call to the new destination
  response = client.calls.actions.transfer(
    call_control_id,
    to: transfer_to
  )
  
  # Extract serializable data
  {
    call_control_id: response.data.call_control_id,
    state: response.data.state
  }
end

# POST endpoint to initiate a call
post "/calls/initiate" do
  content_type :json
  data = JSON.parse(request.body.read)
  
  to_number = data["to"]
  
  return [400, { error: "Missing required field: 'to'" }.to_json] unless to_number
  
  begin
    result = initiate_call(to_number, client)
    
    # Store call in memory for later transfer
    $active_calls[result[:call_control_id]] = {
      to: to_number,
      initiated_at: Time.now
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

# POST endpoint to transfer an active call
post "/calls/transfer" do
  content_type :json
  data = JSON.parse(request.body.read)
  
  call_control_id = data["call_control_id"]
  transfer_to = data["transfer_to"]
  
  return [400, { error: "Missing required fields: 'call_control_id' and 'transfer_to'" }.to_json] unless call_control_id && transfer_to
  
  begin
    result = transfer_call(call_control_id, transfer_to, client)
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

# POST webhook endpoint to receive call events
post "/webhooks/call-events" do
  content_type :json
  data = JSON.parse(request.body.read)
  
  event_type = data["data"]["event_type"]
  call_control_id = data["data"]["call_control_id"]
  
  case event_type
  when "call.initiated"
    puts "Call initiated: #{call_control_id}"
  when "call.answered"
    puts "Call answered: #{call_control_id}"
  when "call.hangup"
    puts "Call ended: #{call_control_id}"
    $active_calls.delete(call_control_id)
  when "call.transfer.answered"
    puts "Transfer answered: #{call_control_id}"
  else
    puts "Received event: #{event_type}"
  end
  
  [200, { status: "received" }.to_json]
end

# Health check endpoint
get "/health" do
  content_type :json
  { status: "ok" }.to_json
end
