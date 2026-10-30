# DineNyx — WhatsApp Restaurant Reservations (Node.js)

AI-powered restaurant reservations via WhatsApp, built with Node.js/Express for deployment on [Telnyx Edge Compute](https://telnyx.com/products/edge-compute).

Browse real restaurants worldwide, book a table through a WhatsApp conversation with an AI agent, and watch reservations update on a live dashboard in real time.

## Features

- **WhatsApp AI Agent** — Natural language booking via Telnyx WhatsApp Business API + AI Inference
- **Real Restaurant Data** — Google Places API with fallback seed data for 4 Dutch cities
- **Live Dashboard** — SSE-powered 3-panel UI: restaurant browser, phone simulator, reservation board
- **Edge-Ready** — Deploys globally on Telnyx Edge Compute for low-latency hosting
- **Voice Notes** — Transcribes WhatsApp audio messages using Telnyx AI

## Architecture

```
server.js          Express entrypoint: routes, SSE, webhook, startup
settings.js        Edge detection, DINENYX_ prefix for secrets
db.js              Dual-engine database (local SQLite / Edge SQL REST API)
ai.js              AI inference loop, tool definitions, tool executor
whatsapp.js        WhatsApp messaging + audio transcription
restaurants.js     Google Places API, fallback seed data, DB caching
public/            Static dashboard (HTML + CSS + JS)
```

## Prerequisites

- **Node.js 22+** (uses `node:sqlite`, `process.loadEnvFile()`)
- **Telnyx account** with API key ([portal.telnyx.com](https://portal.telnyx.com))
- **Telnyx WABA account** with WhatsApp-enabled number
- **Google Places API key** (optional — falls back to seed data)

## Quick Start

```bash
# Clone and enter the project
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/whatsapp-restaurant-reservation-nodejs

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Run locally
npm start
# Dashboard: http://localhost:3000
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TELNYX_API_KEY` | Yes | Main Telnyx API key (AI Inference) |
| `TELNYX_WHATSAPP_API_KEY` | Yes | WABA-enabled Telnyx API key |
| `WHATSAPP_NUMBER` | Yes | Your WhatsApp business number (E.164) |
| `WHATSAPP_MESSAGING_PROFILE_ID` | Yes | Messaging profile ID from Telnyx Portal |
| `AI_MODEL` | No | AI model (default: `zai-org/GLM-5.3-Flash`) |
| `GOOGLE_PLACES_API_KEY` | No | Google Places API key for live restaurant data |
| `DEFAULT_CITY` | No | Default city (default: `Amsterdam`) |
| `PORT` | No | Server port (default: `3000`) |
| `SQLDB_ID` | No | Telnyx Edge SQL database ID (Edge deployment only) |

## Webhook Setup

1. In the [Telnyx Portal](https://portal.telnyx.com), go to your Messaging Profile
2. Set the webhook URL to `https://your-domain.com/webhooks/whatsapp`
3. For local development, use [ngrok](https://ngrok.com): `ngrok http 3000`

## Deploy on Telnyx Edge

Telnyx Edge Compute runs your app on carrier-edge nodes worldwide for global low-latency hosting.

```bash
# 1. Create an Edge SQL database
telnyx-edge sql create --name dinenyx-db
# Note the database ID

# 2. Set secrets (prefixed with DINENYX_)
telnyx-edge secrets set DINENYX_TELNYX_API_KEY=KEYyour-key
telnyx-edge secrets set DINENYX_TELNYX_WHATSAPP_API_KEY=KEYyour-wa-key
telnyx-edge secrets set DINENYX_WHATSAPP_NUMBER=+1XXXXXXXXXX
telnyx-edge secrets set DINENYX_WHATSAPP_MESSAGING_PROFILE_ID=your-profile
telnyx-edge secrets set DINENYX_SQLDB_ID=your-db-id
telnyx-edge secrets set DINENYX_GOOGLE_PLACES_API_KEY=your-google-key

# 3. Create the Edge function
telnyx-edge create --name dinenyx
# Note the function ID

# 4. Configure func.toml
cp edge/func.toml.example edge/func.toml
# Edit edge/func.toml with your function ID

# 5. Build and ship
npm run edge:ship
```

Your app will be available at `https://dinenyx-*.telnyxcompute.com`. Update the webhook URL in the Telnyx Portal to point to this URL.

## Testing

```bash
npm test
```

Runs smoke tests using Node.js built-in test runner. All HTTP calls are mocked — no real credentials needed.

## How It Works

1. **Customer sends a WhatsApp message** → Telnyx webhook delivers it to `/webhooks/whatsapp`
2. **Server extracts text** (or transcribes voice notes) and feeds it to the AI inference loop
3. **AI agent uses tools** to search restaurants, check availability, and make reservations
4. **Agent sends response** back via WhatsApp using Telnyx Messaging API
5. **Dashboard updates in real time** via Server-Sent Events (SSE)

## Database

Locally, the app uses SQLite via `node:sqlite` (Node 22+). On Edge, it uses the Telnyx Edge SQL REST API — no storage binding needed, so the function deploys to every Edge site globally.

Three tables: `restaurants`, `reservations`, `conversations`. Reservation IDs are UUIDs (portable across local and Edge SQL).

## License

MIT
