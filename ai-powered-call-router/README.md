---
name: ai-powered-call-router
title: "AI-Powered Call Router"
description: "Route inbound calls by analyzing caller intent with the Telnyx AI Inference binding and a Telnyx KV route table. One StatefulActor per call leg; zero-credential LLM classification + global KV lookup on the Edge Runtime."
language: typescript
framework: telnyx-edge (Agent SDK)
telnyx_products: [Edge Compute, Call Control, AI Inference, KV]
channel: [voice]
---

# AI-Powered Call Router

Route inbound calls dynamically by analyzing caller intent with the Telnyx AI Inference API — "I need to pay my bill" → billing queue, "I want to upgrade" → sales queue. Built on the Telnyx Edge Runtime: one `RouterAgent` (StatefulActor) per inbound call leg, intent classification via the zero-credential `this.env.TELNYX.ai.openai.chat.createCompletion()` binding, and route destinations looked up in Telnyx KV (`this.env.ROUTES.get('route/billing')`).

## Why Telnyx

Telnyx is **AI Communications Infrastructure** — voice, messaging, SIP, AI, and edge compute on one private, global network. This example composes Call Control (answer + speech gather + transfer), AI Inference (intent classification via the `[telnyx]` binding), KV (global route table), and Stateful Actors (durable per-call lifecycle) in a single deployable edge function — the kind of full-stack voice AI workflow that only Telnyx can ship because we own the telephony network, the inference layer, and the edge runtime.

## Telnyx API Endpoints Used

- **Call Control**: `POST /v2/calls/{call_control_id}/actions/answer` — answer the inbound call
- **Call Control TTS**: `POST /v2/calls/{call_control_id}/actions/speak` — speak the greeting + the transfer announcement
- **Call Control Gather (AI)**: `POST /v2/calls/{call_control_id}/actions/gather_using_ai` — capture the caller's spoken request (speech-to-text via the Telnyx platform)
- **Call Control Transfer**: `POST /v2/calls/{call_control_id}/actions/transfer` — blind-bridge the call to the classified destination
- **AI Inference**: `POST /v2/ai/openai/chat/completions` — via `this.env.TELNYX.ai.openai.chat.createCompletion()` (pre-authenticated binding, zero-credential) — intent classification
- **KV**: `GET/PUT /v2/storage/kvs/{id}/keys/{key}` — via `this.env.ROUTES.get/put('route/<intent>')` (pre-authenticated binding) — route table

## Architecture

```
   Inbound call → webhook → RouterAgent actor (one per call_control_id)
         │
         ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │ call.initiated (incoming)  → recordStart()  + answer()         │
   │ call.answered              → speak(greeting)                    │
   │ call.speak.ended (greeting) → gather_using_ai()                 │
   │ call.ai_gather.ended                                           │
   │   → classifyAndRoute(speech)                                   │
   │     1. this.env.TELNYX.ai.openai.chat.createCompletion()        │
   │        → intent ∈ {billing, sales, support}                    │
   │     2. this.env.ROUTES.get(`route/${intent}`)                   │
   │        → destination (E.164)                                    │
   │   → speak("Transferring you to billing. Please hold.")         │
   │ call.speak.ended (announcement) → transfer(destination)         │
   │ call.hangup                → onHangup()                        │
   └─────────────────────────────────────────────────────────────────┘
```

### How transfers work

`transfer()` is a **blind bridge**: Telnyx dials the destination from the KV route table, and when the destination answers, the two legs are connected. The caller hears the spoken announcement ("Transferring you to billing. Please hold.") on the **original leg**, then the bridge connects. The **transferred leg does not receive a greeting or TTS** — it is simply bridged to the original call. This is standard Call Control transfer behavior.

To customize routing destinations, set keys in Telnyx KV (see Setup below):

```
route/billing → +1XXXXXXXXXX
route/sales   → +1XXXXXXXXXX
route/support → +1XXXXXXXXXX
```

If a KV key is missing for a classified intent, the call transfers to `DEFAULT_DESTINATION` (set in `telnyx.toml`).

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | Telnyx API key (Call Control REST: answer, speak, gather, transfer) | [API Keys](https://portal.telnyx.com/#/app/api-keys) |
| `AI_MODEL` | `string` | `meta-llama/Llama-3.3-70B-Instruct` | no | Telnyx-hosted AI Inference model for intent classification (no OpenAI key needed) | [AI Inference](https://developers.telnyx.com/docs/api/ai/ai-inference) |
| `DEFAULT_DESTINATION` | `string` | `+17177247292` | no | Fallback transfer destination if KV has no entry for the classified intent (E.164) | — |
| `KV_NAMESPACE_ID` | `string` | `550e8400-e29b-41d4-a716-446655440000` | **yes** | Telnyx KV namespace ID for the route table (also set in `telnyx.toml`) | `telnyx-edge storage kv create` |

> **Agent / CLI access** — provision the resources above with the Telnyx CLI:
>
> ```bash
> # API key
> telnyx whoami
>
> # KV namespace for the route table
> telnyx-edge storage kv create --name ai-call-router-routes
> # → paste the returned id into telnyx.toml [storage.kv.ROUTES] and .env.example
>
> # Seed the route table (billing/sales/support → your destinations)
> curl -X PUT "https://api.telnyx.com/v2/storage/kvs/$KV_NAMESPACE_ID/keys/route/billing" \
>   -H "Authorization: Bearer $TELNYX_API_KEY" \
>   -H "Content-Type: text/plain" \
>   -d "+17177247292"
>
> # List available Telnyx-hosted LLM models (no OpenAI key needed)
> curl -H "Authorization: Bearer $TELNYX_API_KEY" \
>   "https://api.telnyx.com/v2/ai/openai/models" | jq '.data[] | select(.owned_by=="Telnyx") | .id'
>
> # Call Control Application (webhook URL → your edge function URL)
> curl -X POST "https://api.telnyx.com/v2/call_control_applications" \
>   -H "Authorization: Bearer $TELNYX_API_KEY" \
>   -d '{"application_name":"ai-powered-call-router","active":true,"webhook_event_url":"https://YOUR-FUNCTION.telnyxcompute.com/webhook","webhook_api_version":"2","outbound":{"outbound_voice_profile_id":"YOUR_PROFILE_ID"}}'
>
> # Map a phone number to the Call Control Application
> telnyx number list
> telnyx number update +1XXXXXXXXXX --connection-id YOUR_CONNECTION_ID
> ```

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-powered-call-router
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create the KV namespace for the route table

```bash
telnyx-edge storage kv create --name ai-call-router-routes
```

Copy the returned namespace `id` into `telnyx.toml` under `[storage.kv.ROUTES]` and into `.env.example` as `KV_NAMESPACE_ID`.

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Poll until the namespace is ready (status: provision_ok) before writing
curl -s "https://api.telnyx.com/v2/storage/kvs/$KV_NAMESPACE_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" | jq -r .data.status

# Seed routes via the REST API (alternative to the binding)
for INTENT in billing sales support; do
  curl -X PUT "https://api.telnyx.com/v2/storage/kvs/$KV_NAMESPACE_ID/keys/route/$INTENT" \
    -H "Authorization: Bearer $TELNYX_API_KEY" \
    -H "Content-Type: text/plain" \
    -d "+17177247292"
done

# Or seed via the admin endpoint after deploy:
curl -X POST https://YOUR-FUNCTION.telnyxcompute.com/routes \
  -H "Content-Type: application/json" \
  -d '{"intent":"billing","destination":"+17177247292"}'

# List current routes
curl https://YOUR-FUNCTION.telnyxcompute.com/routes
```

</details>

### 4. Configure secrets + env

```bash
# Set the API key as a secret (not in code)
telnyx-edge secret set TELNYX_API_KEY

# Copy and edit .env.example for local reference
cp .env.example .env
# Edit .env: set KV_NAMESPACE_ID, DEFAULT_DESTINATION, AI_MODEL
```

### 5. Deploy the edge function

```bash
npm run deploy
```

This runs `telnyx-edge ship`, which deploys the function and prints the public URL (e.g. `https://ai-powered-call-router-<id>.telnyxcompute.com`).

### 6. Configure the Call Control Application

Point a Telnyx Call Control Application's webhook URL at your deployed function:

```
https://ai-powered-call-router-<id>.telnyxcompute.com/webhook
```

Create the application + map a number:

```bash
# Create the Call Control Application
curl -X POST "https://api.telnyx.com/v2/call_control_applications" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "application_name": "ai-powered-call-router",
    "active": true,
    "webhook_event_url": "https://YOUR-FUNCTION.telnyxcompute.com/webhook",
    "webhook_api_version": "2",
    "outbound": { "outbound_voice_profile_id": "YOUR_OUTBOUND_VOICE_PROFILE_ID" }
  }'

# Map a number to it
curl -X PATCH "https://api.telnyx.com/v2/phone_numbers/+1XXXXXXXXXX" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"connection_id": "YOUR_CALL_CONTROL_APPLICATION_ID"}'
```

### 7. Seed the route table in KV

```bash
# Via the admin endpoint
curl -X POST https://YOUR-FUNCTION.telnyxcompute.com/routes \
  -H "Content-Type: application/json" \
  -d '{"intent":"billing","destination":"+1XXXXXXXXXX"}'
curl -X POST https://YOUR-FUNCTION.telnyxcompute.com/routes \
  -H "Content-Type: application/json" \
  -d '{"intent":"sales","destination":"+1XXXXXXXXXX"}'
curl -X POST https://YOUR-FUNCTION.telnyxcompute.com/routes \
  -H "Content-Type: application/json" \
  -d '{"intent":"support","destination":"+1XXXXXXXXXX"}'

# Verify
curl https://YOUR-FUNCTION.telnyxcompute.com/routes
```

### 8. Dial in

Call the number you mapped. You'll hear "Hello, please tell me briefly how I can help you today.", then say something like "I need to pay my bill". The agent classifies the intent, speaks "Got it. Transferring you to billing. Please hold.", and blind-bridges the call to the destination in KV.

## API Reference

See [API.md](./API.md) for the full endpoint reference including request/response shapes and status codes.

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Webhook returns 400 | Malformed event payload | Ensure the Call Control Application webhook URL is `https://YOUR-FUNCTION/webhook` (not `/webhooks/voice`) |
| Calls not answered | Call Control Application webhook URL wrong/unreachable | Verify the webhook URL in the Call Control Application points to your deployed function |
| `gather_using_ai` returns 422 `90012 Invalid value for voice` | `gather_using_ai` uses a different voice set than `speak()` | This example does not pass `voice` to `gather_using_ai` — the greeting is played via `speak(voice="female")` separately. Don't add a `voice` to `gatherUsingAi()`. |
| Intent always returns "support" | AI Inference binding misconfigured or model unreachable | Verify the `[telnyx]` binding in `telnyx.toml`; check `AI_MODEL` is a Telnyx-hosted model (`owned_by == 'Telnyx'`) |
| Transfer fails | Invalid destination number | Ensure KV `route/<intent>` values are valid E.164 phone numbers; check `DEFAULT_DESTINATION` |
| Transferred leg is silent on answer | Expected — `transfer()` is a blind bridge | The announcement plays on the original leg; the transferred leg is bridged without TTS. See "How transfers work" above. |
| App re-answers the transfer leg (loop) | Handler not filtering outbound legs | `call.initiated` with `direction !== "incoming"` returns `ignored_outbound` — only inbound legs enter the actor lifecycle. |
| KV route lookup misses | Namespace not ready or key not set | Poll namespace status until `provision_ok`; seed routes via `POST /routes` or the KV REST API |

## Agent Discovery

- [Agent Signup](https://telnyx.com/agent-signup.md)
- [Team Telnyx AI on GitHub](https://github.com/team-telnyx/ai)
- [Edge Runtime docs](https://developers.telnyx.com/docs/edge-compute)
- [KV docs](https://developers.telnyx.com/docs/edge-compute/kv)
- [Stateful Actors docs](https://developers.telnyx.com/docs/edge-compute/stateful-actors)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [Edge Call Transcription Agent](https://github.com/team-telnyx/telnyx-code-examples/tree/main/edge-call-transcription-agent) — same Agent SDK pattern (one actor per call), but transcribes + summarizes + SMSes instead of routing
- [Edge Prompt A/B Tester](https://github.com/team-telnyx/telnyx-code-examples/tree/main/edge-prompt-ab-tester) — StatefulActor + `ctx.storage` (actor-local KV) for experiment state
- [AI Voice Agent with Function Calling](https://github.com/team-telnyx/telnyx-code-examples/tree/main/ai-voice-agent-with-function-calling-python) — Python/Flask voice agent using `gather_using_ai` + AI Inference

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com/docs)
- [Call Control API Reference](https://developers.telnyx.com/docs/api/v2/call-control)
- [AI Inference API Reference](https://developers.telnyx.com/docs/api/ai/ai-inference)
- [Edge Compute Quick Start](https://developers.telnyx.com/docs/edge-compute/quick-start)
- [KV Quick Start](https://developers.telnyx.com/docs/edge-compute/kv/quick-start)
- [Stateful Actors Quick Start](https://developers.telnyx.com/docs/edge-compute/stateful-actors/quick-start)
- [Telnyx Edge Runtime SDK (npm)](https://www.npmjs.com/package/@telnyx/edge-runtime)
- [Call Control Product Page](https://telnyx.com/products/call-control)
- [Telnyx Pricing](https://telnyx.com/pricing)
