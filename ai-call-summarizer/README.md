---
name: ai-call-summarizer
title: "AI Call Summarizer — Post-Call SMS Summary & SQL Analytics"
description: "A Telnyx Edge Agent that detects call hangups, summarizes conversation history via OpenAI, texts the summary to the caller, and logs it to SQL for analytics."
language: typescript
framework: edge
telnyx_products: [Voice, SMS, Call Control, Agent SDK, OpenAI Inference, SQL DB]
---

# AI Call Summarizer

A Telnyx Edge Agent that detects call hangups, summarizes conversation history via OpenAI, texts the summary to the caller, and logs it to SQL for analytics.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — a programmable voice and SMS platform that gives developers real-time access to call state, conversation history, and messaging APIs. Unlike traditional telecom providers, Telnyx exposes webhook-driven call control, embedded AI inference bindings, and durable SQL storage directly within the Edge runtime. This sample leverages Telnyx's Agent SDK, Call Control webhooks, OpenAI inference binding, SMS messaging, and SQL database to deliver a complete post-call summarization pipeline without managing servers or stitching together third-party services.

## Telnyx API Endpoints Used

| Service | Endpoint / Method | Purpose |
|---|---|---|
| **Call Control** | `call.hangup` webhook event | Triggers summarization on call end |
| **Agent SDK** | `SummarizerAgent extends Agent` | Stateful agent managing call lifecycle |
| **Inference (OpenAI binding)** | `this.env.TELNYX.ai.openai.chat.createCompletion()` | Zero-credential LLM summary generation |
| **SMS (Telnyx binding)** | `this.env.TELNYX.messages.send()` | Sends summary text to caller |
| **SQL DB** | `summaries(call_id, caller, summary, duration, timestamp)` | Persists summary records for analytics |

## Architecture

```
┌─────────────────┐
│   Telnyx Voice  │
│   Call Control  │
└────────┬────────┘
         │ Call Hangup Webhook
         ▼
┌──────────────────────────┐
│  SummarizerAgent.onTask() │
│  (Agent SDK, Edge Runtime)│
└────────┬─────────────────┘
         │
         ├──────────────────────────────────────┐
         │                                      │
         ▼                                      ▼
┌──────────────────────────┐       ┌──────────────────────────┐
│ this.messages.toOpenAI() │       │  this.env.TELNYX.ai      │
│ (Conversation History)   │──────▶│  .openai.chat.           │
│                          │       │  createCompletion()      │
│                          │       │  (Zero-Credential LLM)   │
└──────────────────────────┘       └──────────┬───────────────┘
                                              │
                                              ▼
                                   ┌──────────────────────────┐
                                   │  LLM Summary Text        │
                                   └──────────┬───────────────┘
                                              │
                                              ├──────────────────────────────────┐
                                              │                                  │
                                              ▼                                  ▼
                                   ┌──────────────────────────┐       ┌──────────────────────────┐
                                   │ this.env.TELNYX.messages │       │  SQL DB: summaries       │
                                   │ .send()                  │       │  (call_id, caller,       │
                                   │ (SMS to caller)          │       │   summary, duration,     │
                                   └──────────────────────────┘       │   timestamp)             │
                                                                        └──────────────────────────┘
```

**Data Flow:**
1. A call ends → Telnyx sends a `call.hangup` webhook to the Edge Agent.
2. `SummarizerAgent.onTask()` receives the event and retrieves conversation history via `this.messages.toOpenAI()`.
3. The conversation is sent to OpenAI via `this.env.TELNYX.ai.openai.chat.createCompletion()` (zero-credential — no API key needed).
4. The LLM returns a summary, which is SMS'd to the caller via `this.env.TELNYX.messages.send()`.
5. The summary is logged to the SQL database table `summaries(call_id, caller, summary, duration, timestamp)` for analytics.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-call-summarizer

# 2. Create a .env file from the example
cp .env.example .env
# Edit .env and add your Telnyx API key:
# TELNYX_API_KEY=your_telnyx_api_key_here

# 3. Install dependencies
npm install

# 4. Run the agent locally (demo mode by default)
npm run dev

# 5. (Optional) Run smoke test
npm run test
```

**Demo Mode (default):** No real SMS is sent, no real calls are placed. The agent logs what would happen.

**Live Mode:** Set `DEMO_MODE=false` in `.env` to send real SMS summaries and log to the real SQL database. See [GUIDE.md](./GUIDE.md) for details.

## API Reference

See [API.md](./API.md) for the full typed endpoint reference, including webhook payload schemas, request/response shapes, and status codes.

## Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| Webhook not received | Telnyx cannot reach the local server | Use `telnyx-cli tunnel` or ngrok to expose your local endpoint |
| OpenAI summary returns empty | Conversation history is empty or malformed | Verify `this.messages.toOpenAI()` returns valid message objects |
| SMS not delivered | Invalid caller phone number format | Ensure caller number is in E.164 format (e.g., `+15551234567`) |
| SQL insert fails | Table `summaries` does not exist | Run the SQL schema migration from `src/schema.sql` |
| Agent crashes on startup | Missing `TELNYX_API_KEY` | Confirm `.env` file exists and contains a valid key |
| `createCompletion` returns error | OpenAI binding not configured | Verify the Telnyx AI inference binding is enabled in the Telnyx dashboard |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md) — Register your agent and configure webhook endpoints.
- [Telnyx AI GitHub](https://github.com/team-telnyx/ai) — Explore more AI-powered Telnyx samples and SDKs.
- [llms.txt](https://telnyx.com/llms.txt) — Machine-readable documentation for Telnyx APIs and SDKs.

## Related Examples

- [voice-call-control](./voice-call-control) — Basic Call Control with Telnyx Agent SDK
- [sms-notification-agent](./sms-notification-agent) — SMS notifications via Agent SDK
- [ai-call-transcription](./ai-call-transcription) — Real-time call transcription with OpenAI Whisper
- [edge-sql-logger](./edge-sql-logger) — SQL database logging patterns on Telnyx Edge

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com) — Full API documentation and guides
- [Telnyx API Reference](https://developers.telnyx.com/api) — REST API endpoint reference
- [Telnyx Edge SDK](https://github.com/team-telnyx/edge-sdk) — TypeScript SDK for Telnyx Edge
- [Telnyx Voice Product Page](https://telnyx.com/voice) — Programmable voice API
- [Telnyx SMS Product Page](https://telnyx.com/sms) — Global SMS API
- [Telnyx Pricing](https://telnyx.com/pricing) — Transparent pay-as-you-go pricing
