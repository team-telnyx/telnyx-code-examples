---
name: nomad-gateway
title: "Nomad Gateway — SMS/Voice to Offline AI + Wikipedia"
description: "Text or call a phone number, get answers from AI + Wikipedia. When the internet goes down, a local AI takes over. The user never knows the difference."
language: nodejs
framework: express
telnyx_products: [SMS API, Voice API, AI Inference, STT, TTS, Embeddings API, Edge Compute, Edge SQL, Object Storage, IoT SIM, Number Lookup]
channel: [sms, voice]
---

# Nomad Gateway — SMS/Voice to Offline AI + Wikipedia

Text or call a Telnyx phone number, get answers from AI + Wikipedia. When the
internet goes down, a local NOMAD server (Ollama + Kiwix) takes over. The user
never knows the difference.

Built with Node.js/Express on Telnyx AI Communications Infrastructure and
deployed on Telnyx Edge Compute.

Inspired by [Project NOMAD](https://www.projectnomad.us/) — an open-source
offline knowledge server.

## Features

- **SMS + Voice** — same phone number handles text messages and phone calls
- **Two-tier AI** — Telnyx AI Inference (online) with Ollama fallback (offline)
- **Wikipedia knowledge base** — Kiwix serves Wikipedia offline, Telnyx Embeddings enable semantic search
- **Voice calls** — Telnyx STT transcribes questions, TTS speaks answers back
- **Automatic failover** — health checker detects internet loss, switches to local AI within seconds
- **Real-time dashboard** — 3-panel view: query log, system status, knowledge base
- **Edge deployable** — runs on Telnyx Edge Compute with Edge SQL for global distribution
- **IoT SIM backup** — cellular fallback keeps the local server connected

## Architecture

```
                    ┌──────────────────────────────┐
                    │      Telnyx Platform          │
                    │                               │
  SMS ─────────────►│  SMS API ──► Webhook ──────┐  │
                    │                             │  │
  Voice Call ──────►│  Voice API ──► Webhook ──┐  │  │
                    │                          │  │  │
                    │  AI Inference ◄───────────┼──┼──┼── Online mode
                    │  Embeddings API           │  │  │
                    │  Edge Compute             │  │  │
                    │  Edge SQL                 │  │  │
                    └───────────────────────────┼──┼──┘
                                                │  │
                    ┌───────────────────────────┼──┼──┐
                    │      Nomad Gateway        ▼  ▼  │
                    │                                  │
                    │  server.js ─── ai.js ────────┐   │
                    │       │        │    │         │   │
                    │       │   knowledge.js   voice.js │
                    │       │        │                  │
                    │  messaging.js  │                  │
                    │       │        ▼                  │
                    │       │   ┌─────────┐            │
                    │       │   │  Kiwix   │ Wikipedia  │
                    │       │   └─────────┘            │
                    │       │        │                  │
                    │       ▼        ▼                  │
                    │   ┌──────┐ ┌────────┐            │
                    │   │ Ollama│ │  Maps  │ Offline    │
                    │   └──────┘ └────────┘  mode      │
                    └──────────────────────────────────┘
```

```
server.js          Express entrypoint: routes, SSE, webhooks, health checker
settings.js        Edge detection, NOMAD_ prefix for secrets
db.js              Dual-engine database (local SQLite / Edge SQL REST API)
ai.js              Two-tier AI inference loop, tool definitions, tool executor
messaging.js       SMS send/receive via Telnyx SMS API
knowledge.js       Kiwix search, Telnyx Embeddings, OpenStreetMap, health probes
voice.js           Inbound voice call handling (STT → AI → TTS loop)
public/            Real-time dashboard (HTML + CSS + JS)
scripts/           Edge build, seed knowledge base
```

## Prerequisites

- **Node.js 22+** (uses `node:sqlite`, `node:test`, `process.loadEnvFile`)
- **Telnyx account** with API key ([portal.telnyx.com](https://portal.telnyx.com))
- **Phone number** with SMS + Voice enabled
- **SMS Messaging Profile** with webhook URL configured
- **Voice Connection** (Call Control v2) with webhook URL configured

### Optional (for offline mode)

- **Kiwix** — `docker run -p 8080:8080 kiwix/kiwix-serve /data/wikipedia_en_simple_all.zim`
- **Ollama** — `ollama serve` with a model like `llama3.2`

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/nomad-gateway-nodejs
npm install
cp .env.example .env
# Edit .env with your API keys and phone number
npm start
# Dashboard: http://localhost:3000
```

### Expose webhooks (local dev)

```bash
ngrok http 3000
# Set webhook URLs in Telnyx Portal:
#   SMS:   https://YOUR-NGROK.ngrok.io/webhooks/sms
#   Voice: https://YOUR-NGROK.ngrok.io/webhooks/voice
```

### Seed the knowledge base (optional)

```bash
# Start Kiwix with Simple English Wikipedia first
npm run seed
```

### Test it

```bash
# Text the phone number
curl -X POST http://localhost:3000/webhooks/sms \
  -H "Content-Type: application/json" \
  -d '{"data":{"event_type":"message.received","payload":{"direction":"inbound","from":{"phone_number":"+14155551234"},"text":"What is photosynthesis?","id":"test-1"}}}'

# Run smoke tests
npm test
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELNYX_API_KEY` | Yes | Telnyx API key |
| `PHONE_NUMBER` | Yes | Telnyx phone number (E.164) |
| `SMS_MESSAGING_PROFILE_ID` | Yes | SMS messaging profile ID |
| `VOICE_CONNECTION_ID` | No | Voice connection ID (Call Control v2) |
| `AI_MODEL` | No | Telnyx AI model (default: `meta-llama/Llama-3.3-70B-Instruct`) |
| `KIWIX_HOST` | No | Kiwix server URL (e.g., `http://localhost:8080`) |
| `OLLAMA_HOST` | No | Ollama server URL (e.g., `http://localhost:11434`) |
| `OLLAMA_MODEL` | No | Ollama model name (default: `llama3.2`) |
| `MAPS_HOST` | No | Nominatim URL (default: public OSM instance) |
| `PORT` | No | Server port (default: `3000`) |
| `SQLDB_ID` | No | Edge SQL database ID (Edge deployment only) |

## Webhook Setup

### SMS Webhook

1. Go to [Telnyx Portal → Messaging](https://portal.telnyx.com/#/app/messaging)
2. Create or edit your Messaging Profile
3. Set inbound webhook URL: `https://YOUR-DOMAIN/webhooks/sms`
4. Assign your phone number to this profile

### Voice Webhook

1. Go to [Telnyx Portal → Voice](https://portal.telnyx.com/#/app/call-control/applications)
2. Create a Call Control application
3. Set webhook URL: `https://YOUR-DOMAIN/webhooks/voice`
4. Assign your phone number to this connection

## Deploy on Telnyx Edge Compute

```bash
# Create Edge SQL database
telnyx-edge sql create --name nomad-gateway-db

# Set secrets (use NOMAD_ prefix on Edge)
telnyx-edge secrets set NOMAD_TELNYX_API_KEY=KEY...
telnyx-edge secrets set NOMAD_PHONE_NUMBER=+1...
telnyx-edge secrets set NOMAD_SMS_MESSAGING_PROFILE_ID=...
telnyx-edge secrets set NOMAD_VOICE_CONNECTION_ID=...
telnyx-edge secrets set NOMAD_SQLDB_ID=your-db-id

# Optional: local NOMAD server via IoT SIM
telnyx-edge secrets set NOMAD_KIWIX_HOST=http://...
telnyx-edge secrets set NOMAD_OLLAMA_HOST=http://...
telnyx-edge secrets set NOMAD_OLLAMA_MODEL=llama3.2

# Copy func.toml and set your function ID
cp edge/func.toml.example edge/func.toml

# Build and deploy
npm run edge:ship

# Update webhook URLs in Telnyx Portal to your Edge URL
```

## Testing

```bash
npm test
```

Tests cover: health endpoint, config, SSE streaming, SMS webhook (inbound, ignored, empty), voice webhook (call events, ignored), dashboard serving, query log API, system status API.

## How It Works

### Two-Tier Inference

1. User texts or calls the Telnyx phone number
2. Gateway receives the message via webhook
3. **Online mode**: Telnyx AI Inference processes the question with tool-calling (search Wikipedia, maps, check status)
4. **Offline mode**: If Telnyx AI is unreachable (internet down), Ollama processes the question locally
5. Answer is sent back via SMS or spoken via TTS

### Automatic Failover

Every 30 seconds, the health checker pings:
- **Internet** — Telnyx API health endpoint
- **Kiwix** — local Wikipedia server
- **Ollama** — local AI server
- **Maps** — internet-dependent (follows internet status)

When internet drops, the next query automatically routes to Ollama. The dashboard updates in real time via SSE.

### Knowledge Pipeline

1. `npm run seed` fetches popular Wikipedia articles from Kiwix
2. Articles are chunked into ~1000-character pieces
3. Each chunk is embedded via Telnyx Embeddings API (`nomic-embed-text-v1.5`)
4. Chunks + embeddings stored in the `knowledge_chunks` table
5. At query time: embed the question, cosine-similarity search, top 3 chunks feed into the AI prompt

## Why Telnyx

Nomad Gateway uses **11 Telnyx products** from a single API key:

| Product | Role |
|---------|------|
| SMS API | Primary text channel — works on 2G, any phone |
| Voice API | Inbound calls with call control |
| AI Inference | Cloud LLM for online mode |
| Speech-to-Text | Transcribe caller's voice |
| Text-to-Speech | Speak AI answers back |
| Embeddings API | Vectorize knowledge for semantic search |
| Edge Compute | Global deployment at carrier edge |
| Edge SQL | Knowledge index + conversation state |
| Object Storage | Store Wikipedia ZIM files |
| IoT SIM | Cellular backup for local server |
| Number Lookup | Validate phone numbers |

One platform. One API key. No Frankenstack.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| SMS not received | Check messaging profile webhook URL, verify number is assigned |
| Voice call not connecting | Check voice connection webhook URL, verify number is assigned |
| Ollama fallback not working | Ensure `OLLAMA_HOST` is set and Ollama is running with a model |
| Knowledge search empty | Run `npm run seed` with Kiwix running |
| Edge deploy fails | Check `NOMAD_SQLDB_ID` is set, verify API key has Edge access |
| Dashboard not updating | Check browser console for SSE errors, verify `/stream` endpoint |

## Related Examples

- [WhatsApp Restaurant Reservation (Node.js)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/whatsapp-restaurant-reservation-nodejs)
- [AI Language Learning Phone Tutor (Python)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/ai-language-learning-phone-tutor-python)
- [Conversation Relay Voice Bot (Python)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/conversation-relay-voice-bot-python)
- [Edge MCP Server Deploy (Python)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/edge-mcp-server-deploy-python)
- [Gateway Fallbacks](https://github.com/team-telnyx/telnyx-code-examples/tree/main/gateway-fallbacks)
- [AI Video Dubbing Pipeline (Python)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/ai-video-dubbing-pipeline-python)

## Agent Discovery

This example demonstrates resilient AI communications infrastructure that works
without internet connectivity. The same phone number handles both SMS and voice
calls, with automatic failover between cloud AI (Telnyx) and local AI (Ollama).
Built for disaster response, remote areas, and any scenario where reliable
communication matters more than bandwidth.
