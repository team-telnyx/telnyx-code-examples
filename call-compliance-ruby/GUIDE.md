# Call Compliance with Ruby and Sinatra

Build a production-ready Sinatra application that enforces call compliance by recording all inbound and outbound calls, logging call metadata, and storing recordings for audit purposes.

## How It Works

```
  Client request
        │
        ▼
  ┌────────────────────┐
  │  Ruby Server        │  receives request
  └─────────┬──────────┘
        │  Telnyx API call
        ▼
  ┌────────────────────┐
  │  Telnyx Voice API │  processes and responds
  └────────────────────┘
```

## Telnyx Products Used

- **Voice API** — [Documentation](https://developers.telnyx.com/docs/voice)

## Prerequisites

- Ruby 2.7 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for inbound and outbound calls.
- A Call Control Application configured in the Telnyx Portal (note the Connection ID).
- A publicly accessible webhook URL (use ngrok for local development).
- Bundler (Ruby dependency manager).

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-compliance-ruby
cp .env.example .env
bundle install
```

Edit `.env` with your Telnyx credentials:

| Variable | Description |
|----------|-------------|
| `TELNYX_API_KEY` | KEY_your_telnyx_api_key_here |
| `TELNYX_CONNECTION_ID` | your_connection_id_here |
| `TELNYX_PHONE_NUMBER` | +15551234567 |

## Step 2: Understand the Code

The main application logic lives in `app.rb`.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/webhooks/call-initiated` | Webhook handler |
| `POST` | `/webhooks/call-answered` | Webhook handler |
| `POST` | `/webhooks/call-hangup` | Webhook handler |
| `POST` | `/webhooks/call-recording-saved` | Webhook handler |
| `POST` | `/calls/initiate` | API endpoint |
| `GET` | `/calls/:call_control_id/metadata` | API endpoint |
| `GET` | `/calls/audit/list` | API endpoint |

## Step 3: Run It

```bash
ruby app.rb
```

The server starts on `http://localhost:5000`.

For webhook-based features, expose your local server:

```bash
ngrok http 5000
```

## Step 4: Test It

```bash
curl http://localhost:5000/calls/:call_control_id/metadata
```

## Going to Production

- **Environment variables** — never commit API keys; use a secrets manager.
- **Authentication** — protect your endpoints with API key validation.
- **Monitoring** — add structured logging and alerting.
- **Rate limiting** — protect endpoints from abuse.
- **Database** — replace any in-memory storage with a persistent store.

## Resources

- [Source code](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-compliance-ruby/README.md)
- [API reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-compliance-ruby/API.md)
- [Voice API Documentation](https://developers.telnyx.com/docs/voice)
- [Telnyx Portal](https://portal.telnyx.com)
