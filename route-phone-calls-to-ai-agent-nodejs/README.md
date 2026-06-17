# Inbound Call Webhook with Node.js and Express

## What Does This Example Do?

Build a production-ready Express endpoint that receives and handles inbound call webhooks from the Telnyx Voice API. This tutorial demonstrates how to set up a webhook listener, validate incoming call events, answer calls programmatically, and manage call state using the Telnyx Node.js SDK with proper error handling and security practices.

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
- A Telnyx phone number configured with a Call Control Application.
- A publicly accessible URL (ngrok, Heroku, or similar) to receive webhooks.
- npm (Node package manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/route-phone-calls-to-ai-agent-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/route-phone-calls-to-ai-agent-nodejs
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` and initialize the Telnyx client using the new pattern. Define a helper function to handle incoming call events with proper validation:

```javascript
const express = require("express");
const bodyParser = require("body-parser");
const Telnyx = require("telnyx");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Initialize client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

/**
 * Handle incoming call webhook event.
 * Validates the event type and answers the call.
 * @param {Object} event - Webhook event payload from Telnyx.
 * @returns {Object} JSON-serializable response data.
 */
async function handleInboundCall(event) {
  const callControlId = event.data.call_control_id;
  const from = event.data.from;
  const to = event.data.to;
  const eventType = event.data.event_type;

  if (!callControlId) {
    throw new Error("Missing call_control_id in webhook event");
  }

  // Log the incoming call for debugging
  console.log(`Incoming call from ${from} to ${to} (Event: ${eventType})`);

  // Only answer on the 'call.initiated' event
  if (eventType === "call.initiated") {
    // Answer the call using the call_control_id returned in the webhook
    const response = await client.calls.actions.answer(callControlId);

    return {
      call_control_id: response.data.call_control_id,
      status: "answered",
      from: from,
      to: to,
    };
  }

  // For other events (call.answered, call.hangup, etc.), just acknowledge
  return {
    call_control_id: callControlId,
    status: "acknowledged",
    event_type: eventType,
  };
}
```

## Complete Code

See [`server.js`](./server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Node.js server. |
| Webhook Not Triggering | Inbound calls are not reaching your webhook endpoint. | Confirm that your Call Control Application in the [Telnyx Portal](https://portal.telnyx.com) has the correct webhook URL configured (e.g., `https://your-ngrok-url.com/webhooks/inbound-call`). Ensure the URL is publicly accessible and uses HTTPS. Check your server logs for incoming requests. If using ngrok, verify the tunnel is active and the URL hasn't changed. |
| Missing call_control_id | The webhook payload is received but `call_control_id` is undefined or null. | Verify that the webhook event structure matches Telnyx's format. The `call_control_id` is included in the `data` object of the webhook payload. Check the [Telnyx Voice API documentation](https://developers.telnyx.com/docs/voice/api/call-control) to confirm the event schema. Ensure your Call Control Application is properly linked to your phone number. |
| Call Not Answering | The webhook is received and processed, but the call is not answered. | Verify that the `event_type` in the webhook is `call.initiated` before attempting to answer. Check that your API key has permissions to perform call control actions. Review the response from `client.calls.actions.answer()` for error details. Ensure the `call_control_id` is valid and the call hasn't already been terminated. |

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

- [Make an Outbound Call with Node.js](/tutorials/voice/nodejs/outbound-call).
- [Record a Call with Node.js](/tutorials/voice/nodejs/call-recording).
- [Transfer a Call with Node.js](/tutorials/voice/nodejs/call-transfer).
