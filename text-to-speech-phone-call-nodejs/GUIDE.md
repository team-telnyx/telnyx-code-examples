# Play a Text-to-Speech Message on a Phone Call with Telnyx

Initiate an outbound voice call and play a text-to-speech (TTS) message on answer using the Telnyx Call Control API and Node.js + Express.

## How It Works

```
  API Request (POST /calls/initiate)
        │
        ▼
  ┌──────────────────────┐
  │ Express server.js     │
  │  client.calls.dial()  │──────► Telnyx Voice (outbound call)
  └──────────┬───────────┘
             │
  Telnyx ────┘  webhook: call.answered
   POST /webhooks/call
             │
             ▼
  client.calls.actions.speak() ──► TTS audio played on the call
```

## Telnyx Products Used

- **Voice** — outbound calling and Call Control commands, including TTS playback

## API Endpoints

- **Dial (initiate call)**: `POST /v2/calls` -- [API reference](https://developers.telnyx.com/api-reference/call-commands/dial)
- **Speak text (TTS)**: `POST /v2/calls/{call_control_id}/actions/speak` -- [API reference](https://developers.telnyx.com/api-reference/call-commands/speak-text)

## Prerequisites

- Node.js 14+ and npm
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) enabled for voice
- A [Call Control Application](https://portal.telnyx.com/call-control/applications) with a connection ID and webhook URL
- [ngrok](https://ngrok.com) (or similar) to expose your local server to Telnyx webhooks

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/text-to-speech-phone-call-nodejs
cp .env.example .env
npm install
```

Edit `.env` with your Telnyx credentials. You need `TELNYX_API_KEY`, `TELNYX_PHONE_NUMBER`, and `TELNYX_CONNECTION_ID` at minimum.

## Step 2: Understand the Code

Everything lives in `server.js`. Here's what each piece does.

### Helper Functions

- **`initiateCall(toNumber)`** — Validates the destination is E.164 and dials an outbound call with `client.calls.dial()`, returning the `call_control_id`, `from`, and `to`.
- **`playTTS(callControlId, message, language)`** — Plays a TTS message on an active call with `client.calls.actions.speak()`, using a `female` voice and the given `language` (default `en-US`).

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/calls/initiate` | Initiate an outbound call |
| `POST` | `/calls/:callControlId/speak` | Play TTS on an active call |
| `POST` | `/webhooks/call` | Receive Call Control events; auto-play TTS on answer |
| `GET`  | `/health` | Health check |

The trigger endpoint kicks off the workflow:

```javascript
app.post("/calls/initiate", async (req, res) => {
  const { to, message } = req.body;

  if (!to || !message) {
    return res
      .status(400)
      .json({ error: "Missing required fields: 'to' and 'message'" });
  }

  try {
    const callData = await initiateCall(to);
    return res.status(200).json(callData);
  } catch (error) {
    // ... typed Telnyx error handling ...
  }
});
```

The webhook handler reacts to call events and speaks automatically on answer:

```javascript
app.post("/webhooks/call", express.raw({ type: "*/*" }), async (req, res) => {
  // Verify the Telnyx Ed25519 signature over the EXACT raw bytes before parsing.
  if (!verifyTelnyxSignature(req.body.toString(), req.headers)) {
    return res.status(401).json({ error: "invalid signature" });
  }

  const event = JSON.parse(req.body.toString()).data;
  const payload = event.payload || {};

  if (event.event_type === "call.answered") {
    const callControlId = payload.call_control_id;
    const message =
      "Hello! This is a text-to-speech message from Telnyx. Thank you for calling.";
    await playTTS(callControlId, message);
  }

  return res.status(200).json({ status: "received" });
});
```

## Step 3: Run It

```bash
node server.js
```

The server starts on the port from `PORT` (the `.env.example` sets `5000`), or `3000` if unset.

In a separate terminal, expose your server for webhooks:

```bash
ngrok http 5000
```

Copy the HTTPS URL and set it in the [Telnyx Portal](https://portal.telnyx.com):

- **Call Control Application** → Webhook URL → `https://<id>.ngrok.io/webhooks/call`

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Initiate a call:**

```bash
curl -X POST http://localhost:5000/calls/initiate \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+12125551234",
    "message": "Hello from Telnyx!"
  }'
```

When the call is answered, Telnyx posts a `call.answered` event to `/webhooks/call` and the server plays the TTS greeting automatically. To speak again on the same call, use the returned `call_control_id`:

```bash
curl -X POST http://localhost:5000/calls/v2:abc123.../speak \
  -H "Content-Type: application/json" \
  -d '{"message": "Your appointment is confirmed.", "language": "en-US"}'
```

## Going to Production

- **Webhook verification** — validate Telnyx webhook signatures ([docs](https://developers.telnyx.com/docs/api/v2/overview#webhook-signing))
- **Authentication** — add API key validation on your `/calls/*` endpoints
- **Monitoring** — add structured logging and health check alerts
- **Rate limiting** — protect your endpoints from abuse

## Run

```bash
npm install
node server.js
```

## Resources

- [Source code and reference](./README.md)
- [Typed API reference](./API.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Voice API Overview](https://developers.telnyx.com/docs/voice)
- [Speak Text API reference](https://developers.telnyx.com/api-reference/call-commands/speak-text)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx Portal](https://portal.telnyx.com)
