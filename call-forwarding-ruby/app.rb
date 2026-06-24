#!/usr/bin/env ruby
"""Production-ready Sinatra application for call forwarding via Telnyx."""

require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize Telnyx client with the new SDK pattern
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# In-memory store for call state (use Redis in production)
$call_state = {}

def forward_call(call_control_id, to_number, client)
  """Transfer an incoming call to a forwarding number."""
  from_number = ENV["TELNYX_PHONE_NUMBER"]
  
  if !from_number
    raise StandardError, "TELNYX_PHONE_NUMBER environment variable not set"
  end
  
  if !to_number.start_with?("+")
    raise StandardError, "Phone number must be in E.164 format (e.g., +15551234567)"
  end
  
  # Transfer the call to the forwarding number
  response = client.calls.actions.transfer(
    call_control_id,
    to: to_number
  )
  
  # Extract serializable data — SDK objects are NOT JSON-serializable
  {
    call_control_id: response.data.call_control_id,
    status: "transferred"
  }
end

def answer_call(call_control_id, client)
  """Answer an incoming call."""
  response = client.calls.actions.answer(call_control_id)
  
  {
    call_control_id: response.data.call_control_id,
    status: "answered"
  }
end

def hangup_call(call_control_id, client)
  """Hang up a call."""
  response = client.calls.actions.hangup(call_control_id)
  
  {
    call_control_id: response.data.call_control_id,
    status: "hung_up"
  }
end

# Webhook endpoint to receive call events
post "/webhooks/call" do
  request.body.rewind
  payload = JSON.parse(request.body.read)
  
  event_type = payload["data"]["event_type"]
  call_control_id = payload["data"]["call_control_id"]
  
  case event_type
  when "call.initiated"
    # Store call state and answer the call
    $call_state[call_control_id] = {
      from: payload["data"]["from"]["phone_number"],
      to: payload["data"]["to"]["phone_number"],
      initiated_at: Time.now
    }
    
    begin
      answer_call(call_control_id, client)
      status 200
      json({ status: "call_answered" })
    rescue Telnyx::AuthenticationError
      status 401
      json({ error: "Invalid API key" })
    rescue Telnyx::RateLimitError
      status 429
      json({ error: "Rate limit exceeded" })
    rescue Telnyx::APIStatusError => e
      status e.status_code
      json({ error: e.message, status_code: e.status_code })
    rescue Telnyx::APIConnectionError
      status 503
      json({ error: "Network error connecting to Telnyx" })
    rescue StandardError => e
      status 400
      json({ error: e.message })
    end
    
  when "call.answered"
    # Call was answered — now forward it
    forward_to = ENV["FORWARD_TO_NUMBER"]
    
    begin
      forward_call(call_control_id, forward_to, client)
      status 200
      json({ status: "call_forwarded", forward_to: forward_to })
    rescue Telnyx::AuthenticationError
      status 401
      json({ error: "Invalid API key" })
    rescue Telnyx::RateLimitError
      status 429
      json({ error: "Rate limit exceeded" })
    rescue Telnyx::APIStatusError => e
      status e.status_code
      json({ error: e.message, status_code: e.status_code })
    rescue Telnyx::APIConnectionError
      status 503
      json({ error: "Network error connecting to Telnyx" })
    rescue StandardError => e
      status 400
      json({ error: e.message })
    end
    
  when "call.hangup"
    # Clean up call state
    $call_state.delete(call_control_id)
    status 200
    json({ status: "call_ended" })
    
  else
    status 200
    json({ status: "event_received", event_type: event_type })
  end
end

# Health check endpoint
get "/health" do
  json({ status: "ok" })
end

# Endpoint to check call state (for testing)
get "/calls/:call_control_id" do
  call_control_id = params[:call_control_id]
  call_info = $call_state[call_control_id]
  
  if call_info
    json(call_info)
  else
    status 404
    json({ error: "Call not found" })
  end
end
