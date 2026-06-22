# Chat With a Telnyx AI Assistant in Node.js

Build a production-ready Express endpoint that sends a user message to a Telnyx AI Assistant and returns its response.

## How It Works

```
  POST /chat  { "message": "..." }
        │
        ▼
  ┌──────────────────────┐
  │ Express (server.js)   │
  │  chatWithAssistant()  │
  └──────────┬───────────┘
             │  client.ai.assistants.chat(assistantId, {messages})
             ▼
  ┌──────────────────────┐
  │ Telnyx AI Assistant   │
  └──────────┬───────────┘
             │
             └──► assistant_response (JSON)
```

## Telnyx Products Used

- **AI Assistants** — conversational AI that runs on the Telnyx network

## API Endpoints

- **Chat with an Assistant**: `POST /v2/ai/assistants/{assistant_id}/chat` -- [API reference](https://developers.telnyx.com/api-reference/assistants/chat-with-an-assistant)

## Prerequisites

- Node.js 16+
- [Telnyx account](https://portal.telnyx.com/sign-up)
- [API key](https://portal.telnyx.com/api-keys)
- An existing [AI Assistant](https://portal.telnyx.com/ai/assistants) and its ID (create one with the [create-ai-assistant-nodejs](../create-ai-assistant-nodejs/) example)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/chat-with-ai-assistant-nodejs
cp .env.example .env
npm install
```

Edit `.env` with your Telnyx credentials:

```bash
TELNYX_API_KEY=KEY_your_telnyx_api_key_here
AI_ASSISTANT_ID=your_ai_assistant_id_here
PORT=5000
```

## Step 2: Understand the Code

Everything lives in `server.js`. Here's what each piece does.

### Client Initialization

The Telnyx SDK client is created once at startup from the API key in the environment:

```javascript
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });
```

### Helper Function

`chatWithAssistant(assistantId, message)` validates its inputs, calls the assistant, and returns a JSON-serializable object. SDK response objects are not directly serializable, so it pulls out `response.content`:

```javascript
async function chatWithAssistant(assistantId, message) {
  if (!assistantId) {
    throw new Error("AI_ASSISTANT_ID environment variable not set");
  }
  if (!message || message.trim().length === 0) {
    throw new Error("Message cannot be empty");
  }

  const response = await client.ai.assistants.chat(assistantId, {
    messages: [{ role: "user", content: message }],
  });

  return {
    assistant_id: assistantId,
    user_message: message,
    assistant_response: response.content,
    timestamp: new Date().toISOString(),
  };
}
```

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/chat` | Send a message to the assistant and return its response |
| `GET` | `/health` | Liveness check |

The `/chat` handler reads `message` from the request body, picks up `AI_ASSISTANT_ID` from the environment, and maps Telnyx SDK error types to HTTP status codes (401, 429, 500, 503), falling back to 400 for validation errors:

```javascript
app.post("/chat", async (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: "Missing required field: 'message'" });
  }
  try {
    const assistantId = process.env.AI_ASSISTANT_ID;
    const result = await chatWithAssistant(assistantId, message);
    return res.status(200).json(result);
  } catch (error) {
    // ... maps Telnyx error types to status codes
  }
});
```

## Step 3: Run It

```bash
node server.js
```

The server starts on `http://localhost:5000` (or `http://localhost:3000` if `PORT` is unset).

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Chat with the assistant:**

```bash
curl -X POST http://localhost:5000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What are your business hours?"}'
```

Expected response:

```json
{
  "assistant_id": "assistant-1234abcd",
  "user_message": "What are your business hours?",
  "assistant_response": "We are open Monday to Friday, 9am to 5pm.",
  "timestamp": "2026-06-18T14:32:00.000Z"
}
```

## Going to Production

- **Conversation memory** — this example sends a single `user` message per request. To hold context, persist prior turns and include them in the `messages` array.
- **Authentication** — add API key or token validation on `/chat`.
- **Rate limiting** — protect the endpoint and add exponential backoff for upstream 429s.
- **Monitoring** — add structured logging and alert on the `/health` endpoint.

## Run

```bash
npm install
node server.js
```

## Resources

- [Source code and reference](./README.md)
- [Typed API reference](./API.md)
- [AI Assistants Guide](https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx Portal](https://portal.telnyx.com)
