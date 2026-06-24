#!/usr/bin/env ruby
"""Production-ready Sinatra endpoint for text-to-speech calls via Telnyx."""

require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize client with the Ruby SDK pattern
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# Store active calls in memory (use Redis in production)
$active_calls = {}

def initiate_call(to_number, message)
  """Initiate an outbound call and return call control ID."""
  from_number = ENV["TELNYX_PHONE_NUMBER"]
  connection_id = ENV["TELNYX_CONNECTION_ID"]
  
  unless from_number
    raise "TELNYX_PHONE_NUMBER environment variable not set"
  end
  
  unless connection_id
    raise "TELNYX_CONNECTION_ID environment variable not set"
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
  
  # Extract call_control_id from response — returned by the API
  call_control_id = response.data.call_control_id
  
  # Store call metadata for webhook handling
  $active_calls[call_control_id] = {
    to: to_number,
    from: from_number,
    message: message,
    initiated_at: Time.now
  }
  
  # Return JSON-serializable data
  {
    call_control_id: call_control_id,
    to: to_number,
    from: from_number,
    status: "initiated"
  }
end

def play_tts(call_control_id, message)
  """Play text-to-speech message on an active call."""
  client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])
  
  # Use client.calls.actions.speak() to play TTS
  response = client.calls.actions.speak(
    call_control_id: call_control_id,
    payload: message,
    language: "en-US",
    voice: "female"
  )
  
  # Return JSON-serializable response
  {
    call_control_id: call_control_id,
    message: message,
    status: "speaking"
  }
end

# POST /calls/initiate — Initiate an outbound call with TTS
post "/calls/initiate" do
  content_type :json
  
  data = JSON.parse(request.body.read) rescue {}
  
  to_number = data["to"]
  message = data["message"]
  
  unless to_number && message
    return [400, { error: "Missing required fields: 'to' and 'message'" }.to_json]
  end
  
  begin
    result = initiate_call(to_number, message)
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

# POST /webhooks/call — Handle call control webhooks
post "/webhooks/call" do
  content_type :json
  
  data = JSON.parse(request.body.read) rescue {}
  event_type = data["data"]["event_type"]
  call_control_id = data["data"]["call_control_id"]
  
  case event_type
  when "call.answered"
    # Call was answered — play TTS message
    if $active_calls[call_control_id]
      message = $active_calls[call_control_id][:message]
      begin
        play_tts(call_control_id, message)
      rescue Telnyx::APIStatusError => e
        puts "Error playing TTS: #{e.message}"
      end
    end
    
  when "call.hangup"
    # Call ended — clean up
    $active_calls.delete(call_control_id)
    
  when "call.speak.ended"
    # TTS playback finished — hangup the call
    begin
      client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])
      client.calls.actions.hangup(call_control_id: call_control_id)
    rescue Telnyx::APIStatusError => e
      puts "Error hanging up call: #{e.message}"
    end
  end
  
  [200, { status: "ok" }.to_json]
end

# GET /health — Health check endpoint
get "/health" do
  content_type :json
  [200, { status: "healthy" }.to_json]
end
