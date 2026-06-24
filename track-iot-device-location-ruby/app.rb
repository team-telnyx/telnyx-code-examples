#!/usr/bin/env ruby
"""Production-ready Sinatra application for tracking device locations via Telnyx IoT API."""

require "dotenv/load"
require "sinatra"
require "telnyx"
require "json"

# Configure Sinatra
set :port, ENV.fetch("PORT", 4567)
set :bind, "0.0.0.0"

# Initialize Telnyx client with the new SDK pattern
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# Helper function to retrieve SIM card details with network attachment info
def get_sim_location(sim_card_id)
  begin
    response = Telnyx::SimCard.retrieve(sim_card_id)
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    {
      id: response.id,
      iccid: response.iccid,
      status: response.status,
      sim_card_group_id: response.sim_card_group_id,
      phone_number: response.phone_number,
      network_attached: response.network_attached,
      last_seen_at: response.last_seen_at,
    }
  rescue Telnyx::AuthenticationError
    raise "Invalid API key"
  rescue Telnyx::APIStatusError => e
    raise "API error: #{e.message}"
  end
end

# Helper function to list all SIM cards with their status
def list_sim_cards_with_status
  begin
    response = Telnyx::SimCard.list
    
    # Map SDK objects to plain hashes for JSON serialization
    response.data.map do |sim|
      {
        id: sim.id,
        iccid: sim.iccid,
        status: sim.status,
        phone_number: sim.phone_number,
        sim_card_group_id: sim.sim_card_group_id,
        network_attached: sim.network_attached,
      }
    end
  rescue Telnyx::AuthenticationError
    raise "Invalid API key"
  rescue Telnyx::APIStatusError => e
    raise "API error: #{e.message}"
  end
end

# Sinatra route to retrieve a single SIM card's location
get "/api/sim/:id/location" do
  content_type :json
  sim_id = params[:id]
  
  begin
    location_data = get_sim_location(sim_id)
    location_data.to_json
  rescue Telnyx::AuthenticationError
    status 401
    { error: "Invalid API key" }.to_json
  rescue Telnyx::RateLimitError
    status 429
    { error: "Rate limit exceeded. Please slow down." }.to_json
  rescue Telnyx::APIStatusError => e
    status e.status_code || 500
    { error: e.message, status_code: e.status_code }.to_json
  rescue Telnyx::APIConnectionError
    status 503
    { error: "Network error connecting to Telnyx" }.to_json
  rescue StandardError => e
    status 400
    { error: e.message }.to_json
  end
end

# Sinatra route to list all SIM cards with location status
get "/api/sim/list" do
  content_type :json
  
  begin
    sims = list_sim_cards_with_status
    { data: sims }.to_json
  rescue Telnyx::AuthenticationError
    status 401
    { error: "Invalid API key" }.to_json
  rescue Telnyx::RateLimitError
    status 429
    { error: "Rate limit exceeded. Please slow down." }.to_json
  rescue Telnyx::APIStatusError => e
    status e.status_code || 500
    { error: e.message, status_code: e.status_code }.to_json
  rescue Telnyx::APIConnectionError
    status 503
    { error: "Network error connecting to Telnyx" }.to_json
  rescue StandardError => e
    status 400
    { error: e.message }.to_json
  end
end

# Webhook endpoint to receive SIM card network attachment events
post "/webhooks/sim-location" do
  content_type :json
  
  begin
    payload = JSON.parse(request.body.read)
    event_type = payload["data"]["event_type"]
    
    case event_type
    when "sim_card.network.attached"
      # Device connected to network — extract location metadata
      sim_id = payload["data"]["sim_card_id"]
      network_info = payload["data"]["network_info"]
      
      # Log or store location data (example: write to database)
      puts "SIM #{sim_id} attached to network: #{network_info}"
      
      { status: "received", event: event_type }.to_json
      
    when "sim_card.status.changed"
      # SIM status changed (activated/deactivated)
      sim_id = payload["data"]["sim_card_id"]
      new_status = payload["data"]["status"]
      
      puts "SIM #{sim_id} status changed to: #{new_status}"
      
      { status: "received", event: event_type }.to_json
      
    else
      # Unknown event type
      { status: "received", event: event_type }.to_json
    end
  rescue JSON::ParserError
    status 400
    { error: "Invalid JSON payload" }.to_json
  rescue StandardError => e
    status 500
    { error: "Webhook processing error: #{e.message}" }.to_json
  end
end

# Health check endpoint
get "/health" do
  content_type :json
  { status: "ok" }.to_json
end
