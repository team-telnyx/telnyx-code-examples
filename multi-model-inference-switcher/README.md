---
name: multi-model-inference-switcher
title: "Multi-Model Inference Switcher"
description: "Switch between LLM models at runtime via a KV feature flag — no redeploy. Agent SDK + zero-credential inference + admin UI with live model switching."
language: nodejs
framework: telnyx-edge (Agent SDK)
telnyx_products: [Edge Compute, AI Inference]
---

# Multi-Model Inference Switcher

Switch between LLM models at runtime via a KV feature flag — no redeploy. The active model is read from a Telnyx KV namespace at inference time, so toggling the flag in the admin UI takes effect immediately for the next message. Uses the `[telnyx]` binding for zero-credential inference — no API key in code.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network. This example composes durable state, KV storage, zero-credential LLM inference, and a live admin UI on Edge Compute — a model switcher that requires no redeploy to change models.

## Telnyx API Endpoints Used

- **AI Inference**: `POST /v2/ai/openai/chat/completions` — via `this.env.TELNYX.ai.openai.chat.createCompletion()` (pre-authenticated binding, zero-credential) with the model name read from KV at call time
- **KV Storage**: `GET/PUT /v2/storage/kvs/{namespace_id}/keys/{key}` — feature flag for the active model (global key-value store, separate from per-actor state)

## Architecture

```
  POST /chat → SwitcherAgent.process(text, model)
        │
        ▼
  ┌──────────────────────────────────────────────────────┐
  │ Agent SDK (Stateful Actor)                            │
  │                                                      │
  │  1. Read active model from KV:                        │
  │     → GET /v2/storage/kvs/<ns>/keys/active-model      │
  │     → returns model name (e.g. "moonshotai/Kimi-K2.6")│
  │  2. Inference with the active model:                  │
  │     → env.TELNYX.ai.openai.chat.createCompletion({     │
  │         model, messages                                │
  │       })                                               │
  │  3. Store reply in durable history (this.messages)    │
  │  4. Return reply + model name to caller               │
  └──────────────────────────────────────────────────────┘

  Admin UI (GET /):
    → Model dropdown → POST /model → writes KV → live switch
    → Chat panel → POST /chat → reads KV model → inference → reply
    → Each reply tagged with the model that generated it
```

## Available Models

All models are hosted on Telnyx inference (zero-credential via the `[telnyx]` binding):

| Model ID | Name | Vendor | Notes |
|----------|------|--------|-------|
| `moonshotai/Kimi-K2.6` | Kimi K2.6 | Moonshot AI | Strong general-purpose reasoning |
| `zai-org/GLM-5.2` | GLM-5.2 | Z.AI | Fast reasoning, good at tool use |
| `meta-llama/Llama-3.3-70B-Instruct` | Llama 3.3 70B | Meta | Open-source, good for comparison |

## Environment Variables / Secrets

| Variable | Type | Required | Description |
|----------|------|----------|-------------|
| `[telnyx]` binding | toml | **yes** | Pre-authenticated Telnyx client (inference) |
| `TELNYX_API_KEY` | secret | **yes** | Telnyx API key for KV REST API access |
| `KV_NAMESPACE_ID` | env_var | **yes** | KV namespace ID for the model feature flag |

> **Agent / CLI access**
>
> ```bash
> # Create the KV namespace for the model flag
> telnyx-edge storage kv create --name "switcher-flag"
>
> # Seed the default model
> telnyx-edge storage kv key put <namespace-id> active-model moonshotai/Kimi-K2.6
> ```

## Setup

### Prerequisites

- [Telnyx Edge CLI](https://github.com/team-telnyx/edge-compute/releases) v0.2.2+
- Node.js 18+

### 1. Clone and install

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/multi-model-inference-switcher
npm install
```

### 2. Create KV namespace and seed the default model

```bash
telnyx-edge storage kv create --name "switcher-flag"
# Copy the KV ID from the output

# Seed the default model
telnyx-edge storage kv key put <kv-id> active-model moonshotai/Kimi-K2.6
```

### 3. Configure

Update `telnyx.toml` with your KV namespace ID:
```toml
[env_vars]
KV_NAMESPACE_ID = "<your-kv-namespace-id>"
```

Set your API key as a secret:
```bash
telnyx-edge secrets add TELNYX_API_KEY your_telnyx_api_key
```

<details><summary>Programmatic / CLI setup</summary>

```bash
# Create KV namespace
telnyx-edge storage kv create --name "switcher-flag"

# Seed default model
telnyx-edge storage kv key put <kv-id> active-model moonshotai/Kimi-K2.6

# Verify
telnyx-edge storage kv key get <kv-id> active-model
# → moonshotai/Kimi-K2.6
```

</details>

### 4. Deploy

```bash
telnyx-edge ship
```

`ship` prints a URL like `multi-model-inference-switcher-<id>.telnyxcompute.com`.

### 5. Open the admin UI

Open the deployed URL in your browser:
```
https://multi-model-inference-switcher-<id>.telnyxcompute.com/
```

You'll see:
- **Model dropdown** showing the active model (from KV)
- **Switch button** to toggle the model (writes to KV, no redeploy)
- **Chat panel** to send messages and see replies tagged with the model used
- **Stats** showing total requests and models used

### 6. Test the live switch

1. Send a message with the default model (Kimi K2.6) — the reply is tagged `Kimi K2.6`
2. Switch to GLM-5.2 via the dropdown — the KV flag updates instantly
3. Send another message — the reply is now tagged `GLM-5.2`
4. Switch to Llama 3.3 70B — send a message — tagged `Llama 3.3 70B`
5. Check stats: total requests increment, models used count increases

## API Reference

See [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/multi-model-inference-switcher/API.md) for the full typed endpoint reference.

## How It Works

1. **Read model from KV** — on each `POST /chat`, the fetch handler reads the active model from the KV namespace (`GET /v2/storage/kvs/<ns>/keys/active-model`)
2. **Inference** — the model name is passed to `SwitcherAgent.process(text, model)`, which calls `this.env.TELNYX.ai.openai.chat.createCompletion({ model, messages })` (zero-credential)
3. **History** — conversation is stored in durable actor state via `this.messages` (survives restarts)
4. **Live switch** — `POST /model` writes the new model name to KV. The next `POST /chat` reads it — no redeploy needed
5. **Admin UI** — served from `GET /`, calls the REST endpoints, tags each reply with the model that generated it

## Agent SDK Primitives Used

| Primitive | API | What it does |
|-----------|-----|--------------|
| Message History | `this.messages.add()` / `this.messages.toOpenAI()` | Durable conversation log |
| Durable State | `this.setState()` / `this.getState()` | Session state, usage stats |
| Telnyx Binding | `this.env.TELNYX.ai.openai.chat.createCompletion()` | Zero-credential inference with model from KV |
| KV (REST API) | `GET/PUT /v2/storage/kvs/<ns>/keys/<key>` | Global model feature flag |

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `404 page not found` | Function still deploying | Wait ~30s, then retry |
| `KV not configured` | `KV_NAMESPACE_ID` env var missing | Set it in `telnyx.toml` under `[env_vars]` |
| `model could not be found` | Invalid model name in KV | Use one of the available models listed in `/model` |
| Inference returns empty | Reasoning model needs more tokens | `max_tokens` is set to 2000 for reasoning models |
| Admin UI won't load | Function still deploying | Wait ~30s, then refresh |

## Related Examples

- [Agent SMS Triage Bot (TypeScript, Agent SDK + KV)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/agent-sms-triage-bot/README.md)
- [Scheduled Reminder Agent (TypeScript, Agent SDK)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/scheduled-reminder-agent/README.md)
- [Edge Voice Agent That Holds a Call (TypeScript, Agent SDK)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-voice-agent-holds-call/README.md)

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md)
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli)
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli)

## Resources

- [Agent SDK Overview](https://developers.telnyx.com/docs/agent-sdk)
- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Stateful Actors Quick Start](https://developers.telnyx.com/docs/edge-compute/stateful-actors/quick-start)
- [Edge Compute CLI](https://github.com/team-telnyx/edge-compute/releases)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
