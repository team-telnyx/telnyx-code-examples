#!/usr/bin/env ruby
"""Production-ready IVR menu system using Telnyx Voice API and Sinatra."""

require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize Telnyx client with API key
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# In-memory call state storage (use Redis in production)
$call_state = {}

# Helper function to extract serializable data from SDK responses
def serialize_call(call_data)
  {
    call_control_id: call_data.call_control_id,
    state: call_data.state,
    is_alive: call_data.is_alive
  }
end

# Helper function to play a prompt and collect DTMF
def play_prompt_and_collect(client, call_control_id, prompt_text, max_digits)
  """Play a voice prompt and collect DTMF input."""
  begin
    # Speak the prompt using text-to-speech
    client.calls.actions.speak(
      call_control_id,
      payload: prompt_text,
      voice: "female",
      language: "en-US"
    )
    
    # Start DTMF collection
    client.calls.actions.gather_using_speak(
      call_control_id,
      payload: prompt_text,
      voice: "female",
      language: "en-US",
      max_digits: max_digits,
      timeout_millis: 5000
    )
  rescue Telnyx::APIStatusError => e
    puts "Error playing prompt: #{e.message}"
  end
end

# Webhook endpoint to handle inbound calls
post "/webhooks/call" do
  request.body.rewind
  payload = JSON.parse(request.body.read)
  
  event_type = payload["data"]["event_type"]
  call_control_id = payload["data"]["call_control_id"]
  
  case event_type
  when "call.initiated"
    # Inbound call received — answer and start IVR menu
    begin
      client.calls.actions.answer(call_control_id)
      
      # Store call state
      $call_state[call_control_id] = {
        status: "answered",
        menu_level: "main",
        created_at: Time.now
      }
      
      # Play main menu prompt
      play_prompt_and_collect(
        client,
        call_control_id,
        "Welcome to our IVR system. Press 1 for sales, 2 for support, or 3 to repeat this menu.",
        1
      )
      
      status 200
      json({ status: "call_answered" })
    rescue Telnyx::AuthenticationError
      status 401
      json({ error: "Invalid API key" })
    rescue Telnyx::APIStatusError => e
      status e.status_code || 500
      json({ error: e.message })
    rescue Telnyx::APIConnectionError
      status 503
      json({ error: "Network error connecting to Telnyx" })
    end
    
  when "call.dtmf.received"
    # DTMF digit received — route based on selection
    begin
      digit = payload["data"]["dtmf_digit"]
      menu_level = $call_state[call_control_id]&.dig(:menu_level) || "main"
      
      case menu_level
      when "main"
        case digit
        when "1"
          # Route to sales
          $call_state[call_control_id][:menu_level] = "sales"
          client.calls.actions.speak(
            call_control_id,
            payload: "You have selected sales. Transferring you now.",
            voice: "female",
            language: "en-US"
          )
          # Transfer to sales number (replace with actual number)
          client.calls.actions.transfer(
            call_control_id,
            to: "+15551234567"
          )
          
        when "2"
          # Route to support
          $call_state[call_control_id][:menu_level] = "support"
          client.calls.actions.speak(
            call_control_id,
            payload: "You have selected support. Transferring you now.",
            voice: "female",
            language: "en-US"
          )
          # Transfer to support number (replace with actual number)
          client.calls.actions.transfer(
            call_control_id,
            to: "+15559876543"
          )
          
        when "3"
          # Repeat menu
          play_prompt_and_collect(
            client,
            call_control_id,
            "Welcome to our IVR system. Press 1 for sales, 2 for support, or 3 to repeat this menu.",
            1
          )
        else
          # Invalid selection
          client.calls.actions.speak(
            call_control_id,
            payload: "Invalid selection. Please try again.",
            voice: "female",
            language: "en-US"
          )
          play_prompt_and_collect(
            client,
            call_control_id,
            "Press 1 for sales, 2 for support, or 3 to repeat this menu.",
            1
          )
        end
      end
      
      status 200
      json({ status: "dtmf_processed", digit: digit })
    rescue Telnyx::APIStatusError => e
      status e.status_code || 500
      json({ error: e.message })
    end
    
  when "call.hangup"
    # Call ended — clean up state
    $call_state.delete(call_control_id)
    status 200
    json({ status: "call_ended" })
    
  when "call.speak.ended"
    # TTS playback finished
    status 200
    json({ status: "speak_ended" })
    
  else
    status 200
    json({ status: "event_received", event_type: event_type })
  end
end

# Health check endpoint
get "/health" do
  json({ status: "ok" })
end

# Error handler for uncaught exceptions
error do |err|
  status 500
  json({ error: "Internal server error", message: err.message })
end
