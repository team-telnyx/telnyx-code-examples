# Warm Transfer with Node.js and Express

## What Does This Example Do?

Build a production-ready Express application that implements warm transfers using the Telnyx Voice API. A warm transfer allows an agent to speak with a customer before transferring them to another party, ensuring a smooth handoff. This tutorial demonstrates call control commands, webhook event handling, and state management for multi-party call scenarios.

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
- A Telnyx phone number enabled for outbound calls.
- A Call Control Application configured in the Telnyx Portal with a webhook URL.
- npm (Node.js package manager).
- A publicly accessible URL for receiving webhooks (use ngrok for local development).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/warm-transfer-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` with the Express server, webhook handlers, and call control logic:

```javascript
const express = require("express");
const bodyParser = require("body-parser");
const telnyx = require("telnyx");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Initialize Telnyx client with the new SDK pattern
const client = new telnyx.Telnyx({
  apiKey: process.env.TELNYX_API_KEY,
});

// In-memory store for call state (use a database in production)
const callState = {};

/**
 * Initiate an outbound call.
 * Returns call_control_id for subsequent control actions.
 */
async function initiateCall(toNumber) {
  const response = await client.calls.dial({
    from: process.env.TELNYX_PHONE_NUMBER,
    to: toNumber,
    connection_id: process.env.TELNYX_CONNECTION_ID,
  });

  // Extract serializable data — SDK objects are NOT JSON-serializable
  return {
    call_control_id: response.data.call_control_id,
    state: "initiated",
  };
}

/**
 * Answer an inbound call.
 */
async function answerCall(callControlId) {
  await client.calls.actions.answer(callControlId);
}

/**
 * Transfer the call to a third party.
 * The agent stays on the line during the transfer (warm transfer).
 */
async function transferCall(callControlId, transferTo) {
  await client.calls.actions.transfer(callControlId, {
    to: transferTo,
  });
}

/**
 * Hangup a call.
 */
async function hangupCall(callControlId) {
  await client.calls.actions.hangup(callControlId);
}

/**
 * Speak text to the call participant.
 */
async function speakToCall(callControlId, text) {
  await client.calls.actions.speak(callControlId, {
    payload: text,
    language: "en-US",
    voice: "female",
  });
}

/**
 * POST /webhooks/call-events
 * Receive and process Telnyx call control webhooks.
 */
app.post("/webhooks/call-events", (req, res) => {
  const event = req.body.data;
  const callControlId = event.call_control_id;

  console.log(`Webhook received: ${event.event_type} for call ${callControlId}`);

  try {
    // Store call state for tracking
    if (!callState[callControlId]) {
      callState[callControlId] = {};
    }

    switch (event.event_type) {
      case "call.initiated":
        // Outbound call started
        callState[callControlId].state = "initiated";
        callState[callControlId].from = event.from;
        callState[callControlId].to = event.to;
        console.log(`Call initiated from ${event.from} to ${event.to}`);
        break;

      case "call.answered":
        // Call connected
        callState[callControlId].state = "answered";
        console.log(`Call answered: ${callControlId}`);
        break;

      case "call.hangup":
        // Call ended — clean up state
        console.log(`Call ended: ${callControlId}`);
        delete callState[callControlId];
        break;

      default:
        console.log(`Unhandled event type: ${event.event_type}`);
    }

    // Always return 200 to acknowledge receipt
    res.status(200).json({ status: "ok" });
  } catch (error) {
    console.error(`Error processing webhook: ${error.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /calls/initiate
 * HTTP endpoint to initiate an outbound call.
 */
app.post("/calls/initiate", async (req, res) => {
  const { to_number } = req.body;

  if (!to_number) {
    return res.status(400).json({ error: "Missing required field: 'to_number'" });
  }

  // Validate E.164 format
  if (!to_number.startsWith("+")) {
    return res
      .status(400)
      .json({ error: "Phone number must be in E.164 format (e.g., +15551234567)" });
  }

  try {
    const result = await initiateCall(to_number);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof telnyx.RateLimitError) {
      return res.status(429).json({ error: "Rate limit exceeded. Please slow down." });
    }
    if (error instanceof telnyx.APIStatusError) {
      return res
        .status(error.status_code || 400)
        .json({ error: error.message, status_code: error.status_code });
    }
    if (error instanceof telnyx.APIConnectionError) {
      return res.status(503).json({ error: "Network error connecting to Telnyx" });
    }
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /calls/:call_control_id/answer
 * HTTP endpoint to answer an inbound call.
 */
app.post("/calls/:call_control_id/answer", async (req, res) => {
  const { call_control_id } = req.params;

  try {
    await answerCall(call_control_id);
    return res.status(200).json({ status: "answered", call_control_id });
  } catch (error) {
    if (error instanceof telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof telnyx.APIStatusError) {
      return res
        .status(error.status_code || 400)
        .json({ error: error.message, status_code: error.status_code });
    }
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /calls/:call_control_id/transfer
 * HTTP endpoint to transfer a call to a third party.
 * The agent stays on the line during the transfer (warm transfer).
 */
app.post("/calls/:call_control_id/transfer", async (req, res) => {
  const { call_control_id } = req.params;
  const { transfer_to } = req.body;

  if (!transfer_to) {
    return res.status(400).json({ error: "Missing required field: 'transfer_to'" });
  }

  // Validate E.164 format
  if (!transfer_to.startsWith("+")) {
    return res
      .status(400)
      .json({ error: "Phone number must be in E.164 format (e.g., +15551234567)" });
  }

  try {
    await transferCall(call_control_id, transfer_to);
    return res.status(200).json({ status: "transferred", call_control_id, transfer_to });
  } catch (error) {
    if (error instanceof telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof telnyx.APIStatusError) {
      return res
        .status(error.status_code || 400)
        .json({ error: error.message, status_code: error.status_code });
    }
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /calls/:call_control_id/speak
 * HTTP endpoint to speak text to a call participant.
 */
app.post("/calls/:call_control_id/speak", async (req, res) => {
  const { call_control_id } = req.params;
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Missing required field: 'text'" });
  }

  try {
    await speakToCall(call_control_id, text);
    return res.status(200).json({ status: "speaking", call_control_id });
  } catch (error) {
    if (error instanceof telnyx.APIStatusError) {
      return res
        .status(error.status_code || 400)
        .json({ error: error.message, status_code: error.status_code });
    }
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /calls/:call_control_id/hangup
 * HTTP endpoint to end a call.
 */
app.post("/calls/:call_control_id/hangup", async (req, res) => {
  const { call_control_id } = req.params;

  try {
    await hangupCall(call_control_id);
    return res.status(200).json({ status: "hangup", call_control_id });
  } catch (error) {
    if (error instanceof telnyx.APIStatusError) {
      return res
        .status(error.status_code || 400)
        .json({ error: error.message, status_code: error.status_code });
    }
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /health
 * Health check endpoint.
 */
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Express server running on port ${PORT}`);
  console.log(`Webhook URL: ${process.env.WEBHOOK_URL}/webhooks/call-events`);
});
```

## Complete Code

See [`server.js`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/warm-transfer-nodejs/server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Express server. |
| Webhook Not Received | The `/webhooks/call-events` endpoint is not receiving events from Telnyx. | Confirm that your Call Control Application in the Telnyx Portal has the webhook URL set to `https://your-ngrok-url.ngrok.io/webhooks/call-events`. Ensure ngrok is running and the URL is publicly accessible. Check your server logs for incoming POST requests. If using a firewall, allow inbound traffic on port 3000. |
| Transfer Fails with API Error | The transfer endpoint returns a 400 or 500 error when attempting to transfer a call. | Verify that the `call_control_id` is valid and the call is in an "answered" state before attempting transfer. Ensure the `transfer_to` phone number is in E.164 format (e.g., `+15551111111`). Check that your Telnyx account has sufficient credits and the destination number is reachable. Review the error message in the response for specific API details. |
| Call State Not Persisting | Call state is lost when the server restarts or multiple instances are running. | The in-memory `callState` object is suitable only for single-instance development. For production, use a persistent database (Redis, PostgreSQL, MongoDB) to store call state keyed by `call_control_id`. This ensures state survives server restarts and scales across multiple instances. |
| Phone Number Format Rejected | Requests return `{"error": "Phone number must be in E.164 format..."}`. | Ensure all phone numbers start with `+` followed by the country code and number without spaces, dashes, or parentheses. Example: `+15551234567` (US), `+447700900123` (UK), `+33123456789` (France). Update your test curl commands and client code to use properly formatted numbers. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this Voice example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

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

- [Implement an IVR Menu with Node.js](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/nodejs/ivr-menu).
- [Record Calls with Node.js](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/nodejs/call-recording).
- [Handle Inbound Calls with Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/nodejs/inbound-call-webhook).
