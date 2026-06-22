# Record Phone Calls with Telnyx and Express

Initiate outbound calls and control call recording using the Telnyx Voice API with Express. This guide walks through building and running the example end to end.

## How It Works

```
  API Request
        │
        ▼
  ┌──────────────────────┐
  │  Express (server.js)  │
  │  activeCalls Map      │
  └──────────┬───────────┘
             │  dial / record_start / record_stop
             ▼
  ┌──────────────────────┐
  │   Telnyx Voice API    │
  └──────────┬───────────┘
             │  call.answered / call.hangup
             │  call.recording.saved
             ▼
   POST /webhooks/call
```

## Telnyx Products Used

- **Voice / Call Control** — programmatically dial calls and start/stop recordings, with webhooks for the call lifecycle.

## API Endpoints

- **Dial**: `POST /v2/calls` -- [API reference](https://developers.telnyx.com/api-reference/call-commands/dial)
- **Start recording**: `POST /v2/calls/{call_control_id}/actions/record_start` -- [API reference](https://developers.telnyx.com/api-reference/call-commands/recording-start)
- **Stop recording**: `POST /v2/calls/{call_control_id}/actions/record_stop` -- [API reference](https://developers.telnyx.com/api-reference/call-commands/recording-stop)

## Prerequisites

- Node.js 18+ (Node.js 20 LTS recommended)
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) enabled for outbound voice
- A [Call Control Application](https://portal.telnyx.com/call-control/applications) (its connection ID)
- [ngrok](https://ngrok.com) to expose your local server to Telnyx webhooks

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/record-phone-calls-nodejs
cp .env.example .env
npm install
```

Edit `.env` with your Telnyx credentials:

```
TELNYX_API_KEY=KEY_your_telnyx_api_key_here
PORT=5000
TELNYX_CONNECTION_ID=your_connection_id_here
TELNYX_PHONE_NUMBER=+15551234567
WEBHOOK_URL=https://your-domain.com/webhook
```

## Step 2: Understand the Code

Everything lives in `server.js`. The Telnyx client is initialized once, and an in-memory `Map` tracks active calls.

```javascript
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });
const activeCalls = new Map();
```

### Helper Functions

- **`initiateCall(toNumber)`** — validates `TELNYX_PHONE_NUMBER`, `TELNYX_CONNECTION_ID`, and E.164 format, then calls `client.calls.dial()`. Stores the returned `call_control_id` in `activeCalls`.
- **`startRecording(callControlId)`** — calls `client.calls.actions.startRecording()` with `format: "wav"` and records the `recording_id`.
- **`stopRecording(callControlId)`** — calls `client.calls.actions.stopRecording()` and marks the recording `stopped`.
- **`getCallStatus(callControlId)`** — returns the tracked call and recording state from the in-memory map.

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/calls/initiate` | Initiate an outbound call |
| `POST` | `/calls/:callControlId/recording/start` | Start recording |
| `POST` | `/calls/:callControlId/recording/stop` | Stop recording |
| `GET` | `/calls/:callControlId/status` | Read call + recording status |
| `POST` | `/webhooks/call` | Receive Telnyx call lifecycle events |

The dial endpoint kicks off the workflow:

```javascript
app.post("/calls/initiate", async (req, res) => {
  const { to } = req.body;
  if (!to) {
    return res.status(400).json({ error: "Missing required field: 'to'" });
  }
  const result = await initiateCall(to);
  return res.status(200).json(result);
});
```

The webhook handler advances state as the call progresses. On `call.answered` it is safe to start recording; on `call.recording.saved` the WAV download URL becomes available; on `call.hangup` the call is removed from the store.

## Step 3: Run It

```bash
node server.js
```

The server starts on `http://localhost:5000` (or `$PORT`).

In a separate terminal, expose your server so Telnyx can reach the webhook:

```bash
ngrok http 5000
```

Copy the HTTPS URL and set it on your [Call Control Application](https://portal.telnyx.com/call-control/applications):

- **Webhook URL** → `https://<id>.ngrok.io/webhooks/call`

## Step 4: Test It

**Initiate a call:**

```bash
curl -X POST http://localhost:5000/calls/initiate \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125559999"}'
```

Note the `call_control_id` from the response. Once the call is answered (watch for the `call.answered` webhook), start recording:

```bash
curl -X POST http://localhost:5000/calls/<call_control_id>/recording/start
```

Stop it when finished:

```bash
curl -X POST http://localhost:5000/calls/<call_control_id>/recording/stop
```

Check status at any point:

```bash
curl http://localhost:5000/calls/<call_control_id>/status
```

When the recording is saved, Telnyx posts a `call.recording.saved` event to `/webhooks/call` containing the WAV download URL.

## Going to Production

This example uses in-memory storage for simplicity. For production:

- **Database** — replace the in-memory `Map` with PostgreSQL or Redis so call state survives restarts and scales across instances.
- **Webhook verification** — validate Telnyx webhook signatures ([docs](https://developers.telnyx.com/docs/api/v2/overview#webhook-signing)).
- **Authentication** — add API key validation on your control endpoints.
- **Storage** — persist or forward the saved recording WAV URL to durable cloud storage.
- **Monitoring** — add structured logging and alerting on webhook delivery.

## Run

```bash
npm install
node server.js
```

## Resources

- [Source code and reference](./README.md)
- [Typed endpoint reference](./API.md)
- [Voice API Overview](https://developers.telnyx.com/docs/voice)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx Portal](https://portal.telnyx.com)
