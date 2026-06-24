# Send Your First SMS with Telnyx and Ruby

Send an SMS message using the Telnyx Messaging API and the Telnyx Ruby SDK, exposed through a Rails controller endpoint.

## How It Works

```
  POST /sms/send
        │
        ▼
  ┌──────────────────┐
  │  SmsController    │
  │  (Telnyx::Client) │
  └────────┬─────────┘
           │  client.messages.send_
           ▼
  ┌──────────────────┐
  │ Telnyx Messaging  │
  └────────┬─────────┘
           │
           └──► SMS delivered
```

## Telnyx Products Used

- **Messaging** — send and receive messages with delivery receipts

## API Endpoints

- **Send Message**: `POST /v2/messages` -- [API reference](https://developers.telnyx.com/api/messaging/send-message)

## Prerequisites

- Ruby 3.0 or higher
- Bundler
- [Telnyx account](https://portal.telnyx.com/sign-up) with a funded balance
- [API key](https://portal.telnyx.com/api-keys)
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) with messaging enabled

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-sms-ruby
cp .env.example .env
bundle install
```

Edit `.env` with your Telnyx credentials:

- `TELNYX_API_KEY` — from the [Telnyx Portal](https://portal.telnyx.com/api-keys)
- `TELNYX_PHONE_NUMBER` — your sending number in E.164 format, e.g. `+15551234567`

## Step 2: Understand the Code

Everything lives in `app.rb`, which defines `SmsController` with a single `send_sms` action.

### Per-request client

A `before_action` builds a fresh Telnyx client for every request:

```ruby
def initialize_client
  # Initialize client using new pattern — NOT the legacy module-level API key setter
  @client = Telnyx::Client.new(api_key: ENV["TELNYX_API_KEY"])
end
```

### The endpoint

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/sms/send` | Validate input, send the SMS, return serialized result |

`send_sms` reads `params[:to]` and `params[:message]`, validates them, then calls the SDK:

```ruby
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
  # ...
```

The send itself uses `client.messages.send_`, and only serializable fields are returned — never the raw response object:

```ruby
response = @client.messages.send_(
  from_: from_number,
  to: to_number,
  text: message
)

render json: {
  message_id: response.data.id,
  status: response.data.to.first&.status || "unknown",
  from: from_number,
  to: to_number
}, status: :ok
```

Telnyx SDK exceptions map to clean HTTP statuses (`AuthenticationError` → 401, `RateLimitError` → 429, `APIStatusError` passes through Telnyx's status, `APIConnectionError` → 503), so internal error details never leak in responses.

## Step 3: Run It

```bash
ruby app.rb
```

## Step 4: Test It

```bash
curl -X POST http://localhost:3000/sms/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+12125559999",
    "message": "Hello from Telnyx!"
  }'
```

A successful call returns the message ID, status, and the from/to numbers:

```json
{
  "message_id": "40385f64-5717-4562-b3fc-2c963f66afa6",
  "status": "queued",
  "from": "+15551234567",
  "to": "+12125559999"
}
```

## Going to Production

- **Authentication** — add API key or token validation on the endpoint
- **Rate limiting** — protect the endpoint from abuse on top of Telnyx's own limits
- **Monitoring** — add structured logging and alerts around send failures
- **Delivery status** — subscribe to webhook events to track final delivery state ([docs](https://developers.telnyx.com/docs/messaging))

## Run

```bash
bundle install
ruby app.rb
```

## Resources

- [Source code and reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-ruby/README.md)
- [Typed API reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-ruby/API.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Messaging quickstart](https://developers.telnyx.com/docs/messaging)
- [Ruby SDK](https://developers.telnyx.com/development/sdk/ruby)
- [Telnyx Portal](https://portal.telnyx.com)
