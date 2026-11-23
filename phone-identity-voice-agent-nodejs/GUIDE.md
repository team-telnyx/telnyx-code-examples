# Phone Identity Intelligence with Node.js and Express

Build a Voice AI agent that identifies callers in real time using the Telnyx Number Lookup API, scores their trustworthiness, and adapts its AI-powered conversation accordingly.

## How It Works

```
Caller dials Telnyx number
    │
    ▼
call.initiated webhook arrives
    │
    ├─ Number Lookup API → carrier, CNAM, identity confidence
    ├─ Risk engine → trust score 0-100
    ├─ SSE push → dashboard shows identity card
    ├─ Answer call
    │
    ▼
call.answered webhook arrives
    │
    ├─ Build dynamic variables from identity data
    ├─ POST /v2/calls/{id}/actions/start_ai_assistant
    │   └─ assistant_id + dynamic_variables
    │       ├─ caller_context: "Verified customer: Sarah Johnson..."
    │       ├─ behavior_instructions: "Greet by name, skip verification..."
    │       └─ greeting_text: "Hello Sarah! Welcome back..."
    │
    ▼
AI Assistant speaks personalized greeting
```

**Two demo scenarios:**

1. **Trusted caller** (score >= 70) — high confidence, real name, mobile line type → greeted by name, verification skipped
2. **Suspicious caller** (score < 40) — no CNAM, VoIP line, low confidence → formal greeting, mandatory verification

## Telnyx Products Used

- **[Number Lookup](https://developers.telnyx.com/docs/number-lookup/number-lookup-guide)** — `GET /v2/number_lookup/{phone}` returns carrier data, CNAM, and caller identity with confidence scoring
- **[Call Control](https://developers.telnyx.com/docs/voice/call-control)** — answer inbound calls and manage call flow via webhook events
- **[AI Assistants](https://developers.telnyx.com/docs/voice/ai-assistants)** — voice agents with template variables (`{{caller_context}}`) that accept dynamic values per call
- **[Voice API](https://developers.telnyx.com/docs/voice)** — inbound call handling with real-time webhook events

## Prerequisites

- Node.js 22+
- Telnyx account with API key
- A Telnyx phone number with voice capability
- An AI Assistant created via the Telnyx API or Portal
- A Call Control Application pointing to your webhook URL
- [ngrok](https://ngrok.com) for local webhook testing

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/phone-identity-voice-agent-nodejs
npm install
cp .env.example .env
```

Edit `.env` with your credentials:

| Variable | Description |
|----------|-------------|
| `TELNYX_API_KEY` | Your Telnyx API key (starts with `KEY`) |
| `TELNYX_PUBLIC_KEY` | Public key for webhook signature verification |
| `TELNYX_PHONE_NUMBER` | Your Telnyx phone number in E.164 format |
| `TELNYX_ASSISTANT_ID` | AI Assistant ID (starts with `ast_`) |
| `TELNYX_CALL_CONTROL_APP_ID` | Call Control Application ID |

## Step 2: Provision Telnyx Resources

### Create a Call Control Application

```bash
curl -X POST https://api.telnyx.com/v2/call_control_applications \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "application_name": "Phone Identity Intelligence Demo",
    "webhook_event_url": "https://YOUR-NGROK.ngrok.app/webhooks/call-events",
    "active": true
  }'
```

### Create an AI Assistant

The AI Assistant uses template variables (`{{caller_context}}`, `{{behavior_instructions}}`, `{{greeting_text}}`) that are filled dynamically per call:

```bash
curl -X POST https://api.telnyx.com/v2/ai/assistants \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Apex Bank Phone Identity Agent",
    "model": "meta-llama/Llama-3.3-70B-Instruct",
    "instructions": "You are the AI phone assistant for Apex Bank, a major retail bank. Keep responses natural, concise (2-3 sentences), and professional. No markdown. Speak as if on a phone call.\n\nCALLER IDENTITY:\n{{caller_context}}\n\nGREETING & BEHAVIOR:\n{{behavior_instructions}}",
    "enabled_features": ["telephony"],
    "greeting": "{{greeting_text}}",
    "voice_settings": { "voice_id": "Telnyx.Natural.abbie" }
  }'
```

### Assign the phone number

```bash
curl -X PATCH "https://api.telnyx.com/v2/phone_numbers/<phone_number_id>" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"connection_id": "<call_control_app_id>"}'
```

## Step 3: Understand the Code

### Number Lookup + Risk Assessment (lookup.js)

The lookup module calls `GET /v2/number_lookup/{phone}?type=carrier&type=caller-name` and builds a trust score:

| Signal | Score impact |
|--------|-------------|
| High identity confidence (80+) | No deduction |
| Moderate confidence (60-79) | -25 |
| Low/no confidence (<60) | -40 |
| No caller name (CNAM) | -15 |
| VoIP line type | -20 |
| Ported number | -10 |
| No postal address | -10 |

Starting score is 100. Result levels: **trusted** (>= 70), **standard** (40-69), **suspicious** (< 40).

Results are cached in memory for 24 hours to avoid redundant API calls.

### Dynamic Variables (lookup.js)

Based on the trust level, the app builds three strings injected into the AI Assistant:

- `caller_context` — identity summary the AI reads as context
- `behavior_instructions` — how the AI should behave (skip verification vs. enforce it)
- `greeting_text` — the AI's opening line

### Webhook Handler (server.js)

The server handles three key Call Control events:

1. **`call.initiated`** — runs Number Lookup, assesses risk, pushes SSE events, answers the call
2. **`call.answered`** — calls `start_ai_assistant` with dynamic variables
3. **`call.hangup`** — marks call ended on the dashboard

### Dashboard (public/)

The dashboard connects via SSE to `/stream` and renders:
- An identity card with stagger-fill animations during lookup
- A trust score meter that animates from 0 to the final score
- Risk factor pills (green for positive signals, red for negative)
- A call timeline with colored event dots

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/webhooks/call-events` | Call Control webhooks |
| `GET` | `/stream` | SSE event stream |
| `GET` | `/api/state` | Current call state |
| `POST` | `/api/reset` | Reset state |
| `GET` | `/lookup/:phone` | Manual lookup |
| `GET` | `/health` | Health check |

## Step 4: Run It

```bash
# Start the app
npm start

# In another terminal, expose webhooks
ngrok http 3000

# Update your Call Control App webhook URL to the ngrok URL
curl -X PATCH "https://api.telnyx.com/v2/call_control_applications/$TELNYX_CALL_CONTROL_APP_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"webhook_event_url\": \"https://YOUR-NGROK.ngrok.app/webhooks/call-events\"}"
```

Open `http://localhost:3000` in your browser to see the dashboard.

## Step 5: Test It

### Manual lookup (no call needed)

```bash
curl http://localhost:3000/lookup/+15125551234 | jq
```

### Live call test

1. Open the dashboard at `http://localhost:3000`
2. Call the Telnyx phone number from your mobile
3. Watch the dashboard fill with identity data in real time
4. Listen to the AI Assistant's greeting — it adapts based on your caller identity

### Smoke tests

```bash
npm test
```

## Going to Production

- **Webhook signature verification** — always set `TELNYX_PUBLIC_KEY` in production to verify Ed25519 signatures
- **Persistent cache** — replace the in-memory lookup cache with Redis for multi-instance deployments
- **Logging** — add structured logging (e.g. Pino) for call event tracing
- **Edge deployment** — use `npm run edge:build` and `npm run edge:ship` to deploy on Telnyx Edge Compute for lowest latency
- **Monitoring** — track lookup latency, AI Assistant connection rate, and trust score distribution

## Resources

- [Source code](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/phone-identity-voice-agent-nodejs/server.js)
- [API reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/phone-identity-voice-agent-nodejs/API.md)
- [Number Lookup guide](https://developers.telnyx.com/docs/number-lookup/number-lookup-guide)
- [Number Lookup API reference](https://developers.telnyx.com/api-reference/number-lookup)
- [Call Control guide](https://developers.telnyx.com/docs/voice/call-control)
- [AI Assistants guide](https://developers.telnyx.com/docs/voice/ai-assistants)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/nodejs)
