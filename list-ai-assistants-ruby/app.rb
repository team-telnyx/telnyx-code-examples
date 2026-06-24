#!/usr/bin/env ruby
"""Production-ready Sinatra endpoint for listing AI Assistants via Telnyx."""

require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize client with the Ruby SDK pattern
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

def list_assistants(client)
  """Fetch all AI Assistants and return serializable data."""
  response = client.ai_assistants.list
  
  # Extract serializable data — SDK objects are NOT JSON-serializable
  response.data.map do |assistant|
    {
      id: assistant.id,
      name: assistant.name,
      model: assistant.model,
      enabled_features: assistant.enabled_features,
      created_at: assistant.created_at,
    }
  end
end

get "/ai/assistants" do
  """HTTP endpoint to list all AI Assistants."""
  content_type :json
  
  begin
    assistants = list_assistants(client)
    { assistants: assistants, count: assistants.length }.to_json
    
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
    status 500
    { error: "Internal server error", details: e.message }.to_json
  end
end

if __FILE__ == $0
  Sinatra::Application.run!(port: 4567)
end
