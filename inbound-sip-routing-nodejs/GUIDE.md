# Inbound SIP Routing with Telnyx and Node.js

Create and manage Telnyx SIP connections for inbound call routing, and receive inbound call webhooks, using Node.js and Express.

## How It Works

```
  HTTP client                          Inbound PSTN call
       │                                       │
       ▼                                       ▼
  ┌──────────────────────┐            ┌──────────────────┐
  │ Express app          │            │ Telnyx Voice/SIP  │
  │ /sip/connections     │            └────────┬─────────┘
  │ /sip/connections/:id │                     │
  └──────────┬───────────┘                     │ webhook
             │                                  ▼
             │ SDK call            ┌────────────────────────────┐
             ▼                     │ POST /webhooks/inbound-call │
  ┌──────────────────┐            └────────────────────────────┘
  │ Telnyx SIP API    │
  └──────────────────┘
```

## Telnyx Products Used

- **SIP Trunking** — create and manage SIP connections that route calls to your endpoint
- **Voice** — deliver inbound call events over webhooks

## API Endpoints

- **Create SIP Connection**: `POST /v2/sip_connections` -- [API reference](https://developers.telnyx.com/api/sip-trunking/create-credential-connection)
- **List SIP Connections**: `GET /v2/sip_connections` -- [API reference](https://developers.telnyx.com/api/sip-trunking/list-credential-connections)
- **Retrieve SIP Connection**: `GET /v2/sip_connections/{id}` -- [API reference](https://developers.telnyx.com/api/sip-trunking/retrieve-credential-connection)

## Prerequisites

- Node.js 14+ and npm
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)
- A SIP endpoint (URI, username, password) that inbound calls should route to
- [ngrok](https://ngrok.com) for exposing your local server to Telnyx webhooks

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/inbound-sip-routing-nodejs
cp .env.example .env
npm install
```

Edit `.env` with your Telnyx API key and SIP credentials:

- `TELNYX_API_KEY` — from the [Telnyx Portal](https://portal.telnyx.com/api-keys)
- `SIP_ENDPOINT` — the inbound SIP URI calls route to
- `SIP_USERNAME` / `SIP_PASSWORD` — inbound authentication credentials
- `PORT` — server port (the example uses `5000`)
- `WEBHOOK_URL` — public base URL logged at startup

## Step 2: Understand the Code

Everything lives in `server.js`. The Telnyx client is initialized once from the API key:

```javascript
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });
```

### Helper Functions

- **`createSipConnection(connectionName)`** — calls `client.credentialConnections.create()` with the connection name plus the inbound URI and authentication from the environment, then returns a JSON-serializable subset of the response.
- **`listSipConnections()`** — calls `client.credentialConnections.list()` and maps each connection to a plain object.
- **`getSipConnection(connectionId)`** — calls `client.credentialConnections.retrieve(id)` and returns the connection, including the inbound authentication username.

The helpers extract only serializable fields because SDK response objects are not directly JSON-serializable.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/sip/connections` | Create a SIP connection |
| `GET` | `/sip/connections` | List all SIP connections |
| `GET` | `/sip/connections/:id` | Retrieve one SIP connection |
| `POST` | `/webhooks/inbound-call` | Receive inbound call webhooks |

The create endpoint validates input, calls the helper, and maps Telnyx SDK errors to HTTP status codes:

```javascript
app.post("/sip/connections", async (req, res) => {
  const { connection_name } = req.body;

  if (!connection_name) {
    return res.status(400).json({ error: "Missing required field: connection_name" });
  }

  try {
    const result = await createSipConnection(connection_name);
    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    // ... rate limit, status, connection, and generic 500 handling
  }
});
```

The webhook handler verifies the Telnyx signature against the raw request body, then logs the call event fields and acknowledges immediately:

```javascript
app.post("/webhooks/inbound-call", async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
  if (!verifyTelnyxSignature(rawBody.toString(), req.headers)) {
    return res.status(401).json({ error: "invalid signature" });
  }
  const event = JSON.parse(rawBody.toString());
  console.log("Inbound call event received:", {
    event_type: event.data?.event_type,
    call_session_id: event.data?.payload?.call_session_id,
    from: event.data?.payload?.from,
    to: event.data?.payload?.to,
    timestamp: event.data?.occurred_at,
  });
  res.status(200).json({ status: "received" });
});
```

## Step 3: Run It

```bash
node server.js
```

The server starts on `http://localhost:5000` (the port from `.env`; it falls back to `3000` if `PORT` is unset).

In a separate terminal, expose your server for webhooks:

```bash
ngrok http 5000
```

Copy the HTTPS URL and set it in the [Telnyx Portal](https://portal.telnyx.com):

- **Voice / SIP Connection** → Inbound Webhook URL → `https://<id>.ngrok.io/webhooks/inbound-call`

## Step 4: Test It

**Create a SIP connection:**

```bash
curl -X POST http://localhost:5000/sip/connections \
  -H "Content-Type: application/json" \
  -d '{"connection_name": "inbound-routing-prod"}'
```

**List connections:**

```bash
curl http://localhost:5000/sip/connections
```

**Retrieve one connection:**

```bash
curl http://localhost:5000/sip/connections/1234567890
```

Then place a call to a Telnyx number linked to the connection and watch the inbound-call webhook log in your server terminal.

## Going to Production

This example logs webhook events to stdout. For production:

- **Webhook verification** — validate Telnyx webhook signatures ([docs](https://developers.telnyx.com/docs/api/v2/overview#webhook-signing))
- **Authentication** — add API key or token validation on the `/sip/connections` routes
- **Persistence** — store connection metadata and call events in a database
- **Monitoring** — add structured logging and alerting on webhook delivery
- **Rate limiting** — protect the management endpoints from abuse

## Run

```bash
npm install
node server.js
```

## Resources

- [Source code and reference](./README.md)
- [SIP Trunking Get Started](https://developers.telnyx.com/docs/voice/sip-trunking/get-started)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx Portal](https://portal.telnyx.com)
