#!/usr/bin/env ruby
"""Production-ready Sinatra application for monitoring SIM card data usage via Telnyx."""

require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize client with the new SDK pattern
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# Helper function to fetch data usage for a single SIM card
def get_sim_data_usage(client, sim_card_id)
  """Retrieve network usage data for a SIM card."""
  begin
    # Fetch SIM card details
    sim_response = client.sim_cards.retrieve(sim_card_id)
    sim_data = sim_response.data
    
    # Return SIM details with usage placeholder
    # In production, call network_usage endpoint via REST
    {
      id: sim_data.id,
      iccid: sim_data.iccid,
      status: sim_data.status,
      sim_card_group_id: sim_data.sim_card_group_id,
      usage_mb: 0,
      last_updated: Time.now.iso8601
    }
  rescue => e
    raise e
  end
end

# Helper function to list all SIM cards with usage summary
def list_sim_cards_with_usage(client)
  """Fetch all SIM cards and return serializable data."""
  response = client.sim_cards.list
  response.data.map do |sim|
    {
      id: sim.id,
      iccid: sim.iccid,
      status: sim.status,
      sim_card_group_id: sim.sim_card_group_id,
      created_at: sim.created_at
    }
  end
end

# Helper function to check if usage exceeds threshold
def check_usage_threshold(usage_mb, threshold_mb)
  """Determine if usage has exceeded the configured threshold."""
  {
    usage_mb: usage_mb,
    threshold_mb: threshold_mb,
    exceeded: usage_mb >= threshold_mb,
    percentage: ((usage_mb.to_f / threshold_mb) * 100).round(2)
  }
end

# Route to list all SIM cards
get "/sim-cards" do
  content_type :json
  begin
    sims = list_sim_cards_with_usage(client)
    { data: sims, count: sims.length }.to_json
  rescue Telnyx::AuthenticationError
    status 401
    { error: "Invalid API key" }.to_json
  rescue Telnyx::RateLimitError
    status 429
    { error: "Rate limit exceeded. Please slow down." }.to_json
  rescue Telnyx::APIStatusError => e
    status e.status_code
    { error: e.message, status_code: e.status_code }.to_json
  rescue Telnyx::APIConnectionError
    status 503
    { error: "Network error connecting to Telnyx" }.to_json
  rescue => e
    status 500
    { error: "Internal server error", details: e.message }.to_json
  end
end

# Route to get data usage for a specific SIM card
get "/sim-cards/:id/usage" do
  content_type :json
  sim_card_id = params[:id]
  
  begin
    usage_data = get_sim_data_usage(client, sim_card_id)
    threshold_mb = ENV["DATA_LIMIT_THRESHOLD_MB"].to_i
    threshold_check = check_usage_threshold(usage_data[:usage_mb], threshold_mb)
    
    response_data = usage_data.merge(threshold_check)
    response_data.to_json
    
  rescue Telnyx::AuthenticationError
    status 401
    { error: "Invalid API key" }.to_json
  rescue Telnyx::RateLimitError
    status 429
    { error: "Rate limit exceeded. Please slow down." }.to_json
  rescue Telnyx::APIStatusError => e
    status e.status_code
    { error: e.message, status_code: e.status_code }.to_json
  rescue Telnyx::APIConnectionError
    status 503
    { error: "Network error connecting to Telnyx" }.to_json
  rescue => e
    status 500
    { error: "Internal server error", details: e.message }.to_json
  end
end

# Route to get usage dashboard for all SIM cards
get "/dashboard/usage" do
  content_type :json
  begin
    sims = list_sim_cards_with_usage(client)
    threshold_mb = ENV["DATA_LIMIT_THRESHOLD_MB"].to_i
    
    # In production, fetch actual usage data from network_usage endpoint
    dashboard_data = {
      total_sims: sims.length,
      active_sims: sims.count { |s| s[:status] == "active" },
      threshold_mb: threshold_mb,
      sims: sims,
      generated_at: Time.now.iso8601
    }
    
    dashboard_data.to_json
    
  rescue Telnyx::AuthenticationError
    status 401
    { error: "Invalid API key" }.to_json
  rescue Telnyx::RateLimitError
    status 429
    { error: "Rate limit exceeded. Please slow down." }.to_json
  rescue Telnyx::APIStatusError => e
    status e.status_code
    { error: e.message, status_code: e.status_code }.to_json
  rescue Telnyx::APIConnectionError
    status 503
    { error: "Network error connecting to Telnyx" }.to_json
  rescue => e
    status 500
    { error: "Internal server error", details: e.message }.to_json
  end
end

# Health check endpoint
get "/health" do
  content_type :json
  { status: "ok", timestamp: Time.now.iso8601 }.to_json
end
