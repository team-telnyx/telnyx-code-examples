# Create AI Assistant with Node.js and Express

## What Does This Example Do?

Build a production-ready Express endpoint that creates AI assistants using the Telnyx AI Assistants API. This tutorial demonstrates the client-based initialization pattern, proper error handling for telecom APIs, secure credential management via environment variables, and JSON serialization of SDK responses for web frameworks.

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
- npm (Node package manager).
- A code editor and terminal.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/create-ai-assistant-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/create-ai-assistant-nodejs
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` and initialize the Telnyx client using the SDK pattern. Define a helper function to handle assistant creation with proper validation:

```javascript
require('dotenv').config();
const Telnyx = require('telnyx');
const express = require('express');

const app = express();
app.use(express.json());

// Initialize client with the SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

/**
 * Create an AI assistant and return JSON-serializable response data.
 * @param {string} name - Display name for the assistant.
 * @param {string} instructions - System prompt / persona for the assistant.
 * @param {string} model - LLM model ID (e.g., "meta-llama/Meta-Llama-3.1-70B-Instruct").
 * @param {array} enabledFeatures - Array of enabled features ("telephony" and/or "messaging").
 * @returns {object} Serializable assistant data.
 */
async function createAssistant(name, instructions, model, enabledFeatures) {
  // Validate required fields to prevent API errors
  if (!name || !instructions || !model) {
    throw new Error('Missing required fields: name, instructions, and model');
  }

  if (!Array.isArray(enabledFeatures) || enabledFeatures.length === 0) {
    throw new Error('enabledFeatures must be a non-empty array');
  }

  // Use client.ai_assistants.create() to create a new assistant
  const response = await client.ai_assistants.create({
    name: name,
    instructions: instructions,
    model: model,
    enabled_features: enabledFeatures,
  });

  // Extract serializable data — SDK objects are NOT JSON-serializable
  return {
    id: response.data.id,
    name: response.data.name,
    model: response.data.model,
    instructions: response.data.instructions,
    enabled_features: response.data.enabled_features,
    created_at: response.data.created_at,
  };
}
```

## Complete Code

See [`server.js`](./server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Express server. |
| Missing Required Fields (400) | You receive a 400 error stating "Missing required fields: name, instructions, model, and enabled_features". | Ensure your POST request body includes all four required fields as JSON. The `enabled_features` field must be an array containing at least one of: `"telephony"` or `"messaging"`. Example: `{"name": "Bot", "instructions": "...", "model": "meta-llama/...", "enabled_features": ["telephony"]}`. |
| Invalid Model ID | The API returns a 400 error about an unsupported or invalid model. | Verify the `model` field uses a valid Telnyx-supported LLM identifier. Common models include `"meta-llama/Meta-Llama-3.1-70B-Instruct"` and `"gpt-4"`. Check the [Telnyx AI Assistants documentation](https://developers.telnyx.com/docs/api/ai-assistants) for the current list of supported models. |
| Network Error (503) | The endpoint returns `{"error": "Network error connecting to Telnyx"}` with HTTP 503. | Verify your internet connection and that the Telnyx API is accessible. Check if your firewall or proxy is blocking requests to `api.telnyx.com`. Ensure the `TELNYX_API_KEY` environment variable is set before the server starts. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | You have exceeded the API rate limit. Implement exponential backoff in your client code and retry requests after a delay. Check the [Telnyx rate limiting documentation](https://developers.telnyx.com/docs/api/overview#rate-limiting) for current limits and best practices. |

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
- [Chat with an AI Assistant](/tutorials/ai/nodejs/chat-with-ai-assistant).
- [Update an AI Assistant](/tutorials/ai/nodejs/update-ai-assistant).
