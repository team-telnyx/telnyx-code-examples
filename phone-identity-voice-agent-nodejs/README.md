---
name: phone-identity-voice-agent
title: "Phone Identity Intelligence — Voice AI Agent"
description: "Inbound call triggers Number Lookup for caller identity, risk scoring, and a live dashboard, then an AI Assistant greets the caller based on trust level."
language: nodejs
framework: express
telnyx_products: [Number Lookup, Call Control, AI Assistants, Voice API]
channel: [voice]
---

# Phone Identity Intelligence — Voice AI Agent (Node.js)

A caller dials a Telnyx number. The app performs a Number Lookup to reveal the caller's identity on a live dashboard, then an AI Assistant answers — adapting its greeting and security posture based on trust signals.

Built with Node.js/Express on Telnyx **AI Communications Infrastructure**.

## Features

- **Real-time caller identification** — Number Lookup returns carrier, CNAM, line type, and identity confidence before the call is answered
- **Trust scoring** — Automated risk assessment (0-100) based on identity signals: confidence score, CNAM, line type, ported status, address
- **Adaptive AI greetings** — AI Assistant personalizes behavior: trusted callers skip verification, suspicious callers face mandatory checks
- **Live dashboard** — SSE-powered identity card with stagger-fill animations, trust meter, and call timeline
- **Edge-deployable** — Runs locally or on Telnyx Edge Compute with zero code changes

## Why Telnyx

This example combines **4 Telnyx products** from a single API key to build a caller identity intelligence pipeline:

| Product | Role |
|---------|------|
| [Number Lookup](https://telnyx.com/products/phone-number-lookup) | Carrier, CNAM, and caller identity data for inbound numbers |
| [Call Control](https://telnyx.com/products/call-control) | Answer inbound calls and route to AI Assistant |
| [AI Assistants](https://telnyx.com/products/voice-ai-agents) | Voice agent with dynamic variables for personalized greetings |
| [Voice API](https://telnyx.com/products/voice-api) | Inbound call handling with webhook events |

One platform. One API key. Identity intelligence to AI conversation in under a second.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v2/number_lookup/{phone}` | GET | Carrier, CNAM, and caller identity lookup |
| `/v2/calls/{id}/actions/answer` | POST | Answer an inbound call |
| `/v2/calls/{id}/actions/start_ai_assistant` | POST | Launch AI Assistant with dynamic variables |
| `/v2/call_control_applications` | POST | Create webhook routing for inbound calls |
| `/v2/ai/assistants` | POST | Create AI Assistant with template variables |

## Architecture

```
Caller dials number
    │
    ▼
Telnyx → POST /webhooks/call-events  (call.initiated)
    │
    ├─ 1. Number Lookup API (carrier + caller-name)
    ├─ 2. Risk assessment → trust score 0-100
    ├─ 3. SSE events → dashboard fills identity card
    ├─ 4. Answer call
    │
    ▼
call.answered webhook
    │
    ├─ 5. POST /v2/calls/{ccid}/actions/start_ai_assistant
    │      with assistant ID + dynamic_variables (caller context)
    ├─ 6. AI Assistant speaks personalized greeting
    └─ 7. SSE → dashboard shows "AI Connected"
```

### Code structure

```
phone-identity-voice-agent-nodejs/
├── server.js          # Express: routes, SSE, webhooks, AI Assistant launch
├── settings.js        # Edge detection (PHONEID_ prefix)
├── lookup.js          # Number Lookup API + cache + risk assessment
├── public/
│   ├── index.html     # Dashboard SPA
│   ├── style.css      # Dark theme
│   └── dashboard.js   # SSE handlers + animations
├── edge/
│   └── func.toml.example
├── scripts/
│   └── edge-build.js  # Build script for Edge deployment
├── test/
│   └── smoke.test.js
├── package.json
└── .env.example
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELNYX_API_KEY` | Yes | Telnyx API key |
| `TELNYX_PUBLIC_KEY` | No | Telnyx public key for webhook signature verification |
| `TELNYX_PHONE_NUMBER` | Yes | Telnyx phone number for inbound calls (E.164) |
| `TELNYX_ASSISTANT_ID` | Yes | AI Assistant ID (created via API or Portal) |
| `TELNYX_CALL_CONTROL_APP_ID` | Yes | Call Control Application ID |
| `HOST` | No | Bind address (default: `0.0.0.0`) |
| `PORT` | No | Listen port (default: `3000`) |

> **Agent / CLI access** — provision resources with the Telnyx CLI:
> ```bash
> # Buy a phone number
> telnyx number-orders create --phone-number "+1XXXXXXXXXX"
>
> # Create a Call Control Application
> telnyx call-control-applications create \
>   --application-name "Phone Identity Intelligence Demo" \
>   --webhook-event-url "https://YOUR-DOMAIN/webhooks/call-events"
>
> # Assign number to the application
> telnyx phone-numbers update <phone_number_id> \
>   --connection-id <call_control_app_id>
> ```

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/phone-identity-voice-agent-nodejs
npm install
cp .env.example .env
# Edit .env with your API key, phone number, and assistant ID
npm start
# Dashboard: http://localhost:3000
```

<details><summary>Programmatic / CLI setup</summary>

```bash
# 1. Create Call Control Application
curl -s -X POST https://api.telnyx.com/v2/call_control_applications \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "application_name": "Phone Identity Intelligence Demo",
    "webhook_event_url": "https://YOUR-NGROK.ngrok.app/webhooks/call-events",
    "active": true
  }' | jq '.data.id'
# → Save as TELNYX_CALL_CONTROL_APP_ID

# 2. Create AI Assistant
curl -s -X POST https://api.telnyx.com/v2/ai/assistants \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Apex Bank Phone Identity Agent",
    "model": "meta-llama/Llama-3.3-70B-Instruct",
    "instructions": "You are the AI phone assistant for Apex Bank, a major retail bank. Keep responses natural, concise (2-3 sentences), and professional. No markdown. Speak as if on a phone call.\n\nCALLER IDENTITY:\n{{caller_context}}\n\nGREETING & BEHAVIOR:\n{{behavior_instructions}}",
    "enabled_features": ["telephony"],
    "greeting": "{{greeting_text}}",
    "voice_settings": { "voice_id": "Telnyx.Natural.abbie" }
  }' | jq '.data.id'
# → Save as TELNYX_ASSISTANT_ID

# 3. Search for a phone number
curl -s "https://api.telnyx.com/v2/available_phone_numbers?filter[country_code]=US&filter[features][]=voice" \
  -H "Authorization: Bearer $TELNYX_API_KEY" | jq '.data[0].phone_number'

# 4. Order the phone number
curl -s -X POST https://api.telnyx.com/v2/number_orders \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"phone_numbers": [{"phone_number": "+1XXXXXXXXXX"}]}'

# 5. Assign number to Call Control App
curl -s -X PATCH "https://api.telnyx.com/v2/phone_numbers/<phone_number_id>" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"connection_id": "<call_control_app_id>"}'
```

</details>

### Expose webhooks (local dev)

```bash
ngrok http 3000
# Update Call Control App webhook URL:
curl -s -X PATCH "https://api.telnyx.com/v2/call_control_applications/$TELNYX_CALL_CONTROL_APP_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"webhook_event_url\": \"https://YOUR-NGROK.ngrok.app/webhooks/call-events\"}"
```

### Test it

```bash
# Manual Number Lookup
curl http://localhost:3000/lookup/+15125551234

# Health check
curl http://localhost:3000/health

# Run smoke tests
npm test
```

## API Reference

See [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/phone-identity-voice-agent-nodejs/API.md) for full endpoint documentation.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/webhooks/call-events` | Call Control webhooks (call.initiated, call.answered, call.hangup) |
| GET | `/stream` | SSE event stream for dashboard |
| GET | `/api/state` | Current call state snapshot |
| POST | `/api/reset` | Clear state (for re-recording demo) |
| GET | `/lookup/:phone` | Manual Number Lookup (testing) |
| GET | `/health` | Readiness probe |
| GET | `/` | Dashboard (static from public/) |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| No call events received | Verify webhook URL on Call Control App matches your ngrok URL |
| "TELNYX_ASSISTANT_ID not configured" | Set the assistant ID in `.env` — create one via the API or Portal |
| Number Lookup returns empty data | Confirm API key has Number Lookup permissions; some numbers have limited CNAM data |
| Dashboard not updating | Check browser console for SSE connection errors; verify `/stream` endpoint returns `text/event-stream` |
| AI Assistant doesn't speak | Verify the assistant has `telephony` in `enabled_features` and a valid `voice_id` |
| Webhook signature fails | Set `TELNYX_PUBLIC_KEY` in `.env` from the Telnyx Portal (or remove it to disable verification in dev) |

## Deploy on Telnyx Edge Compute

```bash
# Build the Edge artifact
npm run edge:build

# Copy func.toml
cp edge/func.toml.example edge/func.toml
# Edit edge/func.toml with your function ID

# Set secrets (PHONEID_ prefix)
telnyx-edge secret set PHONEID_TELNYX_API_KEY=KEYxxx
telnyx-edge secret set PHONEID_TELNYX_PUBLIC_KEY=xxx
telnyx-edge secret set PHONEID_TELNYX_PHONE_NUMBER=+1xxx
telnyx-edge secret set PHONEID_TELNYX_ASSISTANT_ID=ast_xxx
telnyx-edge secret set PHONEID_TELNYX_CALL_CONTROL_APP_ID=xxx

# Ship
npm run edge:ship
```

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Related Examples

- [Phone Number Lookup (Node.js)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/phone-number-lookup-nodejs)
- [Number Lookup Fraud Screener (Python)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/number-lookup-fraud-screener-python)
- [AI Language Learning Phone Tutor (Python)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/ai-language-learning-phone-tutor-python)
- [Conversation Relay Voice Bot (Python)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/conversation-relay-voice-bot-python)
- [Warm Transfer (Python)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/warm-transfer-python)

## Resources

- [Number Lookup guide](https://developers.telnyx.com/docs/number-lookup/number-lookup-guide)
- [Number Lookup API reference](https://developers.telnyx.com/api-reference/number-lookup)
- [Call Control guide](https://developers.telnyx.com/docs/voice/call-control)
- [AI Assistants guide](https://developers.telnyx.com/docs/voice/ai-assistants)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/nodejs)
- [Voice AI Agents product page](https://telnyx.com/products/voice-ai-agents)
- [Number Lookup product page](https://telnyx.com/products/phone-number-lookup)
- [Number Lookup pricing](https://telnyx.com/pricing/number-lookup)
