# Place Your First Outbound Call with Telnyx and Ruby

Place an outbound phone call using the Telnyx Call Control API and the Telnyx
Ruby SDK, exposed through a Sinatra endpoint.

## How It Works

```
  POST /calls/dial
        │
        ▼
  ┌──────────────────────┐
  │  Sinatra app (app.rb) │
  │  Telnyx::Client       │
  └──────────┬───────────┘
             │  client.calls.dial(connection_id:, from:, to:)
             ▼
  ┌──────────────────────┐
  │ Telnyx Call Control   │ ──► outbound call placed
  └──────────┬───────────┘
             │  Ed25519-signed webhook events
             ▼
  POST /webhooks/voice  (signature verified, then handled)
```

## Telnyx Products Used

- **Voice / Call Control** — programmatically place and steer calls, with a
  webhook event for every state change

## API Endpoints

- **Dial (Create Call)**: `POST /v2/calls` -- [API reference](https://developers.telnyx.com/api-reference/call-commands/dial)

## Prerequisites

- Ruby 3.2 or higher (the Telnyx Ruby SDK 5.x requires it)
- Bundler
- [Telnyx account](https://portal.telnyx.com/sign-up) with a funded balance
- [API key](https://portal.telnyx.com/api-keys)
- A [Call Control Application](https://portal.telnyx.com/call-control/applications) (its ID is your `connection_id`)
- A [phone number](https://portal.telnyx.com/numbers/my-numbers) with voice enabled, assigned to that application

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/make-outbound-phone-call-ruby
cp .env.example .env
bundle install
```

Edit `.env` with your Telnyx credentials:

- `TELNYX_API_KEY` — from the [Telnyx Portal](https://portal.telnyx.com/api-keys)
- `TELNYX_CONNECTION_ID` — your Call Control Application ID
- `TELNYX_PHONE_NUMBER` — your sending number in E.164 format, e.g. `+15551234567`
- `TELNYX_VOICE_WEBHOOK_URL` and `TELNYX_PUBLIC_KEY` — optional, only needed to receive and verify webhooks

## Step 2: Understand the Code

Everything lives in `app.rb`. The Telnyx client is created **once** per process —
it is thread-safe and owns its own connection pool:

```ruby
CLIENT = Telnyx::Client.new(api_key: API_KEY)
```

> The Telnyx Ruby SDK 5.x uses this instance-client API
> (`Telnyx::Client.new(...)`), not the legacy module-level API key setter.

### Placing the call

`dial_call` builds the request and calls `client.calls.dial`. The required
params are `connection_id:`, `from:`, and `to:` — the keyword is `from:`, not
`from_:`. Only JSON-serializable fields are returned; SDK model objects are not
directly serializable:

```ruby
def dial_call(to_number)
  params = {
    connection_id: CONNECTION_ID,
    from: FROM_NUMBER,
    to: to_number
  }
  # Only forward a webhook URL when one is configured.
  params[:webhook_url] = VOICE_WEBHOOK_URL unless VOICE_WEBHOOK_URL.nil? || VOICE_WEBHOOK_URL.empty?

  response = CLIENT.calls.dial(**params)
  call = response.data
  {
    call_control_id: call.call_control_id,
    call_leg_id: call.call_leg_id,
    call_session_id: call.call_session_id,
    is_alive: call.is_alive,
    from: FROM_NUMBER,
    to: to_number
  }
end
```

> The dial response exposes `call_control_id`, `call_leg_id`, `call_session_id`,
> and `is_alive`. There is **no** `state` field on the response — use `is_alive`
> to tell whether the leg is active.

### The endpoint

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/calls/dial` | Validate input, place the call, return serialized result |

`POST /calls/dial` parses the JSON body, validates `to` is present and in E.164
format, then dials. Telnyx SDK exceptions map to clean HTTP statuses and details
are logged, never returned:

```ruby
begin
  result = dial_call(to_number)
  status 200
  result.to_json
rescue Telnyx::Errors::AuthenticationError
  halt 401, { error: "Invalid API key" }.to_json
rescue Telnyx::Errors::RateLimitError
  halt 429, { error: "Rate limit exceeded. Please slow down." }.to_json
rescue Telnyx::Errors::APIStatusError => e
  logger.error("Telnyx API error: #{e.class} status=#{e.status}")
  upstream = e.status.to_i
  upstream = 502 unless (400..599).cover?(upstream)
  halt upstream, { error: "Telnyx API returned an error", status_code: e.status }.to_json
rescue Telnyx::Errors::APIConnectionError
  halt 503, { error: "Network error connecting to Telnyx" }.to_json
rescue StandardError => e
  logger.error("Unexpected error: #{e.class}: #{e.message}")
  halt 500, { error: "Internal server error" }.to_json
end
```

> In SDK 5.x the error classes are namespaced under `Telnyx::Errors::` and the
> HTTP status accessor is `e.status` (an Integer) — not the old bare
> `Telnyx::AuthenticationError` / `e.status_code`.

### Verifying webhooks (Ed25519)

Telnyx signs every webhook with Ed25519 over the string `"<timestamp>|<raw-body>"`.
Verify the signature **before** parsing the body, and read event fields from
`data.payload`. Do **not** use the SDK's `client.webhooks.unwrap` for Telnyx
webhooks — in 5.x it delegates to the Standard Webhooks HMAC scheme, which is
incompatible with Telnyx's Ed25519 signatures. Verify natively instead:

```ruby
def verify_telnyx_signature(raw_body, signature_b64, timestamp)
  return false if TELNYX_PUBLIC_KEY.nil? || TELNYX_PUBLIC_KEY.empty?
  return false if signature_b64.nil? || timestamp.nil?
  return false if (Time.now.to_i - timestamp.to_i).abs > MAX_WEBHOOK_SKEW

  verify_key = Ed25519::VerifyKey.new(Base64.decode64(TELNYX_PUBLIC_KEY))
  verify_key.verify(Base64.decode64(signature_b64), "#{timestamp}|#{raw_body}")
rescue Ed25519::VerifyError, ArgumentError
  false
end
```

The webhook route captures the raw body first, verifies, then dispatches on
`event_type`:

```ruby
post "/webhooks/voice" do
  content_type :json

  raw_body  = request.body.read
  signature = request.env["HTTP_TELNYX_SIGNATURE_ED25519"]
  timestamp = request.env["HTTP_TELNYX_TIMESTAMP"]

  unless verify_telnyx_signature(raw_body, signature, timestamp)
    halt 401, { error: "Invalid webhook signature" }.to_json
  end

  event      = JSON.parse(raw_body)
  event_type = event.dig("data", "event_type")
  payload    = event.dig("data", "payload") || {}
  # ... handle call.initiated / call.answered / call.hangup ...

  status 200
  { received: true }.to_json
end
```

## Step 3: Run It

```bash
ruby app.rb
```

The Sinatra app listens on `http://localhost:4567` by default.

## Step 4: Test It

```bash
curl -X POST http://localhost:4567/calls/dial \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+12125559999"
  }'
```

A successful call returns the call identifiers and the from/to numbers:

```json
{
  "call_control_id": "v3:uMi2qMWHT-mLFGkEm4t9tA",
  "call_leg_id": "428c31b6-7af4-4bcb-b68e-5013ef9657c1",
  "call_session_id": "428c31b6-abc4-4cba-1234-5013ef9657c1",
  "is_alive": true,
  "from": "+15551234567",
  "to": "+12125559999"
}
```

## Going to Production

- **Authentication** — add API key or token validation on `/calls/dial`
- **Webhook verification** — always set `TELNYX_PUBLIC_KEY` so events are verified
- **Follow-up commands** — react to `call.answered` with
  `CLIENT.calls.actions.speak(call_control_id, ...)`, `.hangup`, `.transfer`, etc.
- **Monitoring** — add structured logging and alerts around dial failures

## Resources

- [Source code and reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-ruby/README.md)
- [Typed API reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-ruby/API.md)
- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [Dial — API Reference](https://developers.telnyx.com/api-reference/call-commands/dial)
- [Ruby SDK](https://developers.telnyx.com/development/sdk/ruby)
- [Telnyx Portal](https://portal.telnyx.com)
