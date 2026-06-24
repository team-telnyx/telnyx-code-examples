#!/usr/bin/env ruby
"""Production-ready Sinatra application for managing conference calls via Telnyx."""

require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize Telnyx client with API key from environment
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# In-memory store for conference state (use Redis in production)
$conferences = {}
$call_states = {}

def initiate_call(to_number, conference_id)
  """Initiate an outbound call and add to conference."""
  client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])
  
  response = client.calls.dial(
    from_: ENV["TELNYX_PHONE_NUMBER"],
    to: to_number,
    connection_id: ENV["TELNYX_CONNECTION_ID"]
  )
  
  # Extract serializable data — SDK objects are NOT JSON-serializable
  {
    call_control_id: response.data.call_control_id,
    to: to_number,
    conference_id: conference_id,
    status: "initiated"
  }
end

def add_to_conference(call_control_id, conference_id)
  """Add an active call to a conference."""
  client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])
  
  response = client.calls.actions.bridge(
    call_control_id,
    call_control_ids: [call_control_id],
    conference_id: conference_id
  )
  
  {
    call_control_id: response.data.call_control_id,
    conference_id: conference_id,
    status: "added_to_conference"
  }
end

def hangup_call(call_control_id)
  """Terminate a call."""
  client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])
  
  response = client.calls.actions.hangup(call_control_id)
  
  {
    call_control_id: response.data.call_control_id,
    status: "hangup_initiated"
  }
end

def get_conference_status(conference_id)
  """Retrieve current conference state."""
  conference = $conferences[conference_id] || {}
  
  {
    conference_id: conference_id,
    participants: conference[:participants] || [],
    created_at: conference[:created_at],
    participant_count: (conference[:participants] || []).length
  }
end

# POST /conferences/create — Create a new conference
post "/conferences/create" do
  content_type :json
  
  conference_id = "conf_#{Time.now.to_i}_#{rand(10000)}"
  
  $conferences[conference_id] = {
    created_at: Time.now.iso8601,
    participants: []
  }
  
  json({
    conference_id: conference_id,
    status: "created"
  })
end

# POST /conferences/:conference_id/invite — Invite participant to conference
post "/conferences/:conference_id/invite" do
  content_type :json
  conference_id = params[:conference_id]
  
  data = JSON.parse(request.body.read)
  to_number = data["to"]
  
  unless to_number
    return [400, json({ error: "Missing required field: 'to'" })]
  end
  
  unless to_number.start_with?("+")
    return [400, json({ error: "Phone number must be in E.164 format (e.g., +15551234567)" })]
  end
  
  begin
    result = initiate_call(to_number, conference_id)
    
    # Track participant in conference state
    $conferences[conference_id] ||= { participants: [], created_at: Time.now.iso8601 }
    $conferences[conference_id][:participants] << result[:call_control_id]
    
    json(result)
    
  rescue Telnyx::AuthenticationError
    [401, json({ error: "Invalid API key" })]
  rescue Telnyx::RateLimitError
    [429, json({ error: "Rate limit exceeded. Please slow down." })]
  rescue Telnyx::APIStatusError => e
    [e.status_code, json({ error: e.message, status_code: e.status_code })]
  rescue Telnyx::APIConnectionError
    [503, json({ error: "Network error connecting to Telnyx" })]
  rescue StandardError => e
    [500, json({ error: e.message })]
  end
end

# GET /conferences/:conference_id/status — Get conference status
get "/conferences/:conference_id/status" do
  content_type :json
  conference_id = params[:conference_id]
  
  status = get_conference_status(conference_id)
  json(status)
end

# POST /conferences/:conference_id/hangup — End conference and disconnect all participants
post "/conferences/:conference_id/hangup" do
  content_type :json
  conference_id = params[:conference_id]
  
  conference = $conferences[conference_id]
  unless conference
    return [404, json({ error: "Conference not found" })]
  end
  
  begin
    results = []
    (conference[:participants] || []).each do |call_control_id|
      result = hangup_call(call_control_id)
      results << result
    end
    
    # Clean up conference state
    $conferences.delete(conference_id)
    
    json({
      conference_id: conference_id,
      disconnected_participants: results.length,
      status: "conference_ended"
    })
    
  rescue Telnyx::AuthenticationError
    [401, json({ error: "Invalid API key" })]
  rescue Telnyx::APIStatusError => e
    [e.status_code, json({ error: e.message, status_code: e.status_code })]
  rescue Telnyx::APIConnectionError
    [503, json({ error: "Network error connecting to Telnyx" })]
  rescue StandardError => e
    [500, json({ error: e.message })]
  end
end

# POST /webhooks/call-events — Receive and process call control webhooks
post "/webhooks/call-events" do
  content_type :json
  
  payload = JSON.parse(request.body.read)
  event_type = payload["data"]["event_type"]
  call_control_id = payload["data"]["call_control_id"]
  
  case event_type
  when "call.initiated"
    $call_states[call_control_id] = { status: "initiated", initiated_at: Time.now.iso8601 }
    puts "Call initiated: #{call_control_id}"
    
  when "call.answered"
    $call_states[call_control_id] ||= {}
    $call_states[call_control_id][:status] = "answered"
    $call_states[call_control_id][:answered_at] = Time.now.iso8601
    puts "Call answered: #{call_control_id}"
    
  when "call.hangup"
    $call_states[call_control_id] ||= {}
    $call_states[call_control_id][:status] = "hangup"
    $call_states[call_control_id][:hangup_at] = Time.now.iso8601
    puts "Call hangup: #{call_control_id}"
    
  when "call.bridge.started"
    $call_states[call_control_id] ||= {}
    $call_states[call_control_id][:status] = "in_conference"
    puts "Call added to conference: #{call_control_id}"
    
  else
    puts "Unhandled event type: #{event_type}"
  end
  
  json({ status: "received" })
end

# GET / — Health check
get "/" do
  content_type :json
  json({ status: "ok", service: "telnyx-conference-call" })
end
