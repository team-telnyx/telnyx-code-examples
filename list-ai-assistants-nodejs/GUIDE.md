# List Your Telnyx AI Assistants with Node.js

List all AI assistants in your Telnyx account using the Telnyx Node.js SDK and an Express endpoint.

## How It Works

```
  GET /assistants
        │
        ▼
  ┌──────────────────┐
  │  Express server   │
  │   (server.js)     │
  └────────┬─────────┘
           │ client.ai.assistants.list()
           ▼
  ┌──────────────────┐
  │ Telnyx AI         │
  │ Assistants API    │
  └────────┬─────────┘
           │
           └──► JSON array of assistants
```

## Telnyx Products Used

- **AI Assistants** — create and operate LLM-backed assistants over the Telnyx API

## API Endpoints

- **List Assistants**: `GET /v2/ai/assistants` -- [API reference](https://developers.telnyx.com/api-reference/assistants/get-assistants)

## Prerequisites

- Node.js 18+ (Node.js 20 LTS recommended)
- npm
- [Telnyx account](https://portal.telnyx.com/sign-up)
- [API key](https://portal.telnyx.com/api-keys)
- curl or Postman for testing the HTTP endpoints

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/list-ai-assistants-nodejs
cp .env.example .env
npm install
```

Edit `.env` and set your `TELNYX_API_KEY`. The `PORT` variable is optional — `.env.example` ships with `PORT=5000`, and the server falls back to `3000` if it is unset.

## Step 2: Understand the Code

Everything lives in `server.js`. Here is what each piece does.

### Initialize the client

The Telnyx client is constructed once from the API key in the environment, and `express.json()` is registered so the server can parse JSON bodies.

```javascript
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });
app.use(express.json());
```

### Helper function

`listAssistants()` calls the Telnyx API and maps each SDK object down to a plain, JSON-serializable object. SDK response objects are not directly serializable, so unpacking the fields you need is required.

```javascript
async function listAssistants() {
  const response = await client.ai.assistants.list();
  return response.data.map((assistant) => ({
    id: assistant.id,
    name: assistant.name,
    model: assistant.model,
    instructions: assistant.instructions,
    enabled_features: assistant.enabled_features,
    created_at: assistant.created_at,
  }));
}
```

### Routes

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/assistants` | List all AI assistants |
| `GET` | `/health` | Liveness check |

The `/assistants` handler wraps the helper in a `try/catch` and maps Telnyx SDK errors to HTTP status codes:

```javascript
app.get("/assistants", async (req, res) => {
  try {
    const assistants = await listAssistants();
    res.status(200).json({
      success: true,
      count: assistants.length,
      data: assistants,
    });
  } catch (error) {
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({
        error: "Invalid API key. Verify TELNYX_API_KEY in your environment.",
      });
    }
    // ...RateLimitError → 429, APIError → error.status, APIConnectionError → 503
  }
});
```

## Step 3: Run It

```bash
node server.js
```

The server starts on `http://localhost:5000` (per `.env.example`) and prints the curl commands for the running port.

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**List assistants:**

```bash
curl http://localhost:5000/assistants
```

A successful response looks like:

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "id": "assistant-f5d7a7e0-1234-5678",
      "name": "Support Bot",
      "model": "meta-llama/Llama-3.3-70B-Instruct",
      "instructions": "You are a helpful support assistant.",
      "enabled_features": ["telephony"],
      "created_at": "2025-01-15T12:00:00Z"
    }
  ]
}
```

If `count` is `0`, you have no assistants yet — create one in the [Telnyx Portal](https://portal.telnyx.com) or with the Create Assistant API, then retry.

## Going to Production

- **Authentication** — add API key or token validation on your endpoints before exposing them publicly.
- **Caching** — cache the assistant list if you call it frequently to stay under rate limits.
- **Monitoring** — add structured logging and alert on the `/health` endpoint.
- **Pagination** — for large accounts, page through results rather than assuming a single response holds everything.

## Run

```bash
npm install
node server.js
```

## Resources

- [Source code and reference](./README.md)
- [Typed endpoint reference](./API.md)
- [AI Assistants Guide](https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant)
- [List Assistants API Reference](https://developers.telnyx.com/api-reference/assistants/get-assistants)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx Portal](https://portal.telnyx.com)
