# Call Transfer with Node.js and Express

## What Does This Example Do?

Build a production-ready Express application that initiates outbound calls and transfers them to another number using the Telnyx Voice API. This tutorial demonstrates the command-event model of Call Control, proper handling of webhook events, and secure credential management via environment variables.

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
- A publicly accessible URL for webhook delivery (ngrok or similar for local testing).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/transfer-live-phone-calls-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/transfer-live-phone-calls-nodejs
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` and initialize the Telnyx client using the new pattern. Define helper functions to handle call initiation and transfer with proper validation:

```javascript
const Telnyx = require("telnyx");
const express = require("express");
const bodyParser = require("body-parser");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Initialize client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

// In-memory store for active calls (use a database in production)
const activeCalls = new Map();

/**
 * Initiate an outbound call.
 * Returns the call_control_id for subsequent control actions.
 */
async function initiateCall(toNumber) {
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

  // Use client.calls.dial() to initiate the call
  const response = await client.calls.dial({
    from_: fromNumber,
    to: toNumber,
    connection_id: connectionId,
  });

  // Extract serializable data — SDK objects are NOT JSON-serializable
  return {
    call_control_id: response.data.call_control_id,
    from: fromNumber,
    to: toNumber,
  };
}

/**
 * Transfer an active call to a new destination.
 * Requires the call_control_id from the initiated call.
 */
async function transferCall(callControlId, transferTo) {
  if (!callControlId) {
    throw new Error("call_control_id is required for transfer");
  }

  if (!transferTo.startsWith("+")) {
    throw new Error(
      "Transfer number must be in E.164 format (e.g., +15551234567)"
    );
  }

  // Use client.calls.actions.transfer() to transfer the call
  const response = await client.calls.actions.transfer(callControlId, {
    to: transferTo,
  });

  // Extract serializable data
  return {
    call_control_id: response.data.call_control_id,
    status: response.data.state,
  };
}

module.exports = { initiateCall, transferCall, activeCalls };
```

## Complete Code

See [`server.js`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/transfer-live-phone-calls-nodejs/server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Express server. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Connection ID Not Set | The application raises `Error: TELNYX_CONNECTION_ID environment variable not set` on the first call initiation. | Confirm your `.env` file exists in the same directory as `app.js` and contains the `TELNYX_CONNECTION_ID` variable. This is your Call Control Application ID from the Telnyx Portal. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `require("dotenv").config()` call must execute before `process.env` is accessed. |
| Webhook Events Not Received | The `/webhooks/call` endpoint is not being called after initiating a call. | Verify that the `WEBHOOK_URL` in your `.env` file is publicly accessible and matches the webhook URL configured in your Call Control Application settings in the Telnyx Portal. If testing locally, use ngrok to expose your Express server: `ngrok http 3000`, then update the webhook URL in the Portal to the ngrok URL. Ensure your firewall allows inbound HTTPS traffic on port 443. |
| Transfer Fails with Invalid Call Control ID | The transfer endpoint returns a 400 error or "call not found" message. | Ensure the `call_control_id` from the initiate response is being passed correctly to the transfer endpoint. The call must still be active (not already hung up). Check the webhook logs to confirm the call reached the `call.answered` state before attempting transfer. |

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

- [Inbound Call Webhook with Node.js](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/nodejs/inbound-call-webhook).
- [Record Calls with Node.js](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/nodejs/call-recording).
- [Build an IVR Menu with Node.js](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/nodejs/ivr-menu).
