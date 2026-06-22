# Create Your First AI Assistant with Telnyx

Create a Telnyx AI Assistant over an HTTP endpoint using the Telnyx Node.js SDK and Express.

## How It Works

```
  POST /assistants/create
            │
            ▼
  ┌──────────────────────┐
  │  Express (server.js)  │
  │  createAssistant()    │
  └──────────┬───────────┘
             │ client.ai.assistants.create()
             ▼
  ┌──────────────────────┐
  │  Telnyx AI Assistants │
  └──────────┬───────────┘
             │
             └──► assistant id + config (JSON)
```

## Telnyx Products Used

- **AI Assistants** — create and configure LLM-backed assistants that can answer calls and messages

## API Endpoints

- **Create Assistant**: `POST /v2/ai/assistants` -- [API reference](https://developers.telnyx.com/api-reference/assistants/create-an-assistant)

## Prerequisites

- Node.js 16 or higher
- npm (Node package manager)
- [Telnyx account](https://portal.telnyx.com/sign-up)
- [API key](https://portal.telnyx.com/api-keys)
- A terminal and a code editor

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/create-ai-assistant-nodejs
cp .env.example .env
npm install
```

Edit `.env` and set your `TELNYX_API_KEY`. Optionally set `PORT` (the `.env.example` ships with `5000`; if unset the server defaults to `3000`).

## Step 2: Understand the Code

Everything lives in `server.js`. Here is what each piece does.

### Client Initialization

The Telnyx client is created once from the API key in your environment:

```javascript
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });
```

### Helper Function

- **`createAssistant(name, instructions, model, enabledFeatures)`** — validates the inputs, calls `client.ai.assistants.create()`, then extracts a JSON-serializable object from the SDK response (SDK objects are not directly JSON-serializable).

```javascript
const response = await client.ai.assistants.create({
  name: name,
  instructions: instructions,
  model: model,
  enabled_features: enabledFeatures,
});
```

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/assistants/create` | Create a new AI assistant |
| `GET` | `/health` | Health check |

The `POST /assistants/create` handler validates that `name`, `instructions`, `model`, and `enabled_features` are all present, then maps Telnyx SDK errors to clear HTTP status codes:

```javascript
app.post('/assistants/create', async (req, res) => {
  const { name, instructions, model, enabled_features } = req.body;
  if (!name || !instructions || !model || !enabled_features) {
    return res.status(400).json({
      error: 'Missing required fields: name, instructions, model, and enabled_features',
    });
  }
  // ...calls createAssistant() and returns 201 with the result
});
```

## Step 3: Run It

```bash
node server.js
```

The server starts on `http://localhost:5000` (or the `PORT` set in `.env`; `3000` if unset).

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Create an assistant:**

```bash
curl -X POST http://localhost:5000/assistants/create \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Support Bot",
    "instructions": "You are a friendly customer support agent for Acme Corp.",
    "model": "meta-llama/Meta-Llama-3.1-70B-Instruct",
    "enabled_features": ["telephony", "messaging"]
  }'
```

You should receive a `201` response containing the new assistant's `id` along with its stored configuration.

## Going to Production

- **Authentication** — add API key or token validation on `/assistants/create`
- **Validation** — confirm `model` against the list of Telnyx-supported models before creating
- **Monitoring** — add structured logging and alert on non-2xx responses
- **Rate limiting** — protect the endpoint from abuse and handle `429` responses with backoff

## Run

```bash
npm install
node server.js
```

## Resources

- [Source code and reference](./README.md)
- [Typed endpoint reference](./API.md)
- [AI Assistants Guide](https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant)
- [Create an Assistant — API Reference](https://developers.telnyx.com/api-reference/assistants/create-an-assistant)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx Portal](https://portal.telnyx.com)
