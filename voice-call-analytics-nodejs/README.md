# Call Analytics with Node.js and Express

## What Does This Example Do?

Build a production-ready Express application that tracks call metrics and analytics using the Telnyx Voice API. This tutorial demonstrates how to initiate calls, listen for webhook events, store call data, and generate analytics reports. You'll learn the command-event model of Telnyx Call Control, handle real-time call state changes, and expose analytics endpoints that provide insights into call duration, success rates, and call patterns.

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
- A Call Control Application configured in the Telnyx Portal with a webhook URL.
- npm (Node package manager).
- A publicly accessible URL for receiving webhooks (use ngrok for local development).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/voice-call-analytics-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` with the Express server, call initiation logic, and webhook handlers:

```javascript
const express = require("express");
const bodyParser = require("body-parser");
const Telnyx = require("telnyx");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Initialize Telnyx client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

// In-memory store for call analytics (use a database in production)
const callStore = new Map();

/**
 * Initiate an outbound call and store initial metadata.
 * Returns call_control_id for subsequent control actions.
 */
async function initiateCall(toNumber) {
  const fromNumber = process.env.TELNYX_PHONE_NUMBER;
  const connectionId = process.env.TELNYX_CONNECTION_ID;

  if (!fromNumber || !connectionId) {
    throw new Error(
      "TELNYX_PHONE_NUMBER and TELNYX_CONNECTION_ID environment variables required"
    );
  }

  // Validate E.164 format to prevent API errors
  if (!toNumber.startsWith("+")) {
    throw new Error(
      "Phone number must be in E.164 format (e.g., +15551234567)"
    );
  }

  // Initiate the call using client.calls.dial()
  const response = await client.calls.dial({
    from: fromNumber,
    to: toNumber,
    connection_id: connectionId,
  });

  const callControlId = response.data.call_control_id;

  // Store initial call metadata for analytics
  callStore.set(callControlId, {
    call_control_id: callControlId,
    from: fromNumber,
    to: toNumber,
    initiated_at: new Date().toISOString(),
    state: "initiated",
    duration_seconds: 0,
    events: [],
  });

  return {
    call_control_id: callControlId,
    from: fromNumber,
    to: toNumber,
    initiated_at: callStore.get(callControlId).initiated_at,
  };
}

/**
 * Process incoming webhook events and update call analytics.
 * Telnyx sends events like call.initiated, call.answered, call.hangup.
 */
function processWebhookEvent(event) {
  const callControlId = event.data.call_control_id;
  const eventType = event.type;

  if (!callStore.has(callControlId)) {
    // Create entry if webhook arrives before dial response (race condition)
    callStore.set(callControlId, {
      call_control_id: callControlId,
      from: event.data.from?.phone_number || "unknown",
      to: event.data.to?.phone_number || "unknown",
      initiated_at: new Date().toISOString(),
      state: "unknown",
      duration_seconds: 0,
      events: [],
    });
  }

  const callData = callStore.get(callControlId);

  // Record the event with timestamp
  callData.events.push({
    type: eventType,
    timestamp: new Date().toISOString(),
    details: event.data,
  });

  // Update call state based on event type
  switch (eventType) {
    case "call.initiated":
      callData.state = "initiated";
      break;
    case "call.answered":
      callData.state = "answered";
      callData.answered_at = new Date().toISOString();
      break;
    case "call.hangup":
      callData.state = "completed";
      callData.ended_at = new Date().toISOString();
      // Calculate duration if we have both answered_at and ended_at
      if (callData.answered_at && callData.ended_at) {
        const answeredTime = new Date(callData.answered_at).getTime();
        const endedTime = new Date(callData.ended_at).getTime();
        callData.duration_seconds = Math.round((endedTime - answeredTime) / 1000);
      }
      break;
    case "call.dtmf.received":
      // Track DTMF digits for IVR analytics
      if (!callData.dtmf_digits) {
        callData.dtmf_digits = "";
      }
      callData.dtmf_digits += event.data.digit;
      break;
    case "call.recording.saved":
      callData.recording_url = event.data.recording_url;
      break;
  }

  return callData;
}

/**
 * Retrieve analytics for a specific call.
 */
function getCallAnalytics(callControlId) {
  if (!callStore.has(callControlId)) {
    return null;
  }

  const callData = callStore.get(callControlId);
  return {
    call_control_id: callData.call_control_id,
    from: callData.from,
    to: callData.to,
    state: callData.state,
    initiated_at: callData.initiated_at,
    answered_at: callData.answered_at || null,
    ended_at: callData.ended_at || null,
    duration_seconds: callData.duration_seconds,
    dtmf_digits: callData.dtmf_digits || null,
    recording_url: callData.recording_url || null,
    event_count: callData.events.length,
    events: callData.events,
  };
}

/**
 * Generate aggregate analytics across all calls.
 */
function getAggregateAnalytics() {
  const calls = Array.from(callStore.values());

  if (calls.length === 0) {
    return {
      total_calls: 0,
      completed_calls: 0,
      answered_calls: 0,
      success_rate: 0,
      average_duration_seconds: 0,
      total_duration_seconds: 0,
    };
  }

  const completedCalls = calls.filter((c) => c.state === "completed");
  const answeredCalls = calls.filter((c) => c.state === "answered" || c.state === "completed");
  const totalDuration = completedCalls.reduce((sum, c) => sum + c.duration_seconds, 0);

  return {
    total_calls: calls.length,
    completed_calls: completedCalls.length,
    answered_calls: answeredCalls.length,
    success_rate: calls.length > 0 ? (answeredCalls.length / calls.length) * 100 : 0,
    average_duration_seconds:
      completedCalls.length > 0 ? Math.round(totalDuration / completedCalls.length) : 0,
    total_duration_seconds: totalDuration,
  };
}

// ============================================================================
// Express Routes
// ============================================================================

/**
 * POST /calls/initiate
 * Initiate an outbound call and return call_control_id.
 */
app.post("/calls/initiate", async (req, res) => {
  const { to } = req.body;

  if (!to) {
    return res.status(400).json({ error: "Missing required field: 'to'" });
  }

  try {
    const result = await initiateCall(to);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({ error: "Rate limit exceeded. Please slow down." });
    }
    if (error instanceof Telnyx.APIError) {
      return res.status(error.status_code || 400).json({
        error: error.message,
        status_code: error.status_code,
      });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({ error: "Network error connecting to Telnyx" });
    }
    return res.status(400).json({ error: error.message });
  }
});

/**
 * POST /webhooks/call
 * Receive and process Telnyx call control webhooks.
 * Telnyx sends events like call.initiated, call.answered, call.hangup, etc.
 */
app.post("/webhooks/call", (req, res) => {
  const event = req.body;

  // Acknowledge receipt immediately (Telnyx expects 200 OK)
  res.status(200).json({ received: true });

  // Process the event asynchronously
  try {
    processWebhookEvent(event);
  } catch (error) {
    console.error("Error processing webhook event:", error);
  }
});

/**
 * GET /analytics/calls/:callControlId
 * Retrieve detailed analytics for a specific call.
 */
app.get("/analytics/calls/:callControlId", (req, res) => {
  const { callControlId } = req.params;
  const analytics = getCallAnalytics(callControlId);

  if (!analytics) {
    return res.status(404).json({ error: "Call not found" });
  }

  return res.status(200).json(analytics);
});

/**
 * GET /analytics/aggregate
 * Retrieve aggregate analytics across all calls.
 */
app.get("/analytics/aggregate", (req, res) => {
  const analytics = getAggregateAnalytics();
  return res.status(200).json(analytics);
});

/**
 * GET /health
 * Health check endpoint for monitoring.
 */
app.get("/health", (req, res) => {
  return res.status(200).json({ status: "ok" });
});

// ============================================================================
// Error Handler
// ============================================================================

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  return res.status(500).json({
    error: "Internal server error",
    message: err.message,
  });
});

// ============================================================================
// Server Startup
// ============================================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Call Analytics server running on port ${PORT}`);
  console.log(`Webhook URL: ${process.env.WEBHOOK_URL}`);
});
```

## Complete Code

See [`server.js`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voice-call-analytics-nodejs/server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Express server. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Webhook Events Not Received | Call analytics show no events or only the initial state, and webhook endpoint is never called. | Verify that your Call Control Application in the Telnyx Portal has the correct webhook URL configured. Use ngrok to expose your local Express server: `ngrok http 3000`, then update the webhook URL in the Portal to `https://your-ngrok-url.ngrok.io/webhooks/call`. Ensure the webhook URL is publicly accessible and your firewall allows inbound HTTPS traffic. |
| Connection ID Not Found | The application raises an error about missing `TELNYX_CONNECTION_ID` on the first call initiation. | Confirm your `.env` file contains `TELNYX_CONNECTION_ID` with the correct Call Control Application ID from the Telnyx Portal. This is a static value that links your phone number to your Call Control application. Verify the ID is not empty or malformed, and restart the Express server after updating the `.env` file. |
| Call State Never Updates to "answered" | Calls initiate successfully but remain in "initiated" state even after the recipient answers. | Ensure your Call Control Application webhook is properly configured in the Telnyx Portal and receiving events. Check your Express server logs for webhook delivery errors. Verify that the `call.answered` event is being sent by Telnyx—this depends on the recipient actually answering the call. Test with a real phone number that will answer the call. |

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

- [Handle Inbound Calls with Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/nodejs/inbound-call-webhook).
- [Record and Store Call Audio](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/nodejs/call-recording).
- [Transfer Calls Between Numbers](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/nodejs/call-transfer).
