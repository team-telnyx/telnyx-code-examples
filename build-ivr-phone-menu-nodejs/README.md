# Ivr Menu with Node.js and Express

## What Does This Example Do?

Build a production-ready Interactive Voice Response (IVR) system using the Telnyx Voice API and Express.js. This tutorial demonstrates how to handle inbound calls, collect DTMF (dual-tone multi-frequency) input from callers, play voice prompts, and route calls based on menu selections. You'll implement a complete call control flow with webhook handling, state management, and proper error handling for production resilience.

## Who Is This For?

- **Node.js developers** building voice features with Express.
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
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for inbound calls.
- A publicly accessible URL for webhook callbacks (ngrok, Heroku, or similar).
- npm (Node package manager).
- Basic understanding of Express.js and async/await patterns.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-ivr-phone-menu-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-ivr-phone-menu-nodejs
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` and implement the IVR system with call control, DTMF collection, and menu routing:

```javascript
const express = require("express");
const bodyParser = require("body-parser");
const Telnyx = require("telnyx");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Initialize Telnyx client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

// In-memory store for call state (use Redis in production)
const callState = new Map();

/**
 * Helper: Answer an inbound call and start the IVR menu.
 * Stores call state for subsequent DTMF handling.
 */
async function answerAndGreet(callControlId) {
  try {
    // Answer the call
    await client.calls.actions.answer(callControlId);

    // Store call state
    callState.set(callControlId, {
      status: "greeting",
      menuLevel: "main",
      createdAt: Date.now(),
    });

    // Play initial greeting prompt
    await client.calls.actions.speak(callControlId, {
      payload: "Welcome to our IVR system. Press 1 for sales, 2 for support, or 3 to repeat this menu.",
      voice: "male",
      language: "en-US",
    });

    // Start collecting DTMF input (up to 1 digit, 5 second timeout)
    await client.calls.actions.gather_dtmf(callControlId, {
      max_digits: 1,
      timeout_millis: 5000,
    });
  } catch (error) {
    console.error(`Error answering call ${callControlId}:`, error.message);
    throw error;
  }
}

/**
 * Helper: Route call based on DTMF selection.
 * Handles menu navigation and call transfers.
 */
async function routeMenuSelection(callControlId, digit) {
  const state = callState.get(callControlId) || {};

  try {
    switch (digit) {
      case "1":
        // Route to sales
        await client.calls.actions.speak(callControlId, {
          payload: "Transferring you to our sales team. Please hold.",
          voice: "male",
          language: "en-US",
        });
        // Transfer to sales number (replace with your actual number)
        await client.calls.actions.transfer(callControlId, {
          to: "+15559876543",
        });
        state.menuLevel = "transferred_sales";
        break;

      case "2":
        // Route to support
        await client.calls.actions.speak(callControlId, {
          payload: "Transferring you to our support team. Please hold.",
          voice: "male",
          language: "en-US",
        });
        // Transfer to support number (replace with your actual number)
        await client.calls.actions.transfer(callControlId, {
          to: "+15559876544",
        });
        state.menuLevel = "transferred_support";
        break;

      case "3":
        // Repeat menu
        await client.calls.actions.speak(callControlId, {
          payload: "Press 1 for sales, 2 for support, or 3 to repeat this menu.",
          voice: "male",
          language: "en-US",
        });
        await client.calls.actions.gather_dtmf(callControlId, {
          max_digits: 1,
          timeout_millis: 5000,
        });
        state.menuLevel = "main";
        break;

      default:
        // Invalid selection
        await client.calls.actions.speak(callControlId, {
          payload: "Invalid selection. Please try again.",
          voice: "male",
          language: "en-US",
        });
        await client.calls.actions.gather_dtmf(callControlId, {
          max_digits: 1,
          timeout_millis: 5000,
        });
        break;
    }

    // Update call state
    state.status = "menu_processed";
    state.lastDigit = digit;
    state.updatedAt = Date.now();
    callState.set(callControlId, state);
  } catch (error) {
    console.error(`Error routing menu selection for ${callControlId}:`, error.message);
    throw error;
  }
}

/**
 * Helper: Clean up call state when call ends.
 */
function cleanupCallState(callControlId) {
  if (callState.has(callControlId)) {
    callState.delete(callControlId);
    console.log(`Cleaned up state for call ${callControlId}`);
  }
}

/**
 * Webhook endpoint: Handle inbound call initiated event.
 * This is triggered when a call arrives at your Telnyx number.
 */
app.post("/webhooks/call-initiated", async (req, res) => {
  const event = req.body.data;
  const callControlId = event.payload.call_control_id;

  console.log(`Inbound call initiated: ${callControlId}`);

  try {
    // Answer the call and start IVR greeting
    await answerAndGreet(callControlId);
    res.json({ status: "ok" });
  } catch (error) {
    console.error("Error handling call.initiated webhook:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Webhook endpoint: Handle DTMF received event.
 * This is triggered when the caller presses a digit.
 */
app.post("/webhooks/dtmf-received", async (req, res) => {
  const event = req.body.data;
  const callControlId = event.payload.call_control_id;
  const digit = event.payload.dtmf.digits;

  console.log(`DTMF received on call ${callControlId}: ${digit}`);

  try {
    // Route based on the digit pressed
    await routeMenuSelection(callControlId, digit);
    res.json({ status: "ok" });
  } catch (error) {
    console.error("Error handling call.dtmf.received webhook:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Webhook endpoint: Handle call hangup event.
 * This is triggered when the call ends.
 */
app.post("/webhooks/call-hangup", (req, res) => {
  const event = req.body.data;
  const callControlId = event.payload.call_control_id;

  console.log(`Call ended: ${callControlId}`);

  // Clean up call state
  cleanupCallState(callControlId);

  res.json({ status: "ok" });
});

/**
 * Health check endpoint for monitoring.
 */
app.get("/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

/**
 * Error handler middleware for Telnyx API errors.
 * Catches exceptions from route handlers and returns appropriate HTTP status codes.
 */
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);

  if (err instanceof Telnyx.AuthenticationError) {
    return res.status(401).json({ error: "Invalid API key" });
  }

  if (err instanceof Telnyx.RateLimitError) {
    return res.status(429).json({ error: "Rate limit exceeded. Please slow down." });
  }

  if (err instanceof Telnyx.APIStatusError) {
    return res.status(err.status_code || 500).json({
      error: err.message,
      status_code: err.status_code,
    });
  }

  if (err instanceof Telnyx.APIConnectionError) {
    return res.status(503).json({ error: "Network error connecting to Telnyx" });
  }

  // Generic error
  res.status(500).json({ error: "Internal server error" });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`IVR system listening on port ${PORT}`);
  console.log(`Webhook URL: ${process.env.WEBHOOK_URL}`);
});
```

## Complete Code

See [`server.js`](./server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhooks not being received | The server is running but webhook events are not arriving at your endpoints. | Verify that your webhook URL in the Telnyx Portal matches your public domain (e.g., `https://your-domain.com/webhooks/call-initiated`). Ensure ngrok or your hosting service is running and the tunnel is active. Check your firewall and security groups to allow inbound HTTPS traffic on port 443. Test the webhook URL directly in a browser to confirm it's accessible. |
| DTMF input not being collected | Callers press digits but the system doesn't respond to their input. | Confirm that `gather_dtmf()` is being called after the greeting prompt. Verify that the `max_digits` and `timeout_millis` parameters are set appropriately (e.g., `max_digits: 1` for single-digit menus). Check server logs for errors during the `gather_dtmf()` call. Ensure the call is still active (not already transferred or hung up) when DTMF collection is initiated. |
| Call transfer fails silently | The system says "Transferring you..." but the call doesn't actually transfer. | Verify that the transfer destination number is in E.164 format (e.g., `+15559876543`). Confirm that the destination number is a valid, active phone number capable of receiving calls. Check that your Telnyx account has outbound calling permissions. Review server logs for API errors during the `transfer()` call. Test the destination number independently to ensure it's reachable. |
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes in the `.env` file. If the key was regenerated recently, update your environment file and restart the server. Confirm that `require("dotenv").config()` is called before any Telnyx client initialization. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this Voice example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What Node.js version do I need?**

Node.js 18 or higher. Node.js 20 LTS is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Voice API Overview](https://developers.telnyx.com/docs/voice)
- [Voice API Commands](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-commands-and-resources)
- [AI Assistant Start](https://developers.telnyx.com/docs/voice/programmable-voice/ai-assistant-start)
- [Call Control API Reference](https://developers.telnyx.com/api-reference/call-commands/dial)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx Voice API](https://telnyx.com/products/voice-api)
- [Voice AI Agents](https://telnyx.com/products/voice-ai-agents)

## Related Examples

- [Handle Inbound Calls with Webhooks](/tutorials/voice/nodejs/inbound-call-webhook).
- [Record and Store Call Audio](/tutorials/voice/nodejs/call-recording).
- [Transfer Calls Between Numbers](/tutorials/voice/nodejs/call-transfer).
