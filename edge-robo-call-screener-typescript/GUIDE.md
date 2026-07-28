# Build an Edge Robo-Call Screener

Inbound call screener on Telnyx Edge Compute Stateful Actors — answers, asks a question, AI judges if it's a robocall, hangs up on robocalls and forwards legitimate callers. No ngrok, no external server.

## How It Works

```
  Caller dials your number
        │
        ▼
  ┌──────────────────────────────┐
  │ Telnyx Voice webhook         │
  │ → *.telnyxcompute.com        │
  └────────┬─────────────────────┘
           │
           ▼
  ┌──────────────────────────────┐
  │ Edge Stateful Actor           │
  │ (CallScreener)                │
  │  1. Check blocklist           │
  │  2. Answer + ask question     │
  │  3. Gather speech → STT       │
  │  4. AI Inference judges       │
  │  5. Hang up or forward        │
  └────────┬─────────────────────┘
           │
     ├── robocall → hang up + add to blocklist
     └── legitimate → transfer to human
```

## Telnyx Products Used

- **Edge Compute (Stateful Actors)** — Per-number durable state for blocklist, call history, and stats
- **Voice (Call Control)** — Answer, gather (speak + STT), hangup, transfer, reject
- **AI Inference** — LLM judges the caller's spoken response

## Prerequisites

- [Telnyx Edge CLI](https://github.com/team-telnyx/edge-compute/releases) v0.2.2+
- Node.js 18+
- A Telnyx phone number with a Call Control Application
- [API key](https://portal.telnyx.com/api-keys)

## Step 1: Scaffold the Project

This example is pre-scaffolded. To create a similar one from scratch:

```bash
telnyx-edge new-func --actor --name=edge-robo-call-screener
cd edge-robo-call-screener
npm install
```

## Step 2: Understand the Code

### `src/callScreener.ts` — The Stateful Actor

The `CallScreener` actor is instantiated once per screened phone number. Each instance has its own durable storage (blocklist, call history, stats).

```typescript
export class CallScreener extends StatefulActor {
  async recordCall(callControlId, from, to) {
    const record = { call_control_id: callControlId, from, to, status: "screening", answered_at: ... };
    await this.ctx.storage.put("calls", [record, ...await this.getCalls()].slice(0, 50));
  }

  async isBlocklisted(callerNumber) {
    const stats = await this.getStats();
    return stats.blocklist.includes(callerNumber);
  }

  async markBlocked(callControlId, verdict, confidence, reason, callerNumber) {
    // update call record + stats; add to blocklist if confidence >= 0.85
  }
}
```

### `src/index.ts` — The Fetch Handler

Routes HTTP requests to actor methods. Handles Telnyx voice webhooks:

```typescript
if (eventType === "call.answered") {
  if (await stub.isBlocklisted(from)) {
    await rejectCall(env, callControlId);  // instant reject
  } else {
    await answerCall(env, callControlId);
    await gatherUsingSpeak(env, callControlId, SCREENING_QUESTION);  // TTS + STT
  }
}

if (eventType === "call.gather.ended") {
  const judgment = await judgeResponse(env, transcript);  // AI Inference
  if (judgment.verdict === "robocall" && judgment.confidence >= 0.7) {
    await hangupCall(env, callControlId);
  } else {
    await transferCall(env, callControlId, env.FORWARD_TO_NUMBER);
  }
}
```

### `telnyx.toml` — Actor Binding

```toml
[[actors]]
binding = "CALL_SCREENER"   # property on env
type    = "CallScreener"    # the actor class

[edge_compute]
func_name = "edge-robo-call-screener"
```

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/webhooks/voice` | Telnyx voice webhook target |
| `GET` | `/stats` | Cumulative screening stats |
| `GET` | `/calls` | Recent call records |
| `POST` | `/blocklist/clear` | Clear the blocklist |
| `GET` | `/health/liveness` | Liveness probe |
| `GET` | `/health/readiness` | Readiness probe |

## Step 3: Deploy

### Configure secrets

```bash
telnyx-edge auth api-key set <YOUR_API_KEY>
telnyx-edge secrets add TELNYX_API_KEY "KEY0123..."
telnyx-edge secrets add TELNYX_PHONE_NUMBER "+18005551234"
telnyx-edge secrets add FORWARD_TO_NUMBER "+17175551234"
```

### Ship

```bash
npm install
telnyx-edge ship
```

`ship` prints a URL like `https://edge-robo-call-screener-<id>.telnyxcompute.com`.

### Wire the webhook

In the [Telnyx Portal](https://portal.telnyx.com/call-control/applications):
1. Create/edit a Call Control Application
2. Set Webhook URL → `https://<func>.telnyxcompute.com/webhooks/voice`
3. Assign your Telnyx number to this application

## Step 4: Test

### Poll health

```bash
curl -sS --retry 30 --retry-delay 5 \
  https://edge-robo-call-screener-<id>.telnyxcompute.com/health/liveness
```

### Call from your phone

Dial your Telnyx number. The app answers, asks "Who are you and why are you calling?", then:
- **Robocall detected** → hangs up
- **Legitimate** → forwards to your `FORWARD_TO_NUMBER`

### Check results

```bash
curl https://edge-robo-call-screener-<id>.telnyxcompute.com/stats
curl https://edge-robo-call-screener-<id>.telnyxcompute.com/calls
```

## Going to Production

- **Voice biometrics** — combine speech judgment with voice fingerprinting for stronger robocall detection
- **Custom questions** — rotate screening questions to avoid being fingerprinted by sophisticated bots
- **Whitelist** — auto-forward known good numbers (contacts, prior legitimate callers)
- **Multi-number** — each number gets its own actor instance automatically
- **Analytics** — export call stats to a dashboard for monitoring block rates
- **Rate limiting** — protect against webhook floods
- **Alarm-based callbacks** — use actor alarms to auto-hangup calls that don't respond within N seconds

## Run

```bash
npm install
telnyx-edge ship
```

## Resources

- [Source code and reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-robo-call-screener-typescript/README.md)
- [Stateful Actors Quick Start](https://developers.telnyx.com/docs/edge-compute/stateful-actors/quick-start)
- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
