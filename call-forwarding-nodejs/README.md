# Call Forwarding with Node.js and Express

## What Does This Example Do?

Build a production-ready Express application that implements intelligent call forwarding using the Telnyx Voice API. This tutorial demonstrates how to initiate outbound calls, handle webhook events, and manage call state using the Node.js SDK with proper error handling and secure credential management.

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
- A Call Control Application configured in the Telnyx Portal with a connection ID.
- npm (Node package manager).
- A publicly accessible URL for webhook callbacks (ngrok or similar for local development).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-forwarding-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-forwarding-nodejs
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` and initialize the Telnyx client using the new pattern. Define helper functions to handle call initiation and forwarding logic:

```javascript
const express = require("express");
const bodyParser = require("body-parser");
const Telnyx = require("telnyx");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Initialize client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

// In-memory store for active call forwarding rules
// In production, use a database like PostgreSQL or MongoDB
const forwardingRules = new Map();

/**
 * Initiate a call and forward it to a destination number.
 * Returns JSON-serializable call data.
 */
async function initiateCallForwarding(toNumber, forwardToNumber) {
  const fromNumber = process.env.TELNYX_PHONE_NUMBER;
  const connectionId = process.env.TELNYX_CONNECTION_ID;

  if (!fromNumber) {
    throw new Error("TELNYX_PHONE_NUMBER environment variable not set");
  }
  if (!connectionId) {
    throw new Error("TELNYX_CONNECTION_ID environment variable not set");
  }

  // Validate E.164 format to prevent API errors
  if (!toNumber.startsWith("+") || !forwardToNumber.startsWith("+")) {
    throw new Error(
      "Phone numbers must be in E.164 format (e.g., +15551234567)"
    );
  }

  // Initiate the outbound call using client.calls.dial()
  // connection_id is REQUIRED and links to your Call Control Application
  // Do NOT pass call_control_id as input — it is returned in the response
  const response = await client.calls.dial({
    from_: fromNumber,
    to: toNumber,
    connection_id: connectionId,
  });

  const callControlId = response.data.call_control_id;

  // Store forwarding rule in memory for webhook event handling
  forwardingRules.set(callControlId, {
    callControlId,
    originalNumber: toNumber,
    forwardToNumber,
    initiatedAt: new Date(),
    status: "initiated",
  });

  // Extract serializable data — SDK objects are NOT JSON-serializable
  return {
    call_control_id: callControlId,
    from: fromNumber,
    to: toNumber,
    forward_to: forwardToNumber,
    status: "initiated",
  };
}

/**
 * Handle incoming call.answered webhook event.
 * When the original call is answered, transfer it to the forwarding destination.
 */
async function handleCallAnswered(callControlId) {
  const rule = forwardingRules.get(callControlId);
  if (!rule) {
    console.warn(`No forwarding rule found for call ${callControlId}`);
    return;
  }

  try {
    // Transfer the call to the forwarding destination
    await client.calls.actions.transfer({
      call_control_id: callControlId,
      to: rule.forwardToNumber,
    });

    rule.status = "transferred";
    console.log(
      `Call ${callControlId} transferred to ${rule.forwardToNumber}`
    );
  } catch (error) {
    console.error(`Failed to transfer call ${callControlId}:`, error.message);
    rule.status = "transfer_failed";
  }
}

/**
 * Handle call.hangup webhook event.
 * Clean up the forwarding rule when the call ends.
 */
function handleCallHangup(callControlId) {
  const rule = forwardingRules.get(callControlId);
  if (rule) {
    rule.status = "hangup";
    console.log(`Call ${callControlId} ended`);
    // In production, persist this data to a database for analytics
  }
}

module.exports = { initiateCallForwarding, handleCallAnswered, handleCallHangup };
```

## Complete Code

See [`server.js`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-forwarding-nodejs/server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Express server. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone numbers must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Connection ID Not Set | The application raises `Error: TELNYX_CONNECTION_ID environment variable not set` on the first call forwarding request. | Confirm your `.env` file exists in the same directory as `app.js` and contains the `TELNYX_CONNECTION_ID` variable. This is your Call Control Application ID from the Telnyx Portal. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). Restart the server after updating the file. |
| Webhooks Not Received | Call events are initiated but the `/webhooks/call` endpoint is never called. | Verify that your `WEBHOOK_URL` in the `.env` file is publicly accessible and matches the webhook URL configured in your Call Control Application settings in the Telnyx Portal. Use ngrok (`ngrok http 3000`) for local development and update the Portal with the ngrok URL. Ensure your firewall allows inbound HTTPS traffic on port 443. |
| Call Transfer Fails | The call is initiated and answered, but the transfer to the forwarding destination fails silently. | Check the server logs for error messages from `handleCallAnswered()`. Verify that the `forwardToNumber` is in valid E.164 format. Ensure the destination number is capable of receiving calls. Test the destination number independently to confirm it is reachable. |

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
- [Record Phone Calls](/tutorials/voice/nodejs/call-recording).
- [Build an IVR Menu](/tutorials/voice/nodejs/ivr-menu).
