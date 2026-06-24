#!/usr/bin/env ruby
"""Production-ready SMS survey system using Sinatra and Telnyx."""

require "sinatra"
require "telnyx"
require "dotenv/load"
require "json"

# Initialize Telnyx client with API key from environment
client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])

# In-memory survey state storage (use a database in production)
survey_state = {}

# Survey questions in order
SURVEY_QUESTIONS = [
  "How satisfied are you with our service? (1-5)",
  "Would you recommend us to a friend? (yes/no)",
  "What could we improve?"
].freeze

# Helper function to send survey question
def send_survey_question(client, to_number, question_index)
  from_number = ENV["TELNYX_PHONE_NUMBER"]
  
  if !from_number
    raise "TELNYX_PHONE_NUMBER environment variable not set"
  end
  
  if !to_number.start_with?("+")
    raise "Phone number must be in E.164 format (e.g., +15551234567)"
  end
  
  question = SURVEY_QUESTIONS[question_index]
  message_text = "Survey Q#{question_index + 1}/#{SURVEY_QUESTIONS.length}: #{question}"
  
  response = client.messages.send_(
    from_: from_number,
    to: to_number,
    text: message_text
  )
  
  # Return serializable response data
  {
    message_id: response.data.id,
    status: response.data.to&.first&.status || "pending",
    from: from_number,
    to: to_number,
    question_index: question_index
  }
end

# Helper function to process survey response
def process_survey_response(survey_state, from_number, response_text, question_index)
  if !survey_state[from_number]
    survey_state[from_number] = {
      responses: [],
      current_question: 0,
      started_at: Time.now
    }
  end
  
  # Store the response
  survey_state[from_number][:responses] << {
    question_index: question_index,
    answer: response_text,
    received_at: Time.now
  }
  
  # Move to next question
  survey_state[from_number][:current_question] = question_index + 1
  
  survey_state[from_number]
end

# Route to initiate survey
post "/survey/start" do
  content_type :json
  
  data = JSON.parse(request.body.read) rescue {}
  to_number = data["to"]
  
  if !to_number
    return [400, { error: "Missing required field: 'to'" }.to_json]
  end
  
  begin
    result = send_survey_question(client, to_number, 0)
    survey_state[to_number] = {
      responses: [],
      current_question: 0,
      started_at: Time.now
    }
    [200, result.to_json]
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

# Webhook endpoint to receive inbound SMS
post "/webhooks/sms" do
  content_type :json
  
  begin
    payload = JSON.parse(request.body.read)
    
    # Validate webhook event type
    if payload["data"]["event_type"] != "message.received"
      return [200, { status: "ignored" }.to_json]
    end
    
    message_data = payload["data"]["payload"]
    from_number = message_data["from"]["phone_number"]
    response_text = message_data["text"]
    
    # Check if this number is in an active survey
    if !survey_state[from_number]
      return [200, { status: "no_active_survey" }.to_json]
    end
    
    current_state = survey_state[from_number]
    current_question_index = current_state[:current_question]
    
    # Process the response
    updated_state = process_survey_response(
      survey_state,
      from_number,
      response_text,
      current_question_index
    )
    
    # Check if survey is complete
    if updated_state[:current_question] >= SURVEY_QUESTIONS.length
      # Survey complete — send thank you message
      send_survey_question(client, from_number, -1) rescue nil
      
      return [200, {
        status: "survey_complete",
        responses: updated_state[:responses]
      }.to_json]
    end
    
    # Send next question
    next_question_index = updated_state[:current_question]
    send_survey_question(client, from_number, next_question_index)
    
    [200, {
      status: "response_received",
      next_question_index: next_question_index
    }.to_json]
    
  rescue Telnyx::AuthenticationError
    [401, { error: "Invalid API key" }.to_json]
  rescue Telnyx::APIStatusError => e
    [e.status_code, { error: e.message }.to_json]
  rescue Telnyx::APIConnectionError
    [503, { error: "Network error connecting to Telnyx" }.to_json]
  rescue StandardError => e
    [400, { error: e.message }.to_json]
  end
end

# Route to retrieve survey results
get "/survey/results/:phone_number" do
  content_type :json
  
  phone_number = params[:phone_number]
  
  if !survey_state[phone_number]
    return [404, { error: "No survey found for this phone number" }.to_json]
  end
  
  state = survey_state[phone_number]
  
  [200, {
    phone_number: phone_number,
    responses: state[:responses],
    started_at: state[:started_at],
    completed: state[:current_question] >= SURVEY_QUESTIONS.length
  }.to_json]
end

# Health check endpoint
get "/health" do
  content_type :json
  [200, { status: "ok" }.to_json]
end
