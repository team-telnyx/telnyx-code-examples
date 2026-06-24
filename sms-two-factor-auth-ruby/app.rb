#!/usr/bin/env ruby
"""Production-ready Sinatra OTP 2FA system via Telnyx SMS."""

require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"
require "securerandom"
require "time"

# Initialize Telnyx client with the new SDK pattern
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# In-memory OTP storage (use Redis or database in production)
# Structure: { phone_number => { code: "123456", expires_at: Time.now + 300 } }
$otp_store = {}

# Helper function to generate a 6-digit OTP code
def generate_otp_code
  SecureRandom.random_bytes(3).unpack1("H*")[0..5].to_i.to_s.rjust(6, "0")
end

# Helper function to send OTP via SMS
def send_otp_sms(to_number, otp_code)
  from_number = ENV["TELNYX_PHONE_NUMBER"]
  raise "TELNYX_PHONE_NUMBER environment variable not set" unless from_number

  # Validate E.164 format to prevent API errors
  raise "Phone number must be in E.164 format (e.g., +15551234567)" unless to_number.start_with?("+")

  message_text = "Your verification code is: #{otp_code}. Valid for 5 minutes."

  response = client.messages.create(
    from_: from_number,
    to: to_number,
    text: message_text
  )

  # Extract serializable data — SDK objects are NOT JSON-serializable
  {
    message_id: response.data.id,
    status: response.data.to&.first&.status || "unknown",
    from: from_number,
    to: to_number
  }
end

# Helper function to store OTP with expiration
def store_otp(phone_number, otp_code)
  expiry_seconds = ENV["OTP_EXPIRY_SECONDS"]&.to_i || 300
  $otp_store[phone_number] = {
    code: otp_code,
    expires_at: Time.now + expiry_seconds
  }
end

# Helper function to verify OTP
def verify_otp(phone_number, provided_code)
  otp_data = $otp_store[phone_number]
  return { valid: false, reason: "No OTP found for this number" } unless otp_data

  if Time.now > otp_data[:expires_at]
    $otp_store.delete(phone_number)
    return { valid: false, reason: "OTP has expired" }
  end

  if otp_data[:code] != provided_code
    return { valid: false, reason: "Invalid OTP code" }
  end

  # OTP verified successfully — delete it to prevent reuse
  $otp_store.delete(phone_number)
  { valid: true, reason: "OTP verified successfully" }
end

# Sinatra route to request OTP
post "/otp/request" do
  content_type :json

  data = JSON.parse(request.body.read) rescue {}

  to_number = data["to"]
  unless to_number
    return [400, { error: "Missing required field: 'to'" }.to_json]
  end

  begin
    otp_code = generate_otp_code
    send_otp_sms(to_number, otp_code)
    store_otp(to_number, otp_code)

    [200, { message: "OTP sent successfully", phone: to_number }.to_json]

  rescue Telnyx::AuthenticationError
    [401, { error: "Invalid API key" }.to_json]
  rescue Telnyx::RateLimitError
    [429, { error: "Rate limit exceeded. Please slow down." }.to_json]
  rescue Telnyx::APIStatusError => e
    [e.status_code, { error: e.message, status_code: e.status_code }.to_json]
  rescue Telnyx::APIConnectionError
    [503, { error: "Network error connecting to Telnyx" }.to_json]
  rescue StandardError => e
    [400, { error: e.message }.to_json]
  end
end

# Sinatra route to verify OTP
post "/otp/verify" do
  content_type :json

  data = JSON.parse(request.body.read) rescue {}

  phone_number = data["phone"]
  otp_code = data["code"]

  unless phone_number && otp_code
    return [400, { error: "Missing required fields: 'phone' and 'code'" }.to_json]
  end

  begin
    result = verify_otp(phone_number, otp_code)

    if result[:valid]
      [200, { message: result[:reason], authenticated: true }.to_json]
    else
      [401, { error: result[:reason], authenticated: false }.to_json]
    end

  rescue StandardError => e
    [400, { error: e.message }.to_json]
  end
end

# Health check endpoint
get "/health" do
  content_type :json
  { status: "ok" }.to_json
end
