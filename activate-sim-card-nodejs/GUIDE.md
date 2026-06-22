# Activate a Telnyx IoT SIM Card with Node.js

Build a small Express API that retrieves and activates Telnyx IoT SIM cards using the Telnyx Node.js SDK.

## How It Works

```
  HTTP Request
        │
        ▼
  ┌──────────────────┐
  │  Express server   │
  │  (server.js)      │
  └────────┬─────────┘
           │  Telnyx Node SDK
           ▼
  ┌──────────────────┐
  │  Telnyx IoT SIM   │
  │  API              │
  └────────┬─────────┘
           │
           └──► SIM retrieved / activated
```

## Telnyx Products Used

- **IoT SIM** — provision and manage cellular connectivity programmatically

## API Endpoints

- **Get SIM Card**: `GET /v2/sim_cards/{id}` — [API reference](https://developers.telnyx.com/api-reference/sim-cards/get-sim-card)
- **Activate SIM Card**: `POST /v2/sim_cards/{id}/actions/enable` — [API reference](https://developers.telnyx.com/api-reference/sim-cards/enable-sim-card)

## Prerequisites

- Node.js 18+ and npm
- [Telnyx account](https://portal.telnyx.com/sign-up)
- [API key](https://portal.telnyx.com/api-keys)
- At least one SIM card in your Telnyx account (visible under IoT → SIM Cards)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/activate-sim-card-nodejs
cp .env.example .env
npm install
```

Edit `.env` and set `TELNYX_API_KEY` to the key from your [Telnyx Portal](https://portal.telnyx.com/api-keys). Optionally set `PORT` (defaults to `3000` in code; the provided `.env.example` uses `5000`).

## Step 2: Understand the Code

Everything lives in `server.js`. Here's what each piece does.

### Client initialization

The Telnyx SDK is constructed once from the API key:

```javascript
const client = new Telnyx({ apiKey: config.apiKey });
```

### Helper functions

- **`getSimCard(simCardId)`** — calls `client.simCards.retrieve(simCardId)` and returns a plain object (`id`, `iccid`, `status`, `simCardGroupId`, `phoneNumber`) so it serializes cleanly to JSON.
- **`activateSimCard(simCardId)`** — validates the ID is a non-empty string, then calls `client.simCards.actions.enable(simCardId)` and returns `id`, `iccid`, `status`, `simCardGroupId`, and `activatedAt`.
- **`handleError(error, res)`** — maps Telnyx SDK exceptions (`AuthenticationError`, `RateLimitError`, `APIError`, `APIConnectionError`) and the validation error to the right HTTP status codes, without leaking internals on unexpected errors.

### Routes

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/sim/:id` | Retrieve SIM card details |
| `POST` | `/sim/:id/activate` | Activate the SIM card |
| `GET` | `/health` | Liveness probe |

The activation route is thin — it delegates to the helper and formats the response:

```javascript
app.post('/sim/:id/activate', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await activateSimCard(id);
    res.status(200).json({
      message: 'SIM card activated successfully',
      sim: result,
    });
  } catch (error) {
    handleError(error, res);
  }
});
```

## Step 3: Run It

```bash
node server.js
```

The server logs the routes it serves and listens on the port from `PORT` (or `3000` if unset).

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Retrieve a SIM card:**

```bash
curl http://localhost:5000/sim/<sim_card_id>
```

**Activate a SIM card:**

```bash
curl -X POST http://localhost:5000/sim/<sim_card_id>/activate
```

A successful activation returns:

```json
{
  "message": "SIM card activated successfully",
  "sim": {
    "id": "<sim_card_id>",
    "iccid": "89310410106543789301",
    "status": "enabled",
    "simCardGroupId": "47a9c0fa-1d3b-4f2a-9e22-2c4e9a1b7d10",
    "activatedAt": "2026-06-18T12:00:00.000Z"
  }
}
```

## Going to Production

- **Authentication** — add API key or token validation on your endpoints.
- **Idempotency** — guard against repeat activation requests for the same SIM.
- **Retries** — add exponential backoff for `429` and transient `503` responses.
- **Monitoring** — add structured logging and alerts on the `/health` endpoint.

## Run

```bash
npm install
node server.js
```

## Resources

- [Source code and reference](./README.md)
- [Typed API reference](./API.md)
- [IoT SIM Get Started](https://developers.telnyx.com/docs/iot-sim/get-started)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx Portal](https://portal.telnyx.com)
