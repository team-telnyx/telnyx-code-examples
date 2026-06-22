# Set Up a SIP Trunk with Telnyx and Node.js

Create, retrieve, and list credential-authenticated SIP connections using the Telnyx SIP Trunking API and an Express server.

## How It Works

```
  API Request
        │
        ▼
  ┌──────────────────────┐
  │  Express server.js    │
  │  /sip/connections      │
  └──────────┬───────────┘
             │ telnyx SDK
             ▼
  ┌──────────────────────┐
  │  Telnyx SIP Trunking  │
  │  credential_connections│
  └──────────────────────┘
```

## Telnyx Products Used

- **SIP Trunking** — provision credential-authenticated SIP connections that route calls over the Telnyx private network

## API Endpoints

- **Create SIP Connection**: `POST /v2/sip_connections` -- [API reference](https://developers.telnyx.com/api/sip-trunking/create-credential-connection)
- **Retrieve SIP Connection**: `GET /v2/sip_connections/{id}` -- [API reference](https://developers.telnyx.com/api/sip-trunking/retrieve-credential-connection)
- **List SIP Connections**: `GET /v2/sip_connections` -- [API reference](https://developers.telnyx.com/api/sip-trunking/list-credential-connections)

## Prerequisites

- Node.js 14+
- [Telnyx account](https://portal.telnyx.com/sign-up)
- [API key](https://portal.telnyx.com/api-keys)
- A SIP endpoint (hostname or IP, e.g. your PBX/SBC) to point credentials at

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/setup-sip-trunk-nodejs
cp .env.example .env
npm install
```

Edit `.env` and set `TELNYX_API_KEY`. The provided `PORT=5000` controls which port the Express server listens on; remove it to fall back to `3000`.

## Step 2: Understand the Code

Everything lives in `server.js`. It initializes the Telnyx SDK client, defines three helper functions, and exposes three Express routes.

### Client Initialization

The client uses the SDK constructor pattern, reading the key from the environment:

```javascript
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });
```

### Helper Functions

- **`createSipConnection(name, username, password, endpoint)`** — Validates the four required fields and the endpoint format, then calls `client.credentialConnections.create(...)` with `authentication_type: "credential"`. Returns a JSON-serializable subset of the response.
- **`getSipConnection(connectionId)`** — Calls `client.credentialConnections.retrieve(id)` and returns the connection's id, name, status, and timestamps.
- **`listSipConnections()`** — Calls `client.credentialConnections.list()` and maps each connection to a compact object.

Because the SDK returns objects that are not directly JSON-serializable, each helper extracts only plain fields (id, name, status, timestamps) before returning.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/sip/connections` | Create a credential SIP connection |
| `GET` | `/sip/connections/:id` | Retrieve one connection by ID |
| `GET` | `/sip/connections` | List all connections |

Each route catches typed SDK errors and maps them to HTTP statuses — `AuthenticationError` → `401`, `RateLimitError` → `429`, `APIError` → the upstream status code, `APIConnectionError` → `503`, and validation errors → `400`.

## Step 3: Run It

```bash
node server.js
```

The server logs `SIP Trunking server running on http://localhost:5000` (using the `.env` `PORT`).

## Step 4: Test It

**Create a connection:**

```bash
curl -X POST http://localhost:5000/sip/connections \
  -H "Content-Type: application/json" \
  -d '{
    "name": "office-pbx",
    "username": "pbxuser01",
    "password": "s3cretp4ss",
    "endpoint": "sip.example.com:5060"
  }'
```

**Retrieve it** (use the `id` from the create response):

```bash
curl http://localhost:5000/sip/connections/1234567890
```

**List all connections:**

```bash
curl http://localhost:5000/sip/connections
```

## Going to Production

- **Authentication** — add API key or token validation on your own endpoints; the routes are unauthenticated as written.
- **Secrets** — keep `TELNYX_API_KEY` and SIP credentials out of source control; load them from a secrets manager.
- **Outbound voice profile** — the example sends `outbound_voice_profile_id: null`; assign a real profile before placing outbound calls.
- **Monitoring** — add structured logging and health checks around the SIP connection lifecycle.
- **Rate limiting** — protect your endpoints and respect Telnyx API limits with backoff.

## Run

```bash
npm install
node server.js
```

## Resources

- [Source code and reference](./README.md)
- [Typed endpoint reference](./API.md)
- [SIP Trunking Get Started](https://developers.telnyx.com/docs/voice/sip-trunking/get-started)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx Portal](https://portal.telnyx.com)
