# eSIM Provisioning with Ruby and Sinatra

Build a production-ready Sinatra application that provisions eSIM profiles over-the-air using the Telnyx IoT API.

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
  │  Telnyx IoT SIM Management│  processes and responds
  └────────────────────┘
```

## Telnyx Products Used

- **IoT SIM Management** — [Documentation](https://developers.telnyx.com/docs/iot)

## Prerequisites

- Ruby 2.7 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- Access to the Telnyx IoT / SIM Management API.
- Bundler (Ruby dependency manager).
- A publicly accessible URL for webhook callbacks (ngrok or similar for local development).
- An eSIM-capable device or simulator for testing.

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/provision-esim-ruby
cp .env.example .env
bundle install
```

Edit `.env` with your Telnyx credentials:

| Variable | Description |
|----------|-------------|
| `TELNYX_API_KEY` | KEY_your_telnyx_api_key_here |
| `WEBHOOK_URL` | https://your-domain.com/webhook |

## Step 2: Understand the Code

The main application logic lives in `app.rb`.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/esim/provision` | API endpoint |
| `POST` | `/esim/activate` | API endpoint |
| `GET` | `/esim/status/:profile_id` | API endpoint |
| `POST` | `/webhooks/esim` | Webhook handler |

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
curl http://localhost:5000/esim/status/:profile_id
```

## Going to Production

- **Environment variables** — never commit API keys; use a secrets manager.
- **Authentication** — protect your endpoints with API key validation.
- **Monitoring** — add structured logging and alerting.
- **Rate limiting** — protect endpoints from abuse.
- **Database** — replace any in-memory storage with a persistent store.

## Resources

- [Source code](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/provision-esim-ruby/README.md)
- [API reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/provision-esim-ruby/API.md)
- [IoT SIM Management Documentation](https://developers.telnyx.com/docs/iot)
- [Telnyx Portal](https://portal.telnyx.com)
