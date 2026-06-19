# Two Way SMS with Node.js and Express

## What Does This Example Do?

Build a production-ready Express application that sends and receives SMS messages using the Telnyx Node.js SDK. This tutorial demonstrates bidirectional messaging, webhook handling for inbound SMS, proper error handling for telecom APIs, and secure credential management via environment variables. You'll create endpoints for sending messages and receiving inbound webhooks, enabling real-time two-way conversations.

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

- Node.js 14 or higher and npm.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for inbound and outbound SMS.
- A publicly accessible URL for webhook delivery (ngrok, Cloudflare Tunnel, or deployed server).
- curl or Postman for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/two-way-sms-chat-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/two-way-sms-chat-nodejs
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` with helper functions for sending SMS and a webhook handler for receiving inbound messages:

```javascript
const express = require('express');
const bodyParser = require('body-parser');
const Telnyx = require('telnyx');
const config = require('./config');

const app = express();

// Middleware
app.use(bodyParser.json());

// Initialize Telnyx client with the new SDK pattern
const client = new Telnyx({ apiKey: config.apiKey });

/**
 * Send SMS via Telnyx and return JSON-serializable response data.
 * @param {string} toNumber - Recipient phone number in E.164 format.
 * @param {string} message - Message text to send.
 * @returns {Promise<Object>} Serializable response object.
 */
async function sendSms(toNumber, message) {
  // Validate E.164 format to prevent API errors
  if (!toNumber.startsWith('+')) {
    throw new Error('Phone number must be in E.164 format (e.g., +15551234567)');
  }

  // Use client.messages.create() to send the message
  const response = await client.messages.create({
    from_: config.phoneNumber,
    to: toNumber,
    text: message,
  });

  // Extract serializable data — SDK objects are NOT JSON-serializable
  return {
    message_id: response.data.id,
    status: response.data.to && response.data.to.length > 0 
      ? response.data.to[0].status 
      : 'unknown',
    from: config.phoneNumber,
    to: toNumber,
    direction: 'outbound',
  };
}

/**
 * POST /sms/send
 * HTTP endpoint to send a single SMS message.
 */
app.post('/sms/send', async (req, res) => {
  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({
      error: "Missing required fields: 'to' and 'message'",
    });
  }

  try {
    const result = await sendSms(to, message);
    return res.status(200).json(result);
  } catch (error) {
    // Handle Telnyx-specific errors
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({
        error: 'Rate limit exceeded. Please slow down.',
      });
    }
    if (error instanceof Telnyx.APIStatusError) {
      return res.status(error.status_code || 500).json({
        error: error.message,
        status_code: error.status_code,
      });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({
        error: 'Network error connecting to Telnyx',
      });
    }
    // Handle validation errors
    if (error.message.includes('E.164 format')) {
      return res.status(400).json({ error: error.message });
    }
    // Generic error handler
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /webhooks/sms
 * Webhook endpoint to receive inbound SMS messages from Telnyx.
 * Telnyx sends a POST request with message.received event data.
 */
app.post('/webhooks/sms', async (req, res) => {
  const event = req.body;

  // Validate webhook event structure
  if (!event.data || !event.data.payload) {
    return res.status(400).json({ error: 'Invalid webhook payload' });
  }

  const payload = event.data.payload;

  // Handle message.received events
  if (event.type === 'message.received') {
    const inboundMessage = {
      message_id: payload.id,
      from: payload.from.phone_number,
      to: payload.to[0]?.phone_number || 'unknown',
      text: payload.text,
      direction: 'inbound',
      received_at: payload.received_at,
    };

    console.log('Inbound SMS received:', inboundMessage);

    // Process the inbound message (e.g., store in database, trigger business logic)
    // For this example, we'll just log and acknowledge receipt
    try {
      // Optional: Send an automatic reply
      await sendSms(inboundMessage.from, 'Thanks for your message! We received it.');
    } catch (error) {
      console.error('Failed to send auto-reply:', error.message);
      // Don't fail the webhook response — Telnyx needs a 200 OK
    }

    // Always return 200 OK to acknowledge webhook receipt
    return res.status(200).json({
      success: true,
      message_id: inboundMessage.message_id,
    });
  }

  // Handle other event types (message.sent, message.finalized, etc.)
  if (event.type === 'message.sent') {
    console.log('Message sent:', payload.id);
    return res.status(200).json({ success: true });
  }

  if (event.type === 'message.finalized') {
    console.log('Message finalized:', {
      id: payload.id,
      status: payload.to[0]?.status || 'unknown',
    });
    return res.status(200).json({ success: true });
  }

  // Acknowledge unknown event types
  return res.status(200).json({ success: true });
});

/**
 * GET /health
 * Health check endpoint for monitoring.
 */
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Error handler middleware for uncaught exceptions
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
  });
});

// Start the server
app.listen(config.port, () => {
  console.log(`Express server running on port ${config.port}`);
  console.log(`Webhook URL: ${config.webhookUrl}/webhooks/sms`);
});
```

## Complete Code

See [`server.js`](./server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Express server. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Webhook Not Receiving Messages | Inbound SMS are not triggering the `/webhooks/sms` endpoint, or you see no logs. | Confirm the webhook URL is publicly accessible and matches the URL configured in the Telnyx Portal. Use ngrok (`ngrok http 3000`) to expose your local server during development, then update the Portal webhook URL to `https://your-ngrok-url.ngrok.io/webhooks/sms`. Verify the Messaging Profile has **message.received** events enabled. Check server logs for incoming POST requests. |
| Environment Variables Not Loaded | The application crashes with "TELNYX_API_KEY environment variable is required" even though `.env` exists. | Confirm the `.env` file is in the same directory as `app.js` and contains the variables. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `require('dotenv').config()` call must execute before accessing `process.env`. Restart the server after creating or modifying `.env`. |
| Rate Limit Errors (429) | Requests return `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | Telnyx enforces rate limits on API calls. Implement exponential backoff and request queuing in your application. Space out requests by at least 100ms. For bulk messaging, use the Telnyx Number Pool feature for automatic from-number rotation to increase throughput. |

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

- [Send Bulk SMS Messages](/tutorials/sms/nodejs/send-bulk-sms).
- [Implement Two-Factor Authentication with SMS](/tutorials/sms/nodejs/otp-2fa).
- [Receive SMS Webhooks](/tutorials/sms/nodejs/receive-sms-webhook).
