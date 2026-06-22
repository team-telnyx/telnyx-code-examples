# Build an IVR Phone Menu with Telnyx and Express

Build a production-ready Interactive Voice Response (IVR) system using the Telnyx Voice API and Express.js. The app answers inbound calls, plays a menu with text-to-speech, collects a single DTMF digit, and routes the caller to sales or support — or repeats the menu.

## How It Works

```
  Inbound Phone Call
        │
        ▼
  ┌──────────────────────┐
  │ Telnyx Call Control   │
  └─────────┬────────────┘
            │ webhooks
            ▼
  ┌──────────────────────┐
  │ Express app           │
  └─────────┬────────────┘
            │
  call.initiated ──► answer ──► gather_using_speak (menu + DTMF)
  dtmf.received  ──► transfer / repeat / retry
  call.hangup    ──► clean up call state
```

## Telnyx Products Used

- **Voice** — programmatic Call Control with webhooks for every call state change (answer, speak, gather DTMF, transfer).

## API Endpoints

- **Answer Call**: `POST /v2/calls/{call_control_id}/actions/answer` — [API reference](https://developers.telnyx.com/api/call-control/answer-call)
- **Speak Text (TTS)**: `POST /v2/calls/{call_control_id}/actions/speak` — [API reference](https://developers.telnyx.com/api/call-control/speak)
- **Gather Using Speak**: `POST /v2/calls/{call_control_id}/actions/gather_using_speak` — [API reference](https://developers.telnyx.com/api/call-control/gather-using-speak)
- **Transfer Call**: `POST /v2/calls/{call_control_id}/actions/transfer` — [API reference](https://developers.telnyx.com/api/call-control/transfer-call)

## Webhook Events

Telnyx drives Call Control through webhooks — you do not poll for state. Each event tells you what happened; your handler issues the next action. This app handles:

- `call.initiated` — inbound call arrived; answer it and play the menu
- `call.dtmf.received` — caller pressed a digit; route the call
- `call.hangup` — call ended; clean up its in-memory state

## Prerequisites

- Node.js 18+ (Node 20 LTS recommended)
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) with voice enabled
- [Call Control Application](https://portal.telnyx.com/call-control/applications) configured with your webhook URL
- [ngrok](https://ngrok.com) for exposing your local server to Telnyx webhooks

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-ivr-phone-menu-nodejs
cp .env.example .env
npm install
```

Edit `.env` with your Telnyx credentials:

```
TELNYX_API_KEY=KEY_your_telnyx_api_key_here
PORT=5000
WEBHOOK_URL=https://your-domain.com/webhook
```

## Step 2: Understand the Code

Everything lives in `server.js`. It is an Express app that initializes the Telnyx SDK and keeps per-call state in an in-memory `Map` (use Redis in production).

### Helper Functions

- **`answerAndGreet(callControlId)`** — Answers the call with `telnyx.calls.actions.answer`, stores call state, then speaks the menu greeting and collects a single digit in one command with `telnyx.calls.actions.gatherUsingSpeak` (`maximum_digits: 1`, `timeout_millis: 5000`).
- **`routeMenuSelection(callControlId, digit)`** — Branches on the pressed digit: `1` transfers to sales, `2` transfers to support, `3` repeats the menu and gathers again, and any other digit speaks "Invalid selection" before gathering again.
- **`cleanupCallState(callControlId)`** — Removes the call from the in-memory `Map` when the call ends.

### Webhook Routes

| Method | Path | Event | Purpose |
|--------|------|-------|---------|
| `POST` | `/webhooks/call-initiated` | `call.initiated` | Answer and play the menu |
| `POST` | `/webhooks/dtmf-received` | `call.dtmf.received` | Route the call by digit |
| `POST` | `/webhooks/call-hangup` | `call.hangup` | Clean up call state |
| `GET` | `/health` | — | Health check |

The greeting handler is the entry point. On `call.initiated` it answers, speaks the menu, and begins gathering DTMF:

```javascript
async function answerAndGreet(callControlId) {
  await telnyx.calls.actions.answer(callControlId);
  callState.set(callControlId, { status: "greeting", menuLevel: "main", createdAt: Date.now() });
  // Speak the greeting prompt and collect DTMF input in one command.
  await telnyx.calls.actions.gatherUsingSpeak(callControlId, {
    payload: "Welcome to our IVR system. Press 1 for sales, 2 for support, or 3 to repeat this menu.",
    voice: "male",
    language: "en-US",
    maximum_digits: 1,
    timeout_millis: 5000,
  });
}
```

When the caller presses a key, `routeMenuSelection` transfers or replays the menu:

```javascript
switch (digit) {
  case "1":
    await telnyx.calls.actions.speak(callControlId, { payload: "Transferring you to our sales team. Please hold.", voice: "male", language: "en-US" });
    await telnyx.calls.actions.transfer(callControlId, { to: "+15559876543" });
    break;
  // ...
}
```

Update the hardcoded sales (`+15559876543`) and support (`+15559876544`) numbers in `server.js` to your own destinations.

## Step 3: Run It

```bash
node server.js
```

The server starts on `http://localhost:5000` (or the value of `PORT`).

In a separate terminal, expose your server for webhooks:

```bash
ngrok http 5000
```

Copy the HTTPS URL and set it in the [Telnyx Portal](https://portal.telnyx.com):

- **Call Control Application** → Webhook URL → `https://<id>.ngrok.io/webhooks/call-initiated`

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Simulate an inbound call webhook:**

```bash
curl -X POST http://localhost:5000/webhooks/call-initiated \
  -H "Content-Type: application/json" \
  -d '{"data": {"event_type": "call.initiated", "payload": {"call_control_id": "v3:test"}}}'
```

**Simulate a digit press:**

```bash
curl -X POST http://localhost:5000/webhooks/dtmf-received \
  -H "Content-Type: application/json" \
  -d '{"data": {"event_type": "call.dtmf.received", "payload": {"call_control_id": "v3:test", "dtmf": {"digits": "1"}}}}'
```

Or call your Telnyx number from any phone to exercise the full voice workflow end to end.

## Going to Production

This example uses in-memory storage for simplicity. For production:

- **Database** — replace the in-memory `Map` with Redis or PostgreSQL so state survives restarts and scales across instances
- **Single webhook path** — route all events to one endpoint and branch on `event_type` to match a standard Call Control Application config
- **Webhook verification** — validate Telnyx webhook signatures ([docs](https://developers.telnyx.com/docs/api/v2/overview#webhook-signing))
- **Configurable routing** — move sales/support numbers and menu text out of code into config or environment variables
- **Monitoring** — add structured logging and alert on the `/health` endpoint
- **Rate limiting** — protect your endpoints from abuse

## Run

```bash
npm install
node server.js
```

## Resources

- [Source code and reference](./README.md)
- [Typed endpoint reference](./API.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Call Control quickstart](https://developers.telnyx.com/docs/voice/call-control)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx Portal](https://portal.telnyx.com)
