#!/usr/bin/env ruby
"""Production-ready Sinatra endpoint for creating AI assistants via Telnyx."""

require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize client with the Ruby SDK pattern
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

def create_assistant(name:, model:, instructions:, enabled_features: [])
  """Create an AI assistant and return JSON-serializable response data."""
  
  # Validate required fields to prevent API errors
  raise ArgumentError, "Name is required" if name.nil? || name.empty?
  raise ArgumentError, "Model is required" if model.nil? || model.empty?
  raise ArgumentError, "Instructions are required" if instructions.nil? || instructions.empty?
  
  # Use client.ai_assistants.create() — NOT client.ai_assistants.create()
  response = client.ai_assistants.create(
    name: name,
    model: model,
    instructions: instructions,
    enabled_features: enabled_features
  )
  
  # Extract serializable data — SDK objects are NOT JSON-serializable
  {
    id: response.data.id,
    name: response.data.name,
    model: response.data.model,
    instructions: response.data.instructions,
    enabled_features: response.data.enabled_features,
    created_at: response.data.created_at
  }
end

post "/ai/assistants" do
  """HTTP endpoint to create an AI assistant."""
  content_type :json
  
  # Parse JSON request body
  begin
    data = JSON.parse(request.body.read)
  rescue JSON::ParserError
    return [400, { error: "Invalid JSON in request body" }.to_json]
  end
  
  # Validate required fields
  name = data["name"]
  model = data["model"]
  instructions = data["instructions"]
  enabled_features = data["enabled_features"] || []
  
  if !name || !model || !instructions
    return [400, { error: "Missing required fields: 'name', 'model', 'instructions'" }.to_json]
  end
  
  begin
    result = create_assistant(
      name: name,
      model: model,
      instructions: instructions,
      enabled_features: enabled_features
    )
    [201, result.to_json]
    
  rescue Telnyx::AuthenticationError
    [401, { error: "Invalid API key" }.to_json]
  rescue Telnyx::RateLimitError
    [429, { error: "Rate limit exceeded. Please slow down." }.to_json]
  rescue Telnyx::APIStatusError => e
    [e.status_code, { error: e.message, status_code: e.status_code }.to_json]
  rescue Telnyx::APIConnectionError
    [503, { error: "Network error connecting to Telnyx" }.to_json]
  rescue ArgumentError => e
    [400, { error: e.message }.to_json]
  end
end
