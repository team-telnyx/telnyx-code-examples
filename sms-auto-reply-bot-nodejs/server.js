#!/usr/bin/env node
/**
 * Production-ready SMS Autoresponder using Node.js and Express.
 * Receives inbound SMS via signed Telnyx webhooks and sends automatic replies.
 */

const express = require("express");
const Telnyx = require("telnyx");
require("dotenv").config();

const app = express();

// Telnyx webhook signature verification needs the RAW request body, so JSON
// parsing is deferred to per-route handlers that read req.body / rawBody.
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
}));

// Initialize the Telnyx client. Used both for sending SMS and for verifying
// inbound webhook signatures via client.webhooks.unwrap().
const client = Telnyx(process.env.TELNYX_API_KEY);

/**
 * Send SMS via Telnyx and return JSON-serializable response data.
 * @param {string} toNumber - Recipient phone number in E.164 format.
 * @param {string} message - Message text to send.
 * @returns {Promise<Object>} Response data with message ID and status.
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

  // Use client.messages.create() to send the message
  const response = await client.messages.create({
    from: fromNumber,
    to: toNumber,
    text: message,
  });

  // Extract serializable data — SDK objects are NOT JSON-serializable
  return {
    message_id: response.data.id,
    status:
      response.data.to && response.data.to[0]
        ? response.data.to[0].status
        : "unknown",
    from: fromNumber,
    to: toNumber,
  };
}

/**
 * Map a Telnyx SDK error to a generic HTTP response.
 * Exception text is logged server-side only — never returned to the caller.
 */
function handleTelnyxError(error, res) {
  if (error instanceof Telnyx.AuthenticationError) {
    console.error("Authentication error:", error.message);
    return res.status(401).json({ error: "Authentication failed" });
  }
  if (error instanceof Telnyx.RateLimitError) {
    console.error("Rate limit exceeded:", error.message);
    return res.status(429).json({ error: "Rate limit exceeded" });
  }
  if (error instanceof Telnyx.APIStatusError) {
    console.error("API error:", error.message);
    return res.status(502).json({ error: "Upstream API error" });
  }
  if (error instanceof Telnyx.APIConnectionError) {
    console.error("Connection error:", error.message);
    return res.status(503).json({ error: "Network error connecting to Telnyx" });
  }
  console.error("Unexpected error:", error.message);
  return res.status(500).json({ error: "Internal server error" });
}

/**
 * Webhook endpoint to receive inbound SMS messages.
 * Telnyx sends POST requests to this endpoint when SMS is received.
 */
app.post("/webhooks/sms", async (req, res) => {
  // Enforce-always signature verification. Reject anything that is not a
  // genuine, untampered Telnyx webhook before doing any processing.
  try {
    await client.webhooks.unwrap(req.rawBody.toString(), {
      headers: req.headers,
      key: process.env.TELNYX_PUBLIC_KEY,
    });
  } catch {
    return res.status(401).json({ error: "invalid signature" });
  }

  // For Telnyx webhooks event_type lives at the data level; all message
  // fields live inside data.payload.
  const data = req.body.data || {};
  const eventType = data.event_type;
  const payload = data.payload || {};

  if (eventType !== "message.received") {
    // Acknowledge other event types (e.g. delivery receipts) without processing.
    return res.status(200).json({ acknowledged: true });
  }

  const fromNumber = payload.from && payload.from.phone_number;
  const messageText = payload.text || "";

  if (!fromNumber) {
    return res.status(200).json({ acknowledged: true });
  }

  console.log(`Received SMS from ${fromNumber}: ${messageText}`);

  // Generate autoresponse based on message content
  let autoresponseText =
    "Thank you for your message. We will respond shortly.";
  if (messageText.toLowerCase().includes("help")) {
    autoresponseText = "Help is on the way! Our team will contact you soon.";
  } else if (messageText.toLowerCase().includes("hours")) {
    autoresponseText = "We are open Monday-Friday, 9 AM - 5 PM EST.";
  }

  try {
    const result = await sendSMS(fromNumber, autoresponseText);
    console.log(`Sent autoresponse: ${result.message_id}`);
    return res.status(200).json({ success: true, message_id: result.message_id });
  } catch (error) {
    return handleTelnyxError(error, res);
  }
});

/**
 * Manual SMS send endpoint for testing.
 * POST /sms/send with JSON body: { "to": "+15559876543", "message": "Hello" }
 */
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
    return handleTelnyxError(error, res);
  }
});

/**
 * Health check endpoint.
 */
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SMS Autoresponder listening on port ${PORT}`);
  if (process.env.WEBHOOK_URL) {
    console.log(`Webhook URL: ${process.env.WEBHOOK_URL}`);
  }
});
