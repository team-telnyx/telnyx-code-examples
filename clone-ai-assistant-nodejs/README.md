# Clone AI Assistant with Node.js and Express

## What Does This Example Do?

Build a production-ready Express endpoint that clones an existing AI Assistant using the Telnyx Node.js SDK. This tutorial demonstrates how to duplicate an assistant's configuration, including its model, instructions, and tools, enabling rapid deployment of similar assistants for different use cases. You'll learn proper error handling for the AI Assistants API and secure credential management via environment variables.

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
- An existing AI Assistant to clone (create one first using the [Create AI Assistant](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/nodejs/create-ai-assistant) tutorial if needed).
- npm (Node.js package manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/clone-ai-assistant-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` and initialize the Telnyx client using the Node.js SDK pattern. Define a helper function to handle assistant cloning with proper validation:

```javascript
const telnyx = require("telnyx");
require("dotenv").config();

// Initialize client with the SDK pattern
const client = new telnyx.Telnyx({
  apiKey: process.env.TELNYX_API_KEY,
});

/**
 * Clone an AI Assistant and return JSON-serializable response data.
 * @param {string} assistantId - The ID of the assistant to clone.
 * @param {string} newName - The name for the cloned assistant.
 * @returns {Promise<Object>} Cloned assistant data.
 */
async function cloneAssistant(assistantId, newName) {
  if (!assistantId) {
    throw new Error("Assistant ID is required");
  }

  if (!newName || newName.trim().length === 0) {
    throw new Error("New assistant name is required and cannot be empty");
  }

  // Use client.aiAssistants.clone() to duplicate the assistant
  const response = await client.aiAssistants.clone(assistantId, {
    name: newName,
  });

  // Extract serializable data — SDK objects are NOT JSON-serializable
  return {
    id: response.data.id,
    name: response.data.name,
    model: response.data.model,
    instructions: response.data.instructions,
    tools: response.data.tools || [],
    enabled_features: response.data.enabled_features || [],
    created_at: response.data.created_at,
  };
}
```

## Complete Code

See [`server.js`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/clone-ai-assistant-nodejs/server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Express server. |
| Assistant Not Found (404) | You receive a 500 error or the API returns a 404 status when cloning. | Confirm the `assistant_id` you're providing exists and is valid. Retrieve the correct ID from the [Telnyx Portal](https://portal.telnyx.com) or use the [List AI Assistants](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/nodejs/list-ai-assistants) endpoint to verify available assistants. Ensure the ID is passed as a string in the request body. |
| Missing Required Fields (400) | The endpoint returns `{"error": "Missing required fields: 'assistant_id' and 'name'"}`. | Verify your POST request includes both `assistant_id` and `name` fields in the JSON body. Example: `{"assistant_id": "abc123", "name": "My Cloned Assistant"}`. Ensure the request has the `Content-Type: application/json` header. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | The Telnyx API has rate limits. Implement exponential backoff in your client code: wait 1 second, then 2 seconds, then 4 seconds between retries. For production, use a queue system to batch clone operations. Check the [Telnyx documentation](https://developers.telnyx.com) for current rate limits. |
| Network Error (503) | The endpoint returns `{"error": "Network error connecting to Telnyx"}` with HTTP 503. | This indicates a temporary connection issue with the Telnyx API. Verify your internet connection and that the Telnyx API is operational. Implement retry logic with exponential backoff. Check the [Telnyx Status Page](https://status.telnyx.com) for any ongoing incidents. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this AI example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

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

- [List AI Assistants](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/nodejs/list-ai-assistants).
- [Create an AI Assistant](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/nodejs/create-ai-assistant).
- [Chat with an AI Assistant](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/nodejs/chat-with-ai-assistant).
