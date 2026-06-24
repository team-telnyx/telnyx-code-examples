#!/usr/bin/env ruby
"""Production-ready Sinatra application for call recording via Telnyx."""

require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize Telnyx client with API key from environment
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# In-memory store for active calls (use Redis in production)
$active_calls = {}

# Helper function to initiate an outbound call
def initiate_call(to_number, client)
  from_number = ENV["TELNYX_PHONE_NUMBER"]
  connection_id = ENV["TELNYX_CONNECTION_ID"]
  
  unless from_number && connection_id
    raise "TELNYX_PHONE_NUMBER and TELNYX_CONNECTION_ID must be set"
  end
  
  # Validate E.164 format to prevent API errors
  unless to_number.start_with?("+")
    raise "Phone number must be in E.164 format (e.g., +15551234567)"
  end
  
  # Initiate the call using client.calls.dial()
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

# Helper function to start recording on an active call
def start_recording(call_control_id, client)
  response = client.calls.actions.start_recording(
    call_control_id,
    format: "wav"
  )
  
  {
    call_control_id: response.data.call_control_id,
    recording_state: response.data.recording_state
  }
end

# Helper function to stop recording on an active call
def stop_recording(call_control_id, client)
  response = client.calls.actions.stop_recording(call_control_id)
  
  {
    call_control_id: response.data.call_control_id,
    recording_state: response.data.recording_state
  }
end

# Helper function to hang up a call
def hangup_call(call_control_id, client)
  response = client.calls.actions.hangup(call_control_id)
  
  {
    call_control_id: response.data.call_control_id,
    state: response.data.state
  }
end

# Route to initiate a call and start recording
post "/calls/initiate" do
  content_type :json
  
  data = JSON.parse(request.body.read) rescue {}
  
  to_number = data["to"]
  
  unless to_number
    return [400, { error: "Missing required field: 'to'" }.to_json]
  end
  
  begin
    result = initiate_call(to_number, client)
    
    # Store call metadata for webhook handling
    $active_calls[result[:call_control_id]] = {
      to: to_number,
      initiated_at: Time.now,
      recording: false
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

# Route to start recording on an active call
post "/calls/:call_control_id/recording/start" do
  content_type :json
  
  call_control_id = params[:call_control_id]
  
  unless $active_calls[call_control_id]
    return [404, { error: "Call not found" }.to_json]
  end
  
  begin
    result = start_recording(call_control_id, client)
    $active_calls[call_control_id][:recording] = true
    
    [200, result.to_json]
    
  rescue Telnyx::AuthenticationError
    [401, { error: "Invalid API key" }.to_json]
  rescue Telnyx::APIStatusError => e
    [e.status_code, { error: e.message, status_code: e.status_code }.to_json]
  rescue Telnyx::APIConnectionError
    [503, { error: "Network error connecting to Telnyx" }.to_json]
  rescue StandardError => e
    [400, { error: e.message }.to_json]
  end
end

# Route to stop recording on an active call
post "/calls/:call_control_id/recording/stop" do
  content_type :json
  
  call_control_id = params[:call_control_id]
  
  unless $active_calls[call_control_id]
    return [404, { error: "Call not found" }.to_json]
  end
  
  begin
    result = stop_recording(call_control_id, client)
    $active_calls[call_control_id][:recording] = false
    
    [200, result.to_json]
    
  rescue Telnyx::AuthenticationError
    [401, { error: "Invalid API key" }.to_json]
  rescue Telnyx::APIStatusError => e
    [e.status_code, { error: e.message, status_code: e.status_code }.to_json]
  rescue Telnyx::APIConnectionError
    [503, { error: "Network error connecting to Telnyx" }.to_json]
  rescue StandardError => e
    [400, { error: e.message }.to_json]
  end
end

# Route to hang up a call
post "/calls/:call_control_id/hangup" do
  content_type :json
  
  call_control_id = params[:call_control_id]
  
  unless $active_calls[call_control_id]
    return [404, { error: "Call not found" }.to_json]
  end
  
  begin
    result = hangup_call(call_control_id, client)
    $active_calls.delete(call_control_id)
    
    [200, result.to_json]
    
  rescue Telnyx::AuthenticationError
    [401, { error: "Invalid API key" }.to_json]
  rescue Telnyx::APIStatusError => e
    [e.status_code, { error: e.message, status_code: e.status_code }.to_json]
  rescue Telnyx::APIConnectionError
    [503, { error: "Network error connecting to Telnyx" }.to_json]
  rescue StandardError => e
    [400, { error: e.message }.to_json]
  end
end

# Webhook endpoint to receive call lifecycle events
post "/webhooks/call" do
  content_type :json
  
  payload = JSON.parse(request.body.read) rescue {}
  event_type = payload["data"]["event_type"]
  call_control_id = payload["data"]["call_control_id"]
  
  case event_type
  when "call.initiated"
    puts "Call initiated: #{call_control_id}"
    
  when "call.answered"
    puts "Call answered: #{call_control_id}"
    # Automatically start recording when call is answered
    if $active_calls[call_control_id]
      begin
        start_recording(call_control_id, client)
        $active_calls[call_control_id][:recording] = true
      rescue => e
        puts "Failed to start recording: #{e.message}"
      end
    end
    
  when "call.hangup"
    puts "Call ended: #{call_control_id}"
    $active_calls.delete(call_control_id)
    
  when "call.recording.saved"
    puts "Recording saved: #{call_control_id}"
    if $active_calls[call_control_id]
      $active_calls[call_control_id][:recording_url] = payload["data"]["recording_urls"]&.first
    end
  end
  
  [200, { status: "ok" }.to_json]
end

# Health check endpoint
get "/health" do
  content_type :json
  [200, { status: "healthy" }.to_json]
end
