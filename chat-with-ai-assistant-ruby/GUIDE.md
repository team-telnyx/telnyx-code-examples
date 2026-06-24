# Guide: Chat With a Telnyx AI Assistant in Ruby

This walkthrough builds a small Sinatra service that chats with a Telnyx AI
Assistant and keeps multi-turn context by reusing a `conversation_id`. It uses the
Telnyx Ruby SDK 5.x line and verifies inbound webhooks with native Ed25519.

## Prerequisites

- Ruby 3.2.0 or newer. The Telnyx 5.x SDK (a Stainless-generated rewrite) does not
  support older Rubies.
- A Telnyx account and API key — [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys).
- An AI Assistant created in the Portal (note its id for `AI_ASSISTANT_ID`).

## 1. Install dependencies

Create a `Gemfile`. The `standardwebhooks` pin is not optional: `require "telnyx"`
transitively requires it at load time even though the gem does not declare it as a
runtime dependency, so without it the require raises `LoadError`.

```ruby
source "https://rubygems.org"

ruby ">= 3.2.0"

gem "telnyx", "~> 5.131"   # Telnyx::Client instance API; client.ai.assistants.chat
gem "sinatra", "~> 4.1"    # raw body access for webhook verification
gem "dotenv", "~> 3.1"
gem "ed25519", "~> 1.3"    # native Telnyx Ed25519 webhook verification
gem "standardwebhooks", "~> 1.1"  # transitive require of telnyx 5.x
```

```bash
bundle install
```

## 2. Configure credentials

Copy `.env.example` to `.env` and fill in your values:

```bash
TELNYX_API_KEY=your_telnyx_api_key_here
AI_ASSISTANT_ID=your_assistant_id_here
TELNYX_PUBLIC_KEY=your_telnyx_public_key_here   # only needed for webhooks
PORT=3000
```

Never commit `.env` — only `.env.example`.

## 3. Initialize the client once

The Telnyx 5.x SDK uses an instance client (`Telnyx::Client.new`), not the legacy
the legacy module-level API key setter. Instantiate it once per process — it is thread-safe
and owns its own connection pool.

```ruby
require "telnyx"
require "dotenv/load"

CLIENT = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])
```

## 4. Chat with the assistant

The chat call lives at `client.ai.assistants.chat` (note `ai.assistants`, not
`ai_assistants`). It takes the assistant id positionally and `content:`,
`conversation_id:`, and optional `name:` keyword arguments. The response has a
single field, `content` — the reply text.

```ruby
def chat_with_assistant(assistant_id:, content:, conversation_id:, name: nil)
  raise ArgumentError, "AI_ASSISTANT_ID environment variable not set" if assistant_id.nil? || assistant_id.empty?
  raise ArgumentError, "Message cannot be empty" if content.nil? || content.strip.empty?

  response = CLIENT.ai.assistants.chat(
    assistant_id,
    content: content,
    conversation_id: conversation_id,
    name: name
  )

  {
    assistant_id: assistant_id,
    conversation_id: conversation_id,
    user_message: content,
    assistant_response: response.content
  }
end
```

## 5. Maintain conversation context

Context is preserved by reusing the same `conversation_id` across turns. The HTTP
handler accepts an optional `conversation_id` and mints a new one on the first turn,
then returns it so the client can send it back next time.

```ruby
conversation_id = body["conversation_id"]
conversation_id = "conv-#{SecureRandom.uuid}" if conversation_id.nil? || conversation_id.to_s.strip.empty?
```

## 6. Expose a production-safe endpoint

Use Sinatra and turn off exception display so internal details never leak to
clients. Telnyx errors in the 5.x SDK are namespaced under `Telnyx::Errors::`, and
the HTTP status accessor is `e.status` (an Integer), not `e.status_code`.

```ruby
set :show_exceptions, false
set :raise_errors, false

post "/chat" do
  content_type :json

  begin
    body = JSON.parse(request.body.read)
  rescue JSON::ParserError
    halt 400, { error: "Request body must be valid JSON" }.to_json
  end

  message = body["message"]
  if message.nil? || (message.is_a?(String) && message.strip.empty?)
    halt 400, { error: "Missing required field: 'message'" }.to_json
  end

  conversation_id = body["conversation_id"]
  conversation_id = "conv-#{SecureRandom.uuid}" if conversation_id.nil? || conversation_id.to_s.strip.empty?

  begin
    result = chat_with_assistant(
      assistant_id: ENV["AI_ASSISTANT_ID"],
      content: message,
      conversation_id: conversation_id,
      name: body["name"]
    )
    status 200
    result.to_json
  rescue ArgumentError => e
    code = e.message.include?("environment variable") ? 500 : 400
    halt code, { error: e.message }.to_json
  rescue Telnyx::Errors::AuthenticationError
    halt 401, { error: "Invalid API key" }.to_json
  rescue Telnyx::Errors::RateLimitError
    halt 429, { error: "Rate limit exceeded. Please slow down." }.to_json
  rescue Telnyx::Errors::APIConnectionError
    halt 503, { error: "Network error connecting to Telnyx" }.to_json
  rescue Telnyx::Errors::APIStatusError => e
    code = e.status.is_a?(Integer) && e.status >= 400 ? e.status : 502
    halt code, { error: "Telnyx API error" }.to_json
  end
end
```

## 7. Verify inbound webhooks (Ed25519)

Telnyx signs webhooks with Ed25519 over the string `"<telnyx-timestamp>|<raw-body>"`.
Do **not** use `client.webhooks.unwrap` — in the 5.x SDK it delegates to the Standard
Webhooks HMAC scheme (`webhook-*` headers, symmetric secret), which never matches a
genuine Telnyx signature. Verify natively with the `ed25519` gem, always on the RAW
body and before parsing, and read event fields from `data.payload`.

```ruby
require "ed25519"
require "base64"

MAX_WEBHOOK_SKEW = 300

post "/webhooks/ai" do
  content_type :json

  raw       = request.body.read
  signature = request.env["HTTP_TELNYX_SIGNATURE_ED25519"]
  timestamp = request.env["HTTP_TELNYX_TIMESTAMP"]

  halt 400, { error: "Missing signature headers" }.to_json unless signature && timestamp
  halt 408, { error: "Stale webhook" }.to_json if (Time.now.to_i - timestamp.to_i).abs > MAX_WEBHOOK_SKEW

  verify_key = Ed25519::VerifyKey.new(Base64.decode64(ENV.fetch("TELNYX_PUBLIC_KEY")))
  begin
    verify_key.verify(Base64.decode64(signature), "#{timestamp}|#{raw}")
  rescue Ed25519::VerifyError, ArgumentError
    halt 401, { error: "Invalid signature" }.to_json
  end

  event   = JSON.parse(raw)
  payload = event.dig("data", "payload") || {}
  # ... handle event["data"]["event_type"] using payload ...

  status 200
  { received: true }.to_json
end
```

## 8. Run and test

```bash
ruby app.rb
```

```bash
# First turn — omit conversation_id; the response gives you one back.
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"What are your business hours?"}'

# Next turn — pass the conversation_id back to keep context.
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"And on weekends?","conversation_id":"conv-...from-previous-response"}'
```

## Notes on the 5.x SDK

- Resource path is `client.ai.assistants.chat(...)`, **not** `client.ai_assistants.chat`.
- Params are `content:` / `conversation_id:` / `name:`, **not** `messages: [{role:, content:}]`.
- The response exposes only `response.content` — there is no `.data`, `.messages`, or `.assistant_id`.
- Error classes are namespaced: `Telnyx::Errors::AuthenticationError`, `Telnyx::Errors::RateLimitError`, `Telnyx::Errors::APIConnectionError`, `Telnyx::Errors::APIStatusError`. The status accessor is `e.status`.

## Resources

- [AI Assistants Guide](https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant)
- [Chat with an Assistant — API Reference](https://developers.telnyx.com/api-reference/assistants/chat-with-an-assistant)
- [Ruby SDK](https://developers.telnyx.com/development/sdk/ruby)
