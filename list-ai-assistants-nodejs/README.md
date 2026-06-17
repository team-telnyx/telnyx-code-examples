# List AI Assistants with Node.js and Express

## What Does This Example Do?

Build a production-ready Express endpoint that retrieves and lists all AI assistants from your Telnyx account using the Telnyx Node.js SDK. This tutorial demonstrates proper client initialization, pagination handling, secure credential management via environment variables, and comprehensive error handling for production resilience.

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

- Node.js 14 or higher.
- npm (Node Package Manager).
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- curl or Postman for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/list-ai-assistants-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/list-ai-assistants-nodejs
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a helper function to fetch and serialize assistants. The SDK response objects are not JSON-serializable, so we extract only the fields needed for the HTTP response:

```javascript
/**
 * Fetch all AI assistants from Telnyx.
 * Returns a plain JavaScript object array suitable for JSON serialization.
 */
async function listAssistants() {
  // Call the Telnyx API to list all assistants
  const response = await client.ai_assistants.list();

  // Extract serializable fields from each assistant object
  // SDK objects are NOT JSON-serializable — always unpack to plain objects
  return response.data.map((assistant) => ({
    id: assistant.id,
    name: assistant.name,
    model: assistant.model,
    instructions: assistant.instructions,
    enabled_features: assistant.enabled_features,
    created_at: assistant.created_at,
  }));
}

module.exports = { listAssistants };
```

Now add the Express route with comprehensive error handling. Catch Telnyx exceptions in the route handler and map them to appropriate HTTP status codes:

```javascript
const { app, client } = require("./app");
const { listAssistants } = require("./helpers");

/**
 * GET /assistants
 * Retrieve all AI assistants from the Telnyx account.
 * Returns a JSON array of assistant objects.
 */
app.get("/assistants", async (req, res) => {
  try {
    const assistants = await listAssistants();
    res.status(200).json({
      success: true,
      count: assistants.length,
      data: assistants,
    });
  } catch (error) {
    // Handle Telnyx-specific errors with appropriate HTTP status codes
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({
        error: "Invalid API key. Verify TELNYX_API_KEY in your environment.",
      });
    }

    if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({
        error: "Rate limit exceeded. Please retry after a short delay.",
      });
    }

    if (error instanceof Telnyx.APIStatusError) {
      return res.status(error.status || 500).json({
        error: error.message,
        status_code: error.status,
      });
    }

    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({
        error: "Network error connecting to Telnyx. Please try again later.",
      });
    }

    // Catch-all for unexpected errors
    console.error("Unexpected error:", error);
    res.status(500).json({
      error: "Internal server error. Check logs for details.",
    });
  }
});

// Start the Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Test the endpoint: curl http://localhost:${PORT}/assistants`);
});
```

## Complete Code

See [`server.js`](./server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key..."}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Node.js server after updating the `.env` file. |
| Empty Assistant List | The endpoint returns `count: 0` with an empty `data` array. | This is expected if you have not created any AI assistants yet. Create an assistant in the [Telnyx Portal](https://portal.telnyx.com) or use the Create AI Assistant API endpoint, then retry the list request. |
| Network Error (503) | The endpoint returns `{"error": "Network error connecting to Telnyx..."}` with HTTP 503. | Verify your internet connection and that the Telnyx API is accessible. Check if your firewall or proxy is blocking requests to `api.telnyx.com`. Ensure the `TELNYX_API_KEY` environment variable is set correctly before the server starts. |
| Module Not Found Error | Running `node app.js` produces `Error: Cannot find module 'telnyx'`. | Ensure all dependencies are installed by running `npm install` in your project directory. Verify that `package.json` lists `telnyx`, `express`, and `dotenv` as dependencies. |
| Port Already in Use | The server fails to start with `Error: listen EADDRINUSE :::3000`. | Change the `PORT` environment variable to an available port (e.g., `PORT=3001 node app.js`) or kill the process using port 3000. On macOS/Linux, use `lsof -i :3000` to find the process ID. |

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

- [Get an AI Assistant](/tutorials/ai/nodejs/get-ai-assistant).
- [Create an AI Assistant](/tutorials/ai/nodejs/create-ai-assistant).
- [Chat with an AI Assistant](/tutorials/ai/nodejs/chat-with-ai-assistant).
