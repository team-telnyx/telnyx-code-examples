# Make Your First Outbound Call with Telnyx

Initiate an outbound phone call using the Telnyx Call Control API. This guide walks through an Express server that exposes a single endpoint, dials a number through Telnyx, and returns the call control ID.

## How It Works

```
  POST /calls/dial
        │
        ▼
  ┌──────────────────┐
  │  Express server   │
  │  initiateCall()   │
  └────────┬─────────┘
           │  client.calls.dial()
           ▼
  ┌──────────────────┐
  │  Telnyx Voice     │
  │  (Call Control)   │
  └────────┬─────────┘
           │
           └──► Outbound call placed → call_control_id returned
```

## Telnyx Products Used

- **Voice (Call Control)** — programmatically dial outbound calls and control them via a Call Control Application

## API Endpoints

- **Dial**: `POST /v2/calls` -- [API reference](https://developers.telnyx.com/api-reference/call-commands/dial)

## Prerequisites

- Node.js 14+ and npm
- [Telnyx account](https://portal.telnyx.com/sign-up) with a funded balance
- [API key](https://portal.telnyx.com/api-keys)
- A [Telnyx phone number](https://portal.telnyx.com/numbers/my-numbers) enabled for voice
- A [Call Control Application](https://portal.telnyx.com/call-control/applications) (its ID is your connection ID)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/make-outbound-phone-call-nodejs
cp .env.example .env
npm install
```

Edit `.env` with your Telnyx credentials:

| Variable | Description |
|----------|-------------|
| `TELNYX_API_KEY` | Your Telnyx API v2 key |
| `TELNYX_PHONE_NUMBER` | The Telnyx number you dial from (E.164) |
| `TELNYX_CONNECTION_ID` | Your Call Control Application ID |
| `PORT` | Optional; defaults to `5000` |

## Step 2: Understand the Code

Everything lives in `server.js`. The Telnyx client is created once with the API key from the environment:

```javascript
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });
```

### `initiateCall(toNumber)`

A helper that validates inputs and places the call. It reads `TELNYX_PHONE_NUMBER` and `TELNYX_CONNECTION_ID` from the environment, enforces E.164 formatting on the destination, then calls `client.calls.dial()`:

```javascript
const response = await client.calls.dial({
  from: fromNumber,
  to: toNumber,
  connection_id: connectionId,
});
```

The `connection_id` is required — it links the call to your Call Control Application. The `call_control_id` is returned in the response (you never pass it in). Because SDK objects are not JSON-serializable, the helper returns a plain object:

```javascript
return {
  call_control_id: response.data.call_control_id,
  from: fromNumber,
  to: toNumber,
  state: "initiated",
};
```

### `POST /calls/dial`

The route reads `to` from the JSON body, returns `400` if it is missing, otherwise calls `initiateCall()`. Telnyx SDK exceptions are mapped to clean HTTP statuses so internal details never leak:

| SDK error | HTTP status | Body |
|-----------|-------------|------|
| `AuthenticationError` | `401` | `Invalid API key` |
| `RateLimitError` | `429` | `Rate limit exceeded...` |
| `APIError` | upstream `status_code` | upstream message + `status_code` |
| `APIConnectionError` | `503` | `Network error connecting to Telnyx` |
| other `Error` (validation) | `400` | the error message |

## Step 3: Run It

```bash
node server.js
```

The server starts on `http://localhost:5000` (or the `PORT` you set).

## Step 4: Test It

Place a call:

```bash
curl -X POST http://localhost:5000/calls/dial \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125551234"}'
```

Successful response:

```json
{
  "call_control_id": "v3:abc123def456...",
  "from": "+15551234567",
  "to": "+12125551234",
  "state": "initiated"
}
```

## Going to Production

- **Webhook handling** — register a webhook URL on your Call Control Application to receive call lifecycle events (`call.answered`, `call.hangup`, etc.) and drive the rest of the call flow.
- **Webhook verification** — validate Telnyx webhook signatures ([docs](https://developers.telnyx.com/docs/api/v2/overview#webhook-signing)).
- **Authentication** — add API key or token validation on your `/calls/dial` endpoint.
- **Monitoring** — add structured logging and alerting around dial failures.
- **Rate limiting** — protect the endpoint from abuse.

## Run

```bash
npm install
node server.js
```

## Resources

- [Source code and reference](./README.md)
- [Typed API reference](./API.md)
- [Voice / Call Control Guide](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-commands-and-resources)
- [Dial API Reference](https://developers.telnyx.com/api-reference/call-commands/dial)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx Portal](https://portal.telnyx.com)
