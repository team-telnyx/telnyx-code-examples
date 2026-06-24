#!/usr/bin/env ruby
"""Production-ready Sinatra endpoint for sending MMS via Telnyx."""

require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize client with the new SDK pattern
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

def send_mms(to_number, message, media_urls)
  """Send MMS via Telnyx and return JSON-serializable response data."""
  from_number = ENV["TELNYX_PHONE_NUMBER"]
  raise "TELNYX_PHONE_NUMBER environment variable not set" unless from_number

  # Validate E.164 format to prevent API errors
  raise "Phone number must be in E.164 format (e.g., +15551234567)" unless to_number.start_with?("+")

  # Validate media_urls is an array and not empty
  raise "media_urls must be a non-empty array of URLs" unless media_urls.is_a?(Array) && media_urls.any?

  # Validate each URL is a string
  media_urls.each do |url|
    raise "Each media URL must be a string" unless url.is_a?(String)
  end

  # Use client.messages.create() with media_urls parameter for MMS
  response = client.messages.create(
    from_: from_number,
    to: to_number,
    text: message,
    media_urls: media_urls
  )

  # Extract serializable data — SDK objects are NOT JSON-serializable
  {
    message_id: response.data.id,
    status: response.data.to&.first&.status || "unknown",
    from: from_number,
    to: to_number,
    media_count: media_urls.length
  }
end

# Error handler for Telnyx exceptions
error Telnyx::AuthenticationError do
  status 401
  json({ error: "Invalid API key" })
end

error Telnyx::RateLimitError do
  status 429
  json({ error: "Rate limit exceeded. Please slow down." })
end

error Telnyx::APIStatusError do |err|
  status err.status_code || 500
  json({ error: err.message, status_code: err.status_code })
end

error Telnyx::APIConnectionError do
  status 503
  json({ error: "Network error connecting to Telnyx" })
end

error StandardError do |err|
  status 400
  json({ error: err.message })
end

# Helper to parse and return JSON
def json(data)
  content_type :json
  data.to_json
end

# MMS send endpoint
post "/mms/send" do
  request.body.rewind
  data = JSON.parse(request.body.read)

  to_number = data["to"]
  message = data["message"]
  media_urls = data["media_urls"]

  raise "Missing required fields: 'to', 'message', and 'media_urls'" unless to_number && message && media_urls

  result = send_mms(to_number, message, media_urls)
  status 200
  json(result)
end

# Health check endpoint
get "/health" do
  json({ status: "ok" })
end
