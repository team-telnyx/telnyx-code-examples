---
name: event-microsite-that-takes-calls
title: "Event Microsite That Takes Calls"
description: "A Flask event microsite backed by Telnyx KV that lets attendees text, call, or talk in-browser to an AI concierge, broadcasts schedule changes, qualifies exhibitor leads, and transcribes post-event feedback into a sponsor report."
language: python
framework: flask
telnyx_products: [Voice, Messaging, Voice AI, Inference, KV, SQLDB, Custom Domains, Functions]
---

# Event Microsite That Takes Calls

A Flask app that serves an event microsite backed by Telnyx KV, enables SMS/Voice/WebSocket contact with an AI concierge, broadcasts schedule changes, qualifies exhibitor leads, and transcribes post-event feedback into a sponsor report.

## Why Telnyx

This sample demonstrates how Telnyx **AI Communications Infrastructure** powers a real-time event experience. By combining KV for content, Voice + Voice AI WebSocket for in-browser calls, Messaging for SMS/WhatsApp, Inference for transcription and summarization, and SQLDB for lead and feedback storage, a single microsite can serve attendees, exhibitors, and sponsors through one unified communications layer.

## Telnyx API Endpoints Used

| Telnyx Product | SDK Method / Endpoint | Purpose |
|----------------|----------------------|---------|
| KV | `telnyx.kv.Namespace.retrieve` / `create_entry` | Store and serve event schedule, speakers, venue, sponsors |
| SQLDB | `telnyx.sqldb.Connection` | Persist exhibitor leads and post-event feedback |
| Messaging (SMS) | `telnyx_client.messages.send` | Send AI concierge replies and hot-lead alerts |
| Messaging (WhatsApp) | `telnyx_client.messages.whatsapp` | Broadcast schedule changes and concierge replies |
| Voice | `telnyx_client.calls.actions.answer` | Answer inbound voice calls |
| Voice AI | `telnyx_client.calls.actions.start_ai_assistant` | Connect callers to the AI concierge in real time |
| AI Inference (Chat) | `telnyx_client.ai.openai.chat.create_completion` | Generate AI concierge responses and feedback summaries |
| AI Inference (Transcription) | `telnyx_client.ai.audio.transcribe` | Transcribe post-event spoken feedback |
| Webhooks | `unwrap_with_ed25519` (Ed25519 signature) | Verify inbound SMS, WhatsApp, and Voice events |

## Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │           Event Microsite (Flask)            │
                    │                                              │
   Attendee  ──────►│  /  (renders KV event data as HTML)          │
                    │  /api/event, /api/schedule, /api/speakers    │
                    │  /api/venue, /api/sponsors                   │
                    │                                              │
                    │  /webhook/sms     ──► Inference (chat)       │
                    │  /webhook/whatsapp ──► Inference (chat)      │
                    │  /webhook/voice   ──► calls.actions.answer +  │
                    │                        start_ai_assistant     │
                    │  /webhook/voice-ai  (transcription events)    │
                    │                                              │
                    │  /api/broadcast-schedule-change              │
                    │  /api/qualify-lead                           │
                    │  /api/submit-feedback ──► Inference (whisper)│
                    │  /api/sponsor-report                         │
                    └──────────┬───────────────────────┬───────────┘
                               │                       │
                    ┌──────────▼──────────┐  ┌─────────▼──────────┐
                    │  Telnyx KV          │  │  Telnyx SQLDB      │
                    │  (event_data)       │  │  (leads, feedback) │
                    └─────────────────────┘  └────────────────────┘
                               │                       │
                    ┌──────────▼──────────┐  ┌─────────▼──────────┐
                    │  Telnyx Messaging   │  │  Telnyx Inference  │
                    │  (SMS / WhatsApp)   │  │  (chat + whisper)  │
                    └─────────────────────┘  └────────────────────┘
                               │                       │
                    ┌──────────▼───────────────────────▼──────────┐
                    │  Telnyx Voice + Voice AI WebSocket           │
                    │  (real-time AI concierge calls)              │
                    └──────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `PORT` | `string` | `your_port_here` | **yes** | PORT | — |
| `TELNYX_AI_CONCIERGE_NAME` | `string` | `your_telnyx_ai_concierge_name_here` | **yes** | TELNYX_AI_CONCIERGE_NAME | — |
| `TELNYX_AI_CONCIERGE_PROMPT` | `string` | `your_telnyx_ai_concierge_prompt_here` | **yes** | TELNYX_AI_CONCIERGE_PROMPT | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_DEMO_MODE` | `string` | `your_telnyx_demo_mode_here` | **yes** | TELNYX_DEMO_MODE | — |
| `TELNYX_EVENT_DOMAIN` | `string` | `your_telnyx_event_domain_here` | **yes** | TELNYX_EVENT_DOMAIN | — |
| `TELNYX_INFERENCE_API_KEY` | `string` | `your_telnyx_inference_api_key_here` | **yes** | TELNYX_INFERENCE_API_KEY | — |
| `TELNYX_KV_NAMESPACE_ID` | `string` | `your_telnyx_kv_namespace_id_here` | **yes** | TELNYX_KV_NAMESPACE_ID | — |
| `TELNYX_PHONE_NUMBER` | `string` | `your_telnyx_phone_number_here` | **yes** | TELNYX_PHONE_NUMBER | — |
| `TELNYX_PUBLIC_KEY` | `string` | `your_telnyx_public_key_here` | **yes** | TELNYX_PUBLIC_KEY | — |
| `TELNYX_SALES_REP_PHONE` | `string` | `your_telnyx_sales_rep_phone_here` | **yes** | TELNYX_SALES_REP_PHONE | — |
| `TELNYX_SMS_FROM` | `string` | `your_telnyx_sms_from_here` | **yes** | TELNYX_SMS_FROM | — |
| `TELNYX_SQLDB_CONNECTION_STRING` | `string` | `your_telnyx_sqldb_connection_string_here` | **yes** | TELNYX_SQLDB_CONNECTION_STRING | — |
| `TELNYX_VOICE_CONNECTION_ID` | `string` | `your_telnyx_voice_connection_id_here` | **yes** | TELNYX_VOICE_CONNECTION_ID | — |
| `TELNYX_WHATSAPP_FROM` | `string` | `your_telnyx_whatsapp_from_here` | **yes** | TELNYX_WHATSAPP_FROM | — |

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/event-microsite-that-takes-calls

# 2. Copy the example environment file
cp .env.example .env

# 3. Edit .env and fill in your Telnyx credentials
#    (Get your API key, public key, phone number, KV namespace ID,
#     SQLDB connection string, and Voice connection ID from the
#     Telnyx Portal: https://portal.telnyx.com)

# 4. Install dependencies
pip install -r requirements.txt

# 5. Run the app (demo mode by default)
python app.py
```

The server starts on `http://0.0.0.0:5000` (or the port specified by `PORT`).

## API Reference

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/` | Render the event microsite HTML from KV data |
| `GET` | `/api/event` | Return full event data as JSON |
| `GET` | `/api/schedule` | Return schedule array as JSON |
| `GET` | `/api/speakers` | Return speakers array as JSON |
| `GET` | `/api/venue` | Return venue info as JSON |
| `GET` | `/api/sponsors` | Return sponsors array as JSON |
| `POST` | `/webhook/sms` | Handle inbound SMS — reply via AI concierge |
| `POST` | `/webhook/whatsapp` | Handle inbound WhatsApp — reply via AI concierge |
| `POST` | `/webhook/voice` | Handle inbound voice call — answer + connect to Voice AI |
| `POST` | `/webhook/voice-ai` | Handle Voice AI WebSocket events (transcription, etc.) |
| `POST` | `/api/broadcast-schedule-change` | Broadcast a schedule change to all opted-in attendees via SMS + WhatsApp |
| `POST` | `/api/qualify-lead` | Capture exhibitor lead, qualify, and route hot leads to sales rep via SMS |
| `POST` | `/api/submit-feedback` | Accept post-event spoken feedback, transcribe via Inference, summarize |
| `GET` | `/api/sponsor-report` | Generate a sponsor report from all collected feedback |
| `GET` | `/api/voice-websocket-info` | Return Voice AI WebSocket connection info for in-browser calls |

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `Missing required environment variables` | One or more env vars not set in `.env` | Run `cp .env.example .env` and fill in all values |
| `401 Unauthorized` on webhook | Telnyx signature verification failed | Ensure `TELNYX_PUBLIC_KEY` is correct and webhook payload is unmodified |
| `KV get failed` | Invalid `TELNYX_KV_NAMESPACE_ID` or no data seeded | Verify namespace ID; the app auto-seeds sample data on first run |
| `SQLDB execute failed` | Invalid `TELNYX_SQLDB_CONNECTION_STRING` | Check connection string format in Telnyx Portal |
| `Inference error` | Invalid `TELNYX_INFERENCE_API_KEY` or model unavailable | Verify Inference API key and model name |
| `Demo mode still sending SMS` | `TELNYX_DEMO_MODE` not set to `true` | Set `TELNYX_DEMO_MODE=true` in `.env` |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [Telnyx llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [SMS Concierge Bot](../sms-concierge-bot)
- [Voice AI IVR](../voice-ai-ivr)
- [KV-Powered Content API](../kv-content-api)
- [Inference Transcription Pipeline](../inference-transcription-pipeline)

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx API Reference](https://developers.telnyx.com/api)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Telnyx Voice Product Page](https://telnyx.com/voice)
- [Telnyx Messaging Product Page](https://telnyx.com/sms)
- [Telnyx Pricing](https://telnyx.com/pricing)
