# CNAM Lookup with Node.js and Express

Build a production-ready Express endpoint that performs CNAM (Caller Name) lookups using the Telnyx API.

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

- Node.js 14 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- npm (Node Package Manager).
- A REST client like curl or Postman for testing.

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-cnam-lookup-nodejs
cp .env.example .env
npm install
```

Edit `.env` with your Telnyx credentials:

| Variable | Description |
|----------|-------------|
| `TELNYX_API_KEY` | KEY_your_telnyx_api_key_here |
| `PORT` | 5000 |

## Step 2: Understand the Code

The main application logic lives in `server.js`.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/cnam/lookup` | API endpoint |

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
curl -X POST http://localhost:5000/cnam/lookup \
  -H "Content-Type: application/json" \
  -d '{"to": "+15551234567"}'
```

## Going to Production

- **Environment variables** — never commit API keys; use a secrets manager.
- **Authentication** — protect your endpoints with API key validation.
- **Monitoring** — add structured logging and alerting.
- **Rate limiting** — protect endpoints from abuse.
- **Database** — replace any in-memory storage with a persistent store.

## Resources

- [Source code](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-cnam-lookup-nodejs/README.md)
- [API reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-cnam-lookup-nodejs/API.md)
- [SIP Trunking Documentation](https://developers.telnyx.com/docs/sip-trunking)
- [Telnyx Portal](https://portal.telnyx.com)
