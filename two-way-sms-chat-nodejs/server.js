#!/usr/bin/env node
/**
 * Production-ready Express application for two-way SMS via Telnyx.
 * Handles outbound message sending and inbound webhook delivery.
 */

require('dotenv').config();
const express = require('express');
const Telnyx = require('telnyx');

// Configuration
const config = {
  apiKey: process.env.TELNYX_API_KEY,
  publicKey: process.env.TELNYX_PUBLIC_KEY,
  phoneNumber: process.env.TELNYX_PHONE_NUMBER,
  webhookUrl: process.env.WEBHOOK_URL,
  port: process.env.PORT || 3000,
};

// Validate required environment variables
if (!config.apiKey) {
  throw new Error('TELNYX_API_KEY environment variable is required');
}
if (!config.phoneNumber) {
  throw new Error('TELNYX_PHONE_NUMBER environment variable is required');
}

const app = express();

// Initialize Telnyx client
const client = Telnyx(config.apiKey);

// Capture the raw request body so webhook signatures can be verified.
// Telnyx signs the exact bytes it sent, so the raw payload is required.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

/**
 * Send SMS via Telnyx and return JSON-serializable response data.
 */
async function sendSms(toNumber, message) {
  if (!toNumber.startsWith('+')) {
    throw new Error('Phone number must be in E.164 format (e.g., +15551234567)');
  }

  const response = await client.messages.create({
    from_: config.phoneNumber,
    to: toNumber,
    text: message,
  });

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
 * Send a single SMS message.
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
        error: 'Failed to send message',
        status_code: error.status_code,
      });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({
        error: 'Network error connecting to Telnyx',
      });
    }
    if (error.message && error.message.includes('E.164 format')) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }
    console.error('Failed to send SMS:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /webhooks/sms
 * Receive inbound SMS messages and delivery status updates from Telnyx.
 */
app.post('/webhooks/sms', async (req, res) => {
  // Verify the webhook signature on every request. Reject anything that
  // does not carry a valid Telnyx signature for the raw request body.
  try {
    await client.webhooks.unwrap(req.rawBody.toString(), {
      headers: req.headers,
      key: config.publicKey,
    });
  } catch (err) {
    return res.status(401).json({ error: 'invalid signature' });
  }

  const event = req.body;

  if (!event.data || !event.data.payload) {
    return res.status(400).json({ error: 'Invalid webhook payload' });
  }

  const eventType = event.data.event_type;
  const payload = event.data.payload;

  // Handle inbound messages
  if (eventType === 'message.received') {
    const inboundMessage = {
      message_id: payload.id,
      from: payload.from.phone_number,
      to: payload.to[0]?.phone_number || 'unknown',
      text: payload.text,
      direction: 'inbound',
      received_at: payload.received_at,
    };

    console.log('Inbound SMS received:', inboundMessage);

    try {
      // Send automatic reply
      await sendSms(inboundMessage.from, 'Thanks for your message! We received it.');
    } catch (error) {
      console.error('Failed to send auto-reply:', error);
    }

    return res.status(200).json({
      success: true,
      message_id: inboundMessage.message_id,
    });
  }

  // Handle message sent confirmation
  if (eventType === 'message.sent') {
    console.log('Message sent:', payload.id);
    return res.status(200).json({ success: true });
  }

  // Handle final delivery status
  if (eventType === 'message.finalized') {
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
 * Health check endpoint.
 */
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Error handler middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(config.port, () => {
  console.log(`Express server running on port ${config.port}`);
  console.log(`Webhook URL: ${config.webhookUrl}/webhooks/sms`);
});
