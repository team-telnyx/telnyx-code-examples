---
name: voice-ivr-with-agent-backend
title: "Voice IVR with Agent Backend"
description: "A natural language IVR system where the Telnyx Agent handles backend logic and an LLM powers dynamic menu options."
language: python
framework: flask
telnyx_products: ["Call Control", "Agent SDK", "Inference", "Number Lookup"]
---

# Voice IVR with Agent Backend

A natural language IVR system where the Telnyx Agent handles backend logic and an LLM powers dynamic menu options. Instead of "press 1 or say 'billing'", callers have a natural language conversation that routes to the right department.

## Why Telnyx

Telnyx provides a comprehensive suite of programmable telecom APIs built on a private, global network. By leveraging our AI Communications Infrastructure, developers can build low-latency, intelligent voice applications. This sample demonstrates how to combine Call Control for basic voice orchestration with our OpenAI-compatible Inference API to create dynamic, conversational IVR systems that replace rigid phone trees with natural language understanding.

## Telnyx API Endpoints Used

- **Call Control**: `telnyx.Call.answer()`, `telnyx.Call.speak()`, `telnyx.Call.gather_using_speech()`, `telnyx.Call.transfer()`
- **Inference (AI)**: `telnyx.ai.openai.chat.completions.create()`
- **Webhooks**: Ed25519 signature verification via `telnyx.Webhook.construct_event()`

## Architecture

```text
Inbound Call
    │
    ▼
[Telnyx Call Control] ──(webhook)──> [Flask App (/webhooks/voice)]
    │                                      │
    │                                      ├─ Verify Ed25519 Signature
    │                                      ├─ call.initiated → Answer Call
    │                                      └─ call.answered → IVRAgent.onConnect()
    │                                                      │
    │                                                      ▼
    │                                      [KV Menu Config] ──> [LLM Inference]
    │                                                      │ (Generate Greeting)
    │                                                      ▼
    │                                      [Call Control: speak + gather(speech)]
    │                                                      │
    │                                                      ▼
    │                                      call.gather.ended → IVRAgent.on_gather_ended()
    │                                                      │
    │                                                      ▼
    │                                      [LLM Inference: Route Intent]
    │                                                      │
    ▼                                                      ▼
[Caller Speaks] <─────────────────────────── [Matched?] ──┴─ No: Retry (max 3)
    │                                                      │
    │                                                      └─ Yes: Transfer Call
    ▼
[Target Department]
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `DEFAULT_TRANSFER_NUMBER` | `string` | `your_default_transfer_number_here` | **yes** | DEFAULT_TRANSFER_NUMBER | — |
| `FLASK_DEBUG` | `string` | `your_flask_debug_here` | **yes** | FLASK_DEBUG | — |
| `PORT` | `string` | `your_port_here` | **yes** | PORT | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_CONNECTION_ID` | `string` | `your_telnyx_connection_id_here` | **yes** | TELNYX_CONNECTION_ID | — |
| `TELNYX_PUBLIC_KEY` | `string` | `your_telnyx_public_key_here` | **yes** | TELNYX_PUBLIC_KEY | — |

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/voice-ivr-with-agent-backend
```

### 2. Create a virtual environment and install dependencies

```bash
python3 -m venv venv
source venv/bin/activate  # On Windows use: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Configure environment variables

Copy the example environment file and update it with your Telnyx credentials:

```bash
cp .env.example .env
```

Edit `.env` to include your actual API keys and Connection ID.

### 4. Run the application

```bash
python app.py
```

The Flask server will start on `http://0.0.0.0:5000`. Use a tool like `ngrok` to expose your local environment to the internet so Telnyx can send webhooks to your application:

```bash
ngrok http 5000
```

Configure your Telnyx Call Control Application to point its webhook URL to `https://<your-ngrok-url>.ngrok-free.app/webhooks/voice`.

## API Reference

For a detailed breakdown of the REST endpoints exposed by this application for configuration and debugging, see [API.md](./API.md).

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Webhooks return `401 Unauthorized` | Missing or invalid Ed25519 signature. | Ensure `TELNYX_PUBLIC_KEY` is set correctly in `.env` and the Telnyx portal is configured to sign webhooks. |
| Calls immediately hang up | `TELNYX_CONNECTION_ID` is missing or invalid. | Verify your Call Control Application ID is set in `.env`. |
| LLM falls back to static greeting | Inference API timeout or invalid API key. | Check your Telnyx API key permissions and network connectivity. |
| `404 Not Found` on menu config | The dialed number is not in the `MENU_CONFIG_KV`. | Use the `PUT /api/menu-config/<phone_number>` endpoint to add a configuration for the number. |
| Gather fails repeatedly | Caller speech is too quiet or unclear. | The agent will retry up to `max_turns` (3) before transferring to the `DEFAULT_TRANSFER_NUMBER`. |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI on GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [Call Control Basic Webhook](https://github.com/team-telnyx/telnyx-code-examples)
- [Call Forwarding with Call Control](https://github.com/team-telnyx/telnyx-code-examples)
- [Speech Recognition with Gather](https://github.com/team-telnyx/telnyx-code-examples)

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com/docs)
- [Call Control API Reference](https://developers.telnyx.com/docs/api/v2/call-control)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Inference API Product Page](https://telnyx.com/products/ai-inference)
- [Telnyx Pricing](https://telnyx.com/pricing)
