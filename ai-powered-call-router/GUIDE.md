# Guide: AI-Powered Call Router

This guide walks through the `ai-powered-call-router` example — a Telnyx Edge Runtime function that routes inbound calls by classifying the caller's spoken intent via the zero-credential AI Inference binding and looking up the destination in Telnyx KV.

## Architecture Overview

When a caller dials your Telnyx number, Telnyx sends a webhook to your edge function. The function answers the call, plays a greeting, and gathers the caller's speech via `gather_using_ai`. Once the caller speaks, the transcript is sent to the Telnyx AI Inference API (via the `[telnyx]` binding — no API key in code) to classify the intent (e.g., `billing`, `sales`, `support`). The app then looks up the destination in Telnyx KV (via the `[storage.kv.ROUTES]` binding), speaks a transfer announcement, and blind-bridges the call.

```text
Inbound Call → Telnyx Webhook → RouterAgent actor (one per call_control_id)
  → answer → speak(greeting) → gather_using_ai → classify intent (AI Inference)
  → lookup destination (KV) → speak("Transferring you to billing…") → transfer
```

## Prerequisites

* A Telnyx account with a Call Control Application configured
* A Telnyx phone number mapped to your Call Control Application
* The `telnyx-edge` CLI installed and authenticated
* A Telnyx KV namespace for the route table
* Node.js 18+ and `npm`

## The Four Pieces

This example composes four Telnyx platform primitives:

### 1. Stateful Actor — `RouterAgent` (`src/routerAgent.ts`)

`class RouterAgent extends Agent<RouterEnv, RouterState>` — one actor instance per inbound call leg, keyed by `call_control_id`. Holds per-call state (phase, speech, intent, destination) in durable actor storage. The platform guarantees one instance per name, single-threaded dispatch, and durability before reply.

```ts
export class RouterAgent extends Agent<RouterEnv, RouterState> {
  protected override initialState(): RouterState { ... }

  async recordStart(callControlId, from, to) { ... }      // call.initiated
  async classifyAndRoute(speech) { ... }                   // call.ai_gather.ended
  // ... setGreeting, setGathering, setAnnouncing, setTransferring, onHangup
}
```

### 2. Telnyx API Binding — `[telnyx]` in `telnyx.toml`

The `[telnyx]` block injects a pre-authenticated Telnyx SDK client as `env.TELNYX` (and `this.env.TELNYX` inside the actor). This example uses it for **zero-credential AI Inference** — no API key appears in the code for the LLM call:

```ts
const completion = await this.env.TELNYX.ai.openai.chat.createCompletion({
  model: this.env.AI_MODEL,
  messages: [
    { role: "system", content: "You are an intent classifier..." },
    { role: "user", content: `Caller said: "${speech}"\n\nIntent:` },
  ],
  max_tokens: 5,
  temperature: 0.0,
});
const intent = completion.choices[0].message.content.trim().toLowerCase();
```

> **Why zero-credential matters**: the runtime injects the credential at deploy time from your `telnyx-edge` auth. Your function code, bundle, and logs never contain the API key for the LLM call. The `TELNYX_API_KEY` secret is still needed for the Call Control REST calls (answer/speak/gather/transfer) because those go over plain HTTP, not the binding.

### 3. KV Binding — `[storage.kv.ROUTES]` in `telnyx.toml`

The route table lives in Telnyx KV — globally distributed key-value storage. Keys are `route/<intent>` (e.g. `route/billing`), values are E.164 phone numbers. The binding is pre-authenticated, so the actor reads destinations with no API key in code:

```ts
const destination = await this.env.ROUTES.get(`route/${intent}`);
```

This is shared across all calls and all actor instances — update a route via `POST /routes` and the next call picks it up immediately. No redeploy needed.

### 4. Call Control REST — direct `fetch()` in `src/index.ts`

The webhook handler drives the call lifecycle via the Call Control REST API (using `TELNYX_API_KEY` as a bearer token):

- `POST /v2/calls/{id}/actions/answer`
- `POST /v2/calls/{id}/actions/speak` (greeting + announcement, distinguished by `client_state`)
- `POST /v2/calls/{id}/actions/gather_using_ai` (speech capture)
- `POST /v2/calls/{id}/actions/transfer` (blind bridge)

## The Event Flow

### 1. `call.initiated` (incoming)

The handler filters on `direction: "incoming"` — outbound legs (transfer destinations) are ignored so the app doesn't re-answer the transferred leg. For inbound calls: `actor.recordStart()` captures the call metadata, then `answerCall()` picks up.

### 2. `call.answered`

`actor.setGreeting()` marks the phase, then `speakText()` plays "Hello, please tell me briefly how I can help you today." with `client_state: { speak_stage: "greeting" }` so the next `call.speak.ended` knows which speak just finished.

### 3. `call.speak.ended` (greeting)

`actor.setGathering()` marks the phase, then `gatherUsingAi()` starts speech capture. The gather passes a JSON schema (`parameters`) asking for an `utterance` field, an `assistant` block (model + one-turn instruction), and `transcription: { language: "en" }`. **No `voice` param** — `gather_using_ai` uses a different voice set than `speak()` and rejects `voice="female"` with `90012 Invalid value for voice`. The greeting is played separately via `speak(voice="female")` for this reason.

### 4. `call.ai_gather.ended`

`actor.classifyAndRoute(speech)` does two things in one method:
1. **Classify** via `this.env.TELNYX.ai.openai.chat.createCompletion()` — zero-credential. The LLM returns one of `billing`/`sales`/`support`.
2. **Look up destination** via `this.env.ROUTES.get('route/<intent>')` — zero-credential KV read.

Then `speakText()` plays "Got it. Transferring you to billing. Please hold." with `client_state: { speak_stage: "announcement" }`.

### 5. `call.speak.ended` (announcement)

`actor.setTransferring()` marks the phase, then `transferCall()` fires the blind bridge to the destination stashed in actor state.

### 6. `call.hangup`

`actor.onHangup()` marks the phase as `done`.

## Why the announcement is its own speak step

`speak()` is asynchronous — if you call `transfer()` immediately after `speak()`, the transfer cuts off the TTS mid-sentence. By splitting the announcement into its own `speak()` call and waiting for `call.speak.ended` before transferring, the caller hears the full "Transferring you to billing. Please hold." before the bridge fires.

## Why the route table is in KV (not in code)

Hardcoding destinations in `app.py` requires a redeploy to change a route. Putting them in KV means:
- **Update without redeploy**: `POST /routes` updates a destination; the next call picks it up.
- **Shared state**: multiple function instances read the same routes.
- **Operational visibility**: `GET /routes` shows the current routing config.
- **Global read latency**: KV is globally distributed, so the lookup is fast from any edge region.

## Next Steps

- Add more intents (e.g. `retention`, `complaint`) by extending the LLM prompt's label set and seeding the new KV keys.
- Replace the blind-bridge `transfer()` with a `dial` to a separate Call Control Application that plays its own greeting on the transferred leg.
- Persist call records (intent, destination, duration) to actor-local SQL (`this.ctx.storage.sql`) for analytics — see `edge-call-transcription-agent` for the pattern.
- Add rate limiting via the `[[ratelimits]]` binding to cap per-caller call volume.
