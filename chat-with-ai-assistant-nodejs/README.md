# Chat With AI Assistant with Node.js and Express

## What Does This Example Do?

Build a production-ready Express endpoint that enables real-time chat interactions with Telnyx AI Assistants. This tutorial demonstrates the Node.js SDK client initialization pattern, proper error handling for AI API calls, and secure credential management via environment variables. You'll create a conversational interface where users can send messages and receive intelligent responses from a configured AI assistant.

## Who Is This For?

- **Node.js developers** building ai features with Express.
- **Backend engineers** integrating telephony or messaging into existing applications.
- **DevOps teams** looking for containerized, production-ready telecom examples.
- **Startups and enterprises** replacing legacy telecom providers with a modern API-first platform.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform that gives developers a single API for [voice](https://telnyx.com/products/voice-ai-agents), [messaging](https://telnyx.com/products/sms-api), [SIP](https://telnyx.com/products/sip-trunks), [AI](https://telnyx.com/ai-assistants), and [IoT](https://telnyx.com/products/iot-sim-card) — no Frankenstack required.

- **Integrated platform** — [Voice](https://telnyx.com/products/voice-ai-agents), [SMS](https://telnyx.com/products/sms-api), [SIP trunking](https://telnyx.com/products/sip-trunks), [AI assistants](https://telnyx.com/ai-assistants), and [IoT SIM management](https://telnyx.com/products/iot-sim-card) under one roof. No stitching together multiple vendors.
- **Global private network** — Calls and messages traverse the Telnyx-owned IP network for lower latency and higher reliability than the public internet.
- **Developer-first** — SDKs for Python, Node.js, Go, Ruby, Java, and PHP. Comprehensive webhook event model. Sandbox environment for testing.
- **Competitive pricing** — Pay-as-you-go with no minimums, contracts, or per-seat fees.

## Prerequisites

- Node.js 16 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- An existing AI Assistant configured in your Telnyx account (or create one using the [Create AI Assistant](/tutorials/ai/nodejs/create-ai-assistant) tutorial).
- npm (Node package manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/chat-with-ai-assistant-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/chat-with-ai-assistant-nodejs
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` and initialize the Telnyx client using the Node.js SDK pattern. Define a helper function to handle chat interactions with proper validation:

```javascript
const Telnyx = require("telnyx");
const express = require("express");
require("dotenv").config();

const app = express();
app.use(express.json());

// Initialize client with the SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

/**
 * Send a message to an AI Assistant and retrieve the response.
 * @param {string} assistantId - The ID of the AI Assistant.
 * @param {string} message - The user's message.
 * @returns {Promise<Object>} JSON-serializable response data.
 */
async function chatWithAssistant(assistantId, message) {
  if (!assistantId) {
    throw new Error("AI_ASSISTANT_ID environment variable not set");
  }

  if (!message || message.trim().length === 0) {
    throw new Error("Message cannot be empty");
  }

  // Use client.ai_assistants.chat() to send message and get response
  const response = await client.ai_assistants.chat(assistantId, {
    messages: [
      {
        role: "user",
        content: message,
      },
    ],
  });

  // Extract serializable data — SDK objects are NOT JSON-serializable
  return {
    assistant_id: assistantId,
    user_message: message,
    assistant_response: response.data.result,
    timestamp: new Date().toISOString(),
  };
}
```

## Complete Code

See [`server.js`](./server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Node.js server. |
| Assistant ID Not Found | You receive a 404 error or "Assistant not found" message from the API. | Confirm your `AI_ASSISTANT_ID` in the `.env` file is correct and matches an existing assistant in your Telnyx account. You can list all assistants using the [List AI Assistants](/tutorials/ai/nodejs/list-ai-assistants) endpoint to verify the ID. |
| Environment Variable Not Set | The application raises an error stating "AI_ASSISTANT_ID environment variable not set" on the first request. | Confirm your `.env` file exists in the same directory as `app.js` and contains both `TELNYX_API_KEY` and `AI_ASSISTANT_ID` variables. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `require("dotenv").config()` call must execute before environment variables are accessed—verify this import order at the top of your code. |
| Rate Limit Error (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | You have exceeded the API rate limit for your account. Implement exponential backoff in your client code and reduce the frequency of requests. Wait at least 60 seconds before retrying. Check your Telnyx account plan for rate limit details in the [Portal](https://portal.telnyx.com). |
| Empty Message Error | The endpoint returns `{"error": "Message cannot be empty"}` with HTTP 400. | Ensure the JSON request body includes a non-empty `message` field. Example: `{"message": "Hello, assistant!"}`. Whitespace-only messages are rejected—the message must contain at least one non-whitespace character. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this AI example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What Node.js version do I need?**

Node.js 18 or higher. Node.js 20 LTS is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [AI Assistants Guide](https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant)
- [Assistants API Reference](https://developers.telnyx.com/api-reference/assistants/create-an-assistant)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx AI Assistants](https://telnyx.com/ai-assistants)
- [Voice AI Agents](https://telnyx.com/products/voice-ai-agents)

## Related Examples

- [List AI Assistants](/tutorials/ai/nodejs/list-ai-assistants).
- [Create an AI Assistant](/tutorials/ai/nodejs/create-ai-assistant).
- [Get an AI Assistant](/tutorials/ai/nodejs/get-ai-assistant).
