# Failover Routing with Node.js and Express

Build a production-ready Express application that implements failover routing for SIP trunks using the Telnyx Node.js SDK.

## How It Works

```
  Client request
        │
        ▼
  ┌────────────────────┐
  │  Node.js Server     │  receives request
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

- Node.js 16 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- Two SIP endpoints (PBX, SBC, or softphone) for primary and backup routing.
- npm (Node.js package manager).
- A publicly accessible URL for webhook callbacks (ngrok or similar for local testing).

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-failover-routing-nodejs
cp .env.example .env
npm install
```

Edit `.env` with your Telnyx credentials:

| Variable | Description |
|----------|-------------|
| `TELNYX_API_KEY` | KEY_your_telnyx_api_key_here |
| `BACKUP_SIP_ENDPOINT` | your_backup_sip_endpoint_here |
| `PORT` | 5000 |
| `PRIMARY_SIP_ENDPOINT` | your_primary_sip_endpoint_here |
| `WEBHOOK_URL` | https://your-domain.com/webhook |

## Step 2: Understand the Code

The main application logic lives in `server.js`.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/sip/connections/setup` | API endpoint |
| `GET` | `/sip/connections` | API endpoint |
| `GET` | `/sip/failover/status` | API endpoint |
| `POST` | `/sip/failover/health-check` | API endpoint |
| `POST` | `/webhooks/sip` | Webhook handler |

## Step 3: Run It

```bash
node server.js
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

- [Source code](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-failover-routing-nodejs/README.md)
- [API reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-failover-routing-nodejs/API.md)
- [SIP Trunking Documentation](https://developers.telnyx.com/docs/sip-trunking)
- [Telnyx Portal](https://portal.telnyx.com)
