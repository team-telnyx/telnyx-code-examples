# Failover Routing with Ruby and Sinatra

Build a production-ready SIP failover routing system using Ruby and Sinatra that intelligently routes inbound calls across multiple SIP endpoints.

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
  │  Telnyx SIP Trunking│  processes and responds
  └────────────────────┘
```

## Telnyx Products Used

- **SIP Trunking** — [Documentation](https://developers.telnyx.com/docs/sip-trunking)

## Prerequisites

- Ruby 2.7 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- At least one Telnyx phone number enabled for inbound calls.
- Two or more SIP endpoints (PBX, SBC, or softphone) with valid credentials.
- Bundler (Ruby dependency manager).
- A publicly accessible URL for webhook callbacks (ngrok recommended for local development).

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-failover-routing-ruby
cp .env.example .env
bundle install
```

Edit `.env` with your Telnyx credentials:

| Variable | Description |
|----------|-------------|
| `TELNYX_API_KEY` | KEY_your_telnyx_api_key_here |
| `BACKUP_SIP_ENDPOINT` | your_backup_sip_endpoint_here |
| `PRIMARY_SIP_ENDPOINT` | your_primary_sip_endpoint_here |

## Step 2: Understand the Code

The main application logic lives in `app.rb`.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/sip/connections` | API endpoint |
| `GET` | `/sip/connections` | API endpoint |
| `GET` | `/sip/connections/:id` | API endpoint |
| `POST` | `/sip/phone-assignments` | API endpoint |
| `GET` | `/sip/failover-status` | API endpoint |
| `POST` | `/webhooks/call` | Webhook handler |
| `GET` | `/` | API endpoint |

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
curl http://localhost:5000/sip/connections
```

## Going to Production

- **Environment variables** — never commit API keys; use a secrets manager.
- **Authentication** — protect your endpoints with API key validation.
- **Monitoring** — add structured logging and alerting.
- **Rate limiting** — protect endpoints from abuse.
- **Database** — replace any in-memory storage with a persistent store.

## Resources

- [Source code](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-failover-routing-ruby/README.md)
- [API reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-failover-routing-ruby/API.md)
- [SIP Trunking Documentation](https://developers.telnyx.com/docs/sip-trunking)
- [Telnyx Portal](https://portal.telnyx.com)
