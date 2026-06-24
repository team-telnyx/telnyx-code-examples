# Route inbound phone calls to a Telnyx AI assistant — Sinatra webhook receiver.
#
# Flow: Telnyx posts Call Control webhooks to POST /webhooks/voice. We verify the
# Ed25519 signature on the RAW request body BEFORE trusting it, then issue Call
# Control commands (answer the call, then start the AI assistant) using the
# Telnyx Ruby SDK (v5.x instance client).
#
# Telnyx Ruby SDK is v5.x (Stainless rewrite): instance client `Telnyx::Client.new`,
# call-control commands at `client.calls.actions.<cmd>(call_control_id, ...)`,
# errors namespaced under `Telnyx::Errors::*`. The legacy module-level API key setter /
# `Telnyx::Call` module API does NOT exist in 5.x.
#
# Webhook verification is done natively with the `ed25519` gem. The SDK helper
# `client.webhooks.unwrap` is NOT compatible with real Telnyx webhooks (it uses
# the Standard Webhooks HMAC scheme + `webhook-*` headers, not Telnyx's Ed25519
# scheme over "<timestamp>|<body>" with `telnyx-*` headers), so we do not use it.

require "sinatra"
require "telnyx"
require "ed25519"
require "base64"
require "json"
require "logger"
require "dotenv/load"

# --- Configuration ---------------------------------------------------------

# Bind on all interfaces (so a tunnel like ngrok can reach it) and honor PORT.
set :bind, "0.0.0.0"
set :port, (ENV["PORT"] || 4567).to_i

# Replay-protection window: reject signatures whose timestamp is older/newer than this.
MAX_SKEW_SECONDS = 300

LOGGER = Logger.new($stdout)
LOGGER.level = Logger::INFO

# Instantiate the Telnyx client once per process. The 5.x client is thread-safe
# and owns its own connection pool, so it is safe to share across requests.
TELNYX = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# The Call Control App / Voice API assistant to route calls into.
ASSISTANT_ID = ENV["TELNYX_ASSISTANT_ID"]

# Base64-encoded Ed25519 public key from Telnyx Portal > Account >
# Keys & Credentials > Public Key. Decoded once at boot into a verify key.
def telnyx_verify_key
  encoded = ENV["TELNYX_PUBLIC_KEY"]
  return nil if encoded.nil? || encoded.empty?

  Ed25519::VerifyKey.new(Base64.decode64(encoded))
rescue StandardError => e
  LOGGER.error("Failed to load TELNYX_PUBLIC_KEY: #{e.class}")
  nil
end

VERIFY_KEY = telnyx_verify_key

# Serialize a Hash to a JSON response body and set the content type.
def json_response(hash)
  content_type :json
  hash.to_json
end

# --- Webhook signature verification ---------------------------------------

# Verify the Telnyx Ed25519 signature over "<timestamp>|<raw_body>".
# Returns true only when the signature is valid and the timestamp is fresh.
def verified_telnyx_webhook?(raw_body, signature_b64, timestamp)
  return false if VERIFY_KEY.nil?
  return false if signature_b64.nil? || signature_b64.empty?
  return false if timestamp.nil? || timestamp.empty?

  # Replay protection: reject stale or future-dated timestamps.
  return false if (Time.now.to_i - timestamp.to_i).abs > MAX_SKEW_SECONDS

  signed_payload = "#{timestamp}|#{raw_body}"
  VERIFY_KEY.verify(Base64.decode64(signature_b64), signed_payload)
  true
rescue Ed25519::VerifyError, ArgumentError
  # Bad signature, or wrong-length signature bytes.
  false
end

# --- Call routing logic ----------------------------------------------------

# Answer the call so we can begin issuing media commands on the leg.
def answer_call(call_control_id)
  TELNYX.calls.actions.answer(call_control_id)
  LOGGER.info("Answered call #{call_control_id}")
end

# Hand the answered call off to the configured Telnyx AI assistant.
def start_ai_assistant(call_control_id)
  if ASSISTANT_ID.nil? || ASSISTANT_ID.empty?
    LOGGER.warn("TELNYX_ASSISTANT_ID not set; skipping AI assistant start for #{call_control_id}")
    return
  end

  TELNYX.calls.actions.start_ai_assistant(
    call_control_id,
    assistant: { id: ASSISTANT_ID }
  )
  LOGGER.info("Started AI assistant for call #{call_control_id}")
end

# --- Routes ----------------------------------------------------------------

# Telnyx Call Control webhook receiver.
post "/webhooks/voice" do
  raw_body  = request.body.read
  signature = request.env["HTTP_TELNYX_SIGNATURE_ED25519"]
  timestamp = request.env["HTTP_TELNYX_TIMESTAMP"]

  unless verified_telnyx_webhook?(raw_body, signature, timestamp)
    LOGGER.warn("Rejected webhook: invalid or missing Telnyx signature")
    halt 401, json_response(error: "invalid signature")
  end

  begin
    event = JSON.parse(raw_body)
  rescue JSON::ParserError
    halt 400, json_response(error: "invalid JSON")
  end

  data            = event["data"] || {}
  event_type      = data["event_type"]
  payload         = data["payload"] || {}
  call_control_id = payload["call_control_id"]

  LOGGER.info("Received #{event_type} for call #{call_control_id}")

  begin
    case event_type
    when "call.initiated"
      # New inbound call detected — answer it. Routing happens on call.answered.
      answer_call(call_control_id) if payload["direction"] == "incoming"
    when "call.answered"
      # Leg is live — route the caller to the AI assistant.
      start_ai_assistant(call_control_id)
    when "call.hangup"
      LOGGER.info("Call #{call_control_id} ended (#{payload['hangup_cause']})")
    else
      LOGGER.info("Unhandled event type: #{event_type}")
    end
  rescue Telnyx::Errors::AuthenticationError
    # Do not leak details to the response; log a generic note and ack the webhook.
    LOGGER.error("Telnyx authentication failed (check TELNYX_API_KEY)")
  rescue Telnyx::Errors::RateLimitError
    LOGGER.error("Telnyx rate limit exceeded while handling #{event_type}")
  rescue Telnyx::Errors::APIStatusError => e
    LOGGER.error("Telnyx API error (HTTP #{e.status}) while handling #{event_type}")
  rescue Telnyx::Errors::APIConnectionError
    LOGGER.error("Network error connecting to Telnyx while handling #{event_type}")
  rescue Telnyx::Errors::APIError
    LOGGER.error("Unexpected Telnyx API error while handling #{event_type}")
  end

  # Always acknowledge receipt so Telnyx does not retry a webhook we processed.
  status 200
  json_response(status: "ok")
end

# Liveness probe.
get "/health" do
  json_response(status: "ok")
end
