# frozen_string_literal: true

# Production-ready Sinatra application for managing Telnyx SIP (credential)
# connections: create, list, and retrieve credential-authenticated SIP trunks,
# plus a signature-verified webhook receiver for SIP/voice events.
#
# Run with: ruby app.rb   (requires Ruby 3.2+ and `bundle install`)

require "sinatra"
require "telnyx"
require "ed25519"
require "base64"
require "json"
require "dotenv/load"

# --- Configuration --------------------------------------------------------

# Instantiate the Telnyx client ONCE per process. The 5.x SDK exposes an
# instance-based API (Telnyx::Client.new), not the legacy module-level API key setter
# API. The client is thread-safe and owns its own connection pool.
TELNYX = Telnyx::Client.new(api_key: ENV.fetch("TELNYX_API_KEY", nil))

# Replay-protection window for inbound webhooks, in seconds.
MAX_WEBHOOK_SKEW = 300

set :host_authorization, { permitted_hosts: [] } if respond_to?(:set)

configure do
  set :show_exceptions, false      # never leak stack traces in responses
  set :raise_errors, false
  set :default_content_type, "application/json"
  set :bind, "0.0.0.0"
  set :port, (ENV["PORT"] || 4567).to_i
end

# --- Service logic --------------------------------------------------------

module SipConnections
  module_function

  # Create a credential-authenticated SIP connection.
  # Returns a JSON-serializable Hash (SDK model objects are not serializable).
  def create(connection_name:, user_name:, password:)
    response = TELNYX.credential_connections.create(
      connection_name: connection_name,
      user_name: user_name,
      password: password
    )
    serialize(response.data)
  end

  # List SIP connections (paginated). page_number/page_size map directly to the
  # Telnyx pagination params. Returns an Array of serializable Hashes.
  def list(page_number: 1, page_size: 20)
    page = TELNYX.credential_connections.list(
      page_number: page_number,
      page_size: page_size,
      sort: :created_at
    )
    page.data.map { |conn| serialize(conn) }
  end

  # Retrieve a single SIP connection by ID. Returns a serializable Hash.
  def retrieve(connection_id)
    response = TELNYX.credential_connections.retrieve(connection_id)
    serialize(response.data)
  end

  # Map an SDK model object to a plain Hash for JSON output.
  def serialize(conn)
    {
      id: conn.id,
      connection_name: conn.connection_name,
      user_name: conn.user_name,
      status: conn.active ? "active" : "inactive",
      created_at: conn.created_at
    }
  end
end

# --- Shared error handling ------------------------------------------------

# Wrap a Telnyx SDK call, mapping known SDK errors to safe HTTP responses.
# Never echoes raw exception detail that could leak credentials or internals.
def with_telnyx_error_handling
  yield
rescue Telnyx::Errors::AuthenticationError
  halt 401, json_error("Invalid API key")
rescue Telnyx::Errors::RateLimitError
  halt 429, json_error("Rate limit exceeded. Please slow down.")
rescue Telnyx::Errors::APIStatusError => e
  # e.status is the upstream HTTP status (Integer) in the 5.x SDK.
  status_code = e.respond_to?(:status) && e.status ? e.status : 502
  logger.warn("Telnyx API error: #{e.class} status=#{status_code}")
  halt status_code, json_error("Telnyx API request failed")
rescue Telnyx::Errors::APIConnectionError
  halt 503, json_error("Network error connecting to Telnyx")
rescue Telnyx::Errors::APIError => e
  logger.error("Unexpected Telnyx error: #{e.class}")
  halt 502, json_error("Telnyx API request failed")
end

def json_error(message)
  { error: message }.to_json
end

# --- Routes: SIP connection management ------------------------------------

# Create a SIP credential connection.
post "/sip/connections" do
  body = parse_json_body
  name = body["name"]
  username = body["username"]
  password = body["password"]

  if name.to_s.empty? || username.to_s.empty? || password.to_s.empty?
    halt 400, json_error("Missing required fields: name, username, password")
  end

  result = with_telnyx_error_handling do
    SipConnections.create(
      connection_name: name,
      user_name: username,
      password: password
    )
  end
  status 201
  result.to_json
end

# Retrieve a single SIP connection by ID.
get "/sip/connections/:id" do
  connection_id = params["id"]
  halt 400, json_error("Connection ID is required") if connection_id.to_s.empty?

  result = with_telnyx_error_handling { SipConnections.retrieve(connection_id) }
  status 200
  result.to_json
end

# List SIP connections.
get "/sip/connections" do
  page_number = (params["page_number"] || 1).to_i
  page_size = (params["page_size"] || 20).to_i

  result = with_telnyx_error_handling do
    SipConnections.list(page_number: page_number, page_size: page_size)
  end
  status 200
  result.to_json
end

# --- Routes: signature-verified inbound webhook ---------------------------

# Inbound SIP/voice webhook receiver. Telnyx signs every webhook with Ed25519
# over the string "<timestamp>|<raw-body>". We verify natively with the ed25519
# gem BEFORE parsing the body. (The SDK helper client.webhooks.unwrap implements
# the unrelated Standard Webhooks HMAC scheme and is NOT compatible with Telnyx
# Ed25519 signatures, so it is intentionally not used here.)
post "/webhooks/sip" do
  raw = request.body.read
  signature = request.env["HTTP_TELNYX_SIGNATURE_ED25519"]
  timestamp = request.env["HTTP_TELNYX_TIMESTAMP"]

  halt 400, json_error("Missing signature headers") if signature.nil? || timestamp.nil?

  if (Time.now.to_i - timestamp.to_i).abs > MAX_WEBHOOK_SKEW
    halt 408, json_error("Stale webhook timestamp")
  end

  public_key = ENV["TELNYX_PUBLIC_KEY"]
  halt 500, json_error("Webhook verification not configured") if public_key.to_s.empty?

  begin
    verify_key = Ed25519::VerifyKey.new(Base64.decode64(public_key))
    verify_key.verify(Base64.decode64(signature), "#{timestamp}|#{raw}")
  rescue Ed25519::VerifyError, ArgumentError
    halt 401, json_error("Invalid signature")
  end

  # Signature verified — now it is safe to parse and trust the payload.
  event =
    begin
      JSON.parse(raw)
    rescue JSON::ParserError
      halt 400, json_error("Invalid JSON body")
    end

  payload = event.dig("data", "payload")
  event_type = event.dig("data", "event_type")
  logger.info("Received verified Telnyx webhook: #{event_type}")

  # Read event fields from data.payload (e.g. an inbound call on this SIP trunk).
  if payload && %w[call.initiated call.received].include?(event_type)
    from = payload["from"]
    logger.info("Inbound SIP call from #{from}")
    # ... route the call / issue Call Control commands here ...
  end

  status 200
  { received: true }.to_json
end

# --- Helpers --------------------------------------------------------------

helpers do
  # Parse a JSON request body, returning an empty Hash on failure rather than
  # raising (validation of required fields happens in the route).
  def parse_json_body
    raw = request.body.read
    return {} if raw.to_s.empty?

    JSON.parse(raw)
  rescue JSON::ParserError
    halt 400, json_error("Invalid JSON body")
  end
end
