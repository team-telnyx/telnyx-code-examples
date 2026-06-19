# Delivery Receipts with Node.js and Express

## What Does This Example Do?

Build a production-ready Express application that receives and processes SMS delivery receipts from Telnyx. This tutorial demonstrates webhook configuration, message status tracking, and proper error handling for telecom APIs. You'll set up an endpoint to receive delivery status updates and store them for monitoring outbound message performance.

## Who Is This For?

- **Node.js developers** building sms features with Express.
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
- A Telnyx phone number enabled for outbound SMS.
- npm (Node package manager).
- A publicly accessible URL for webhook delivery (ngrok, Cloudflare Tunnel, or deployed server).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-delivery-receipts-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-delivery-receipts-nodejs
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` and initialize the Telnyx client with proper webhook handling:

```javascript
const express = require("express");
const bodyParser = require("body-parser");
const Telnyx = require("telnyx");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Initialize Telnyx client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

// In-memory store for delivery receipts (use a database in production)
const deliveryReceipts = {};

/**
 * Send SMS and track message ID for delivery receipt matching.
 * Returns JSON-serializable response data.
 */
async function sendSMS(toNumber, message) {
  const fromNumber = process.env.TELNYX_PHONE_NUMBER;
  if (!fromNumber) {
    throw new Error("TELNYX_PHONE_NUMBER environment variable not set");
  }

  // Validate E.164 format to prevent API errors
  if (!toNumber.startsWith("+")) {
    throw new Error(
      "Phone number must be in E.164 format (e.g., +15551234567)"
    );
  }

  const response = await client.messages.create({
    from_: fromNumber,
    to: toNumber,
    text: message,
  });

  // Extract serializable data — SDK objects are NOT JSON-serializable
  const messageId = response.data.id;
  const status = response.data.to && response.data.to[0] ? response.data.to[0].status : "unknown";

  // Initialize receipt tracking for this message
  deliveryReceipts[messageId] = {
    id: messageId,
    from: fromNumber,
    to: toNumber,
    status: status,
    sentAt: new Date().toISOString(),
    deliveredAt: null,
    failureReason: null,
  };

  return {
    message_id: messageId,
    status: status,
    from: fromNumber,
    to: toNumber,
  };
}

/**
 * Process incoming delivery receipt webhook from Telnyx.
 * Updates message status based on finalized event.
 */
function processDeliveryReceipt(event) {
  const messageId = event.data.id;
  const eventType = event.type;

  if (!deliveryReceipts[messageId]) {
    // Message not found in our tracking store
    console.warn(`Received event for unknown message ID: ${messageId}`);
    return null;
  }

  const receipt = deliveryReceipts[messageId];

  // Update status based on event type
  if (eventType === "message.finalized") {
    const finalStatus = event.data.to && event.data.to[0] ? event.data.to[0].status : "unknown";
    receipt.status = finalStatus;

    if (finalStatus === "delivered") {
      receipt.deliveredAt = new Date().toISOString();
    } else if (finalStatus === "failed") {
      receipt.failureReason =
        event.data.to && event.data.to[0] ? event.data.to[0].error?.message : "Unknown error";
    }
  }

  return receipt;
}

// Route to send SMS
app.post("/sms/send", async (req, res) => {
  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({
      error: "Missing required fields: 'to' and 'message'",
    });
  }

  try {
    const result = await sendSMS(to, message);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    } else if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({
        error: "Rate limit exceeded. Please slow down.",
      });
    } else if (error instanceof Telnyx.APIStatusError) {
      return res.status(error.status_code).json({
        error: error.message,
        status_code: error.status_code,
      });
    } else if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({
        error: "Network error connecting to Telnyx",
      });
    } else if (error instanceof Error && error.message.includes("E.164")) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Webhook endpoint to receive delivery receipts
app.post("/webhooks/sms", (req, res) => {
  const event = req.body;

  // Validate webhook signature in production
  // See Telnyx documentation for signature verification

  if (event.type === "message.finalized") {
    const receipt = processDeliveryReceipt(event);
    if (receipt) {
      console.log(`Delivery receipt processed for message ${receipt.id}: ${receipt.status}`);
    }
  }

  // Always return 200 to acknowledge receipt
  res.status(200).json({ success: true });
});

// Route to retrieve delivery receipt status
app.get("/receipts/:messageId", (req, res) => {
  const { messageId } = req.params;
  const receipt = deliveryReceipts[messageId];

  if (!receipt) {
    return res.status(404).json({ error: "Message not found" });
  }

  return res.status(200).json(receipt);
});

// Route to list all delivery receipts
app.get("/receipts", (req, res) => {
  const receipts = Object.values(deliveryReceipts);
  return res.status(200).json(receipts);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Webhook URL: ${process.env.WEBHOOK_URL}`);
});
```

## Complete Code

See [`server.js`](./server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook events not received | The `/webhooks/sms` endpoint is not receiving `message.finalized` events from Telnyx. | Verify that your Messaging Profile in the [Telnyx Portal](https://portal.telnyx.com) has the webhook URL configured correctly. Ensure the URL is publicly accessible (test with `curl https://your-url/webhooks/sms`). If using ngrok, confirm the tunnel is active and the URL in your `.env` matches the ngrok forwarding URL. Check server logs for incoming POST requests. |
| Delivery receipt status shows "queued" indefinitely | Messages remain in "queued" status and never transition to "delivered" or "failed". | This is normal for the first few seconds after sending. Delivery status updates are asynchronous and may take 10–30 seconds depending on carrier. Ensure your Messaging Profile webhook is configured and the server is running. Check the Telnyx Portal message logs to verify the actual delivery status. If messages show "failed" in the portal but not in your app, the webhook event may not have been received—verify network connectivity and webhook configuration. |
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Express server. Confirm the `.env` file is in the same directory as `app.js` and that `require("dotenv").config()` is called before initializing the Telnyx client. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. Verify the `TELNYX_PHONE_NUMBER` in your `.env` file is also in E.164 format. |
| Message ID not found in receipts | Calling `GET /receipts/:messageId` returns `{"error": "Message not found"}` even though the message was sent successfully. | The in-memory store is cleared when the server restarts. For production, use a persistent database (PostgreSQL, MongoDB, etc.) instead of the in-memory object. Ensure the message ID in your request matches the `message_id` returned from the `/sms/send` endpoint. If testing across server restarts, implement database persistence. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What Node.js version do I need?**

Node.js 18 or higher. Node.js 20 LTS is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)

## Related Examples

- [Receive SMS Webhooks with Node.js](/tutorials/sms/nodejs/receive-sms-webhook).
- [Send Bulk SMS Messages with Node.js](/tutorials/sms/nodejs/send-bulk-sms).
- [Implement Two-Factor Authentication with SMS](/tutorials/sms/nodejs/otp-2fa).
