# app/controllers/sms_controller.rb
class SmsController < ApplicationController
  skip_forgery_protection

  # Initialize client per request to ensure fresh connection
  before_action :initialize_client

  def send_sms
    to_number = params[:to]
    message = params[:message]

    # Validate presence of required fields
    unless to_number.present? && message.present?
      return render json: { error: "Missing required fields: 'to' and 'message'" }, status: :bad_request
    end

    # Validate E.164 format to prevent API errors
    unless to_number.start_with?("+")
      return render json: { error: "Phone number must be in E.164 format (e.g., +15551234567)" }, status: :bad_request
    end

    from_number = ENV["TELNYX_PHONE_NUMBER"]
    unless from_number
      return render json: { error: "TELNYX_PHONE_NUMBER environment variable not set" }, status: :internal_server_error
    end

    begin
      # Use client.messages.create() — NOT Telnyx::Message.create()
      response = @client.messages.create(
        from_: from_number,
        to: to_number,
        text: message
      )

      # Extract serializable data — do not return raw response object
      render json: {
        message_id: response.data.id,
        status: response.data.to.first&.status || "unknown",
        from: from_number,
        to: to_number
      }, status: :ok

    rescue Telnyx::AuthenticationError
      render json: { error: "Invalid API key" }, status: :unauthorized
    rescue Telnyx::RateLimitError
      render json: { error: "Rate limit exceeded. Please slow down." }, status: :too_many_requests
    rescue Telnyx::APIStatusError => e
      # e.status_code contains the HTTP status from Telnyx
      render json: { error: e.message, status_code: e.status_code }, status: e.status_code
    rescue Telnyx::APIConnectionError
      render json: { error: "Network error connecting to Telnyx" }, status: :service_unavailable
    end
  end

  private

  def initialize_client
    # Initialize client using new pattern — NOT Telnyx.api_key = ...
    @client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])
  end
end
