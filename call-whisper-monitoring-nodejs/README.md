# Whisper Prompt with Node.js and Express

## What Does This Example Do?

Build a production-ready Express application that initiates outbound calls with a whisper prompt—a message played to the caller before the call is connected to the recipient. This tutorial demonstrates the Telnyx Voice API's call control capabilities, webhook event handling, and the command-event model for managing call state in real time.

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

- Node.js 16 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for outbound calls.
- A Call Control Application configured in the Telnyx Portal with a connection ID.
- A publicly accessible webhook URL (use ngrok for local development).
- npm (Node.js package manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-whisper-monitoring-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-whisper-monitoring-nodejs
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` and initialize the Telnyx client using the Node.js SDK pattern. Define helper functions to handle call initiation and webhook event processing:

```javascript
require("dotenv").config();
const express = require("express");
const Telnyx = require("telnyx");

const app = express();
app.use(express.json());

// Initialize Telnyx client with API key
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

/**
 * Initiate an outbound call with a whisper prompt.
 * The whisper message is played to the caller before the call connects.
 */
async function initiateCallWithWhisper(toNumber, whisperMessage) {
  const fromNumber = process.env.TELNYX_PHONE_NUMBER;
  const connectionId = process.env.TELNYX_CONNECTION_ID;

  if (!fromNumber) {
    throw new Error("TELNYX_PHONE_NUMBER environment variable not set");
  }
  if (!connectionId) {
    throw new Error("TELNYX_CONNECTION_ID environment variable not set");
  }

  // Validate E.164 format to prevent API errors
  if (!toNumber.startsWith("+")) {
    throw new Error(
      "Phone number must be in E.164 format (e.g., +15551234567)"
    );
  }

  // Initiate the call using the Call Control API
  const response = await client.calls.dial({
    from_: fromNumber,
    to: toNumber,
    connection_id: connectionId,
  });

  // Extract call_control_id from response for subsequent control actions
  const callControlId = response.data.call_control_id;

  // Store call metadata for webhook processing
  return {
    call_control_id: callControlId,
    to: toNumber,
    from: fromNumber,
    whisper_message: whisperMessage,
  };
}

/**
 * Handle incoming webhook events from Telnyx.
 * Process call.answered event to play the whisper prompt.
 */
async function handleCallWebhook(event) {
  const callControlId = event.data.payload.call_control_id;
  const eventType = event.data.event_type;

  console.log(`Webhook event: ${eventType} for call ${callControlId}`);

  // When the call is answered, play the whisper prompt
  if (eventType === "call.answered") {
    const whisperMessage = event.data.payload.whisper_message || "Your call is being connected.";

    try {
      // Use the speak action to play the whisper message
      await client.calls.actions.speak(callControlId, {
        payload: whisperMessage,
        voice: "female",
        language: "en-US",
      });

      console.log(`Whisper prompt played for call ${callControlId}`);
    } catch (error) {
      console.error(`Failed to play whisper prompt: ${error.message}`);
    }
  }

  // Log call hangup for cleanup
  if (eventType === "call.hangup") {
    console.log(`Call ${callControlId} ended`);
  }
}

/**
 * Express route to initiate a call with whisper prompt.
 */
app.post("/call/initiate", async (req, res) => {
  const { to, whisper_message } = req.body;

  if (!to || !whisper_message) {
    return res
      .status(400)
      .json({
        error: "Missing required fields: 'to' and 'whisper_message'",
      });
  }

  try {
    const callData = await initiateCallWithWhisper(to, whisper_message);
    return res.status(200).json({
      call_control_id: callData.call_control_id,
      to: callData.to,
      from: callData.from,
      status: "initiated",
    });
  } catch (error) {
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof Telnyx.RateLimitError) {
      return res
        .status(429)
        .json({ error: "Rate limit exceeded. Please slow down." });
    }
    if (error instanceof Telnyx.APIStatusError) {
      return res
        .status(error.status_code || 500)
        .json({ error: error.message, status_code: error.status_code });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res
        .status(503)
        .json({ error: "Network error connecting to Telnyx" });
    }
    return res.status(400).json({ error: error.message });
  }
});

/**
 * Express route to receive Telnyx webhook events.
 * Telnyx sends call state changes (answered, hangup, etc.) to this endpoint.
 */
app.post("/webhooks/call", async (req, res) => {
  const event = req.body;

  // Acknowledge receipt immediately to prevent retries
  res.status(200).json({ received: true });

  // Process the event asynchronously
  try {
    await handleCallWebhook(event);
  } catch (error) {
    console.error(`Webhook processing error: ${error.message}`);
  }
});

/**
 * Health check endpoint for monitoring.
 */
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Start the Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Whisper prompt server running on port ${PORT}`);
  console.log(`Webhook URL: ${process.env.WEBHOOK_URL}/webhooks/call`);
});
```

## Complete Code

See [`server.js`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-whisper-monitoring-nodejs/server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Express server. |
| Connection ID Not Found | The API returns an error about an invalid or missing connection ID. | Confirm that `TELNYX_CONNECTION_ID` in your `.env` file matches a Call Control Application ID from the Telnyx Portal. The connection ID links your phone number to the Call Control application. Verify the application is active and has the correct webhook URL configured. |
| Webhook Events Not Received | The `/webhooks/call` endpoint is not receiving events from Telnyx. | Ensure your ngrok URL is correctly configured in the Telnyx Portal's Call Control Application webhook settings. The webhook URL must be `https://your-ngrok-url.ngrok.io/webhooks/call`. Verify that your local server is running and accessible via ngrok by testing the `/health` endpoint. Check that your firewall or network does not block incoming requests from Telnyx's IP ranges. |
| Whisper Prompt Not Playing | The call connects but the whisper message is not heard. | Verify that the `call.answered` event is being received by checking server logs. Ensure the `whisper_message` field is included in the request body when initiating the call. Test the speak action with a simple message like "Hello" to isolate audio issues. Check that your Telnyx account has sufficient credits and that the phone number supports outbound calls. |
| Phone Number Format Error | The API returns "Phone number must be in E.164 format". | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |

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

- [Handle Inbound Call Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/nodejs/inbound-call-webhook).
- [Record and Store Call Audio](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/nodejs/call-recording).
- [Transfer Calls Between Numbers](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/nodejs/call-transfer).
