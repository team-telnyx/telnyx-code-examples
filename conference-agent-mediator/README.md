---
name: conference-agent-mediator
title: "Conference Agent Mediator"
description: "An AI meeting facilitator that joins Telnyx Call Control conferences, transcribes speech, mediates turn-taking via an LLM, and sends a post-conference summary via SMS."
language: python
framework: flask
telnyx_products: ["Call Control", "Agent SDK", "Inference", "Messaging", "WebSocket"]
---

# Conference Agent Mediator

An AI meeting facilitator that joins Telnyx Call Control conferences, transcribes speech, mediates turn-taking via an LLM, broadcasts a live transcript to observers over WebSocket, and sends a post-conference summary via SMS.

## Why Telnyx

Telnyx provides a comprehensive AI Communications Infrastructure that enables developers to build intelligent voice applications with ease. By combining Call Control for programmatic voice, Inference for real-time transcription and LLM processing, and Messaging for follow-up communications, you can create sophisticated AI agents that actively participate in and enhance conference calls. This sample demonstrates how to leverage Telnyx's low-latency network and robust APIs to build an agent that joins calls, listens, speaks, and facilitates meetings seamlessly.

## Telnyx API Endpoints Used

- **Call Control** — `telnyx.Call.create()`, `telnyx.Call.retrieve().speak()`
- **Conference** — `telnyx.Conference.create()`
- **Messaging** — `telnyx.Message.create()`
- **Webhooks** — `telnyx.Webhook.unwrap()` for Ed25519 signature verification
- **Inference** — External LLM API integration for transcription processing and summary generation

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Conference Agent Mediator                   │
└─────────────────────────────────────────────────────────────────┘
       │
       │ 1. Start Conference
       ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Telnyx     │───▶│  Conference  │───▶│   Agent      │
│  Conference  │    │   Agent      │    │  Joins Call  │
└──────────────┘    └──────────────┘    └──────────────┘
                           │
                           ▼
                   ┌──────────────┐
                   │  STT Stream  │
                   │  (Ingest)    │
                   └──────────────┘
                           │
                           ▼
                   ┌──────────────┐
                   │  LLM Track   │
                   │  Turn-Taking │
                   └──────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
    ┌──────────────┐            ┌──────────────┐
    │  Agent       │            │  WebSocket   │
    │  Prompts     │            │  Live        │
    │  Quiet       │            │  Transcript  │
    │  Participants│            │  (SSE)       │
    └──────────────┘            └──────────────┘
              │
              ▼
    ┌──────────────┐
    │  Conference  │
    │  Ends        │
    └──────────────┘
              │
              ▼
    ┌──────────────┐
    │  Summary +   │
    │  SMS Sent    │
    └──────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `LLM_API_KEY` | `string` | `your_llm_api_key_here` | **yes** | LLM_API_KEY | — |
| `LLM_BASE_URL` | `string` | `your_llm_base_url_here` | **yes** | LLM_BASE_URL | — |
| `LLM_MODEL` | `string` | `your_llm_model_here` | **yes** | LLM_MODEL | — |
| `PORT` | `string` | `your_port_here` | **yes** | PORT | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_CONNECTION_ID` | `string` | `your_telnyx_connection_id_here` | **yes** | TELNYX_CONNECTION_ID | — |
| `TELNYX_FROM_NUMBER` | `string` | `your_telnyx_from_number_here` | **yes** | TELNYX_FROM_NUMBER | — |
| `TELNYX_PUBLIC_KEY` | `string` | `your_telnyx_public_key_here` | **yes** | TELNYX_PUBLIC_KEY | — |
| `TELNYX_TO_NUMBER` | `string` | `your_telnyx_to_number_here` | **yes** | TELNYX_TO_NUMBER | — |
| `WEBHOOK_BASE_URL` | `string` | `your_webhook_base_url_here` | **yes** | WEBHOOK_BASE_URL | — |
| `WS_OBSERVER_SECRET` | `string` | `your_ws_observer_secret_here` | **yes** | WS_OBSERVER_SECRET | — |

## Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/team-telnyx/telnyx-code-examples.git
   cd telnyx-code-examples/conference-agent-mediator
   ```

2. **Create a virtual environment and install dependencies**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and fill in your Telnyx API key, public key, connection ID, phone numbers, LLM credentials, and webhook base URL.

4. **Run the application**
   ```bash
   flask run --port 5000
   ```
   Or:
   ```bash
   python app.py
   ```

5. **Expose your local server** (for webhook testing)
   Use a tool like ngrok to expose your local server to the internet:
   ```bash
   ngrok http 5000
   ```
   Set the `WEBHOOK_BASE_URL` in your `.env` to the ngrok URL.

## API Reference

See [API.md](./API.md) for the full endpoint reference.

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `Invalid signature` on webhook | `TELNYX_PUBLIC_KEY` not set or incorrect | Verify the public key in your Telnyx portal and set it in `.env` |
| `speak() failed` | Call Control ID not found or call ended | Ensure the conference is active and the call control ID is valid |
| `LLM completion failed` | `LLM_API_KEY` not set or invalid | Verify your LLM API key and base URL in `.env` |
| `Failed to send summary SMS` | Phone numbers not configured or invalid | Check `TELNYX_FROM_NUMBER` and `TELNYX_TO_NUMBER` in `.env` |
| `Unknown conference` on transcript ingest | Conference ID not found in memory | Ensure the conference was started via `/conference/start` and the app hasn't restarted |
| SSE stream disconnects | Network timeout or server restart | Reconnect to the stream endpoint; existing transcript will be replayed |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI on GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [Call Agent Basic](https://github.com/team-telnyx/telnyx-code-examples/tree/main/call-agent-basic)
- [Voice Transcription](https://github.com/team-telnyx/telnyx-code-examples/tree/main/voice-transcription)
- [SMS Summary Bot](https://github.com/team-telnyx/telnyx-code-examples/tree/main/sms-summary-bot)

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com/docs)
- [Call Control API Reference](https://developers.telnyx.com/docs/api/v2/call-control)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [AI Voice & Inference Product Page](https://telnyx.com/products/ai-voice)
- [Pricing](https://telnyx.com/pricing)
