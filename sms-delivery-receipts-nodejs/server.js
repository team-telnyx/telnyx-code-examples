#!/usr/bin/env node
/**
 * Production-ready Express application for SMS delivery receipt tracking via Telnyx.
 * Demonstrates webhook configuration, message status tracking, and error handling.
 */

const express = require("express");
const Telnyx = require("telnyx");
require("dotenv").config();

const app = express();

// Initialize Telnyx client with the new SDK pattern.
// The same client instance is used for sending SMS and for verifying
// inbound webhook signatures via client.webhooks.unwrap().
const client = new Telnyx(process.env.TELNYX_API_KEY);

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
  // event_type lives at the data level; the message fields live in data.payload.
  const eventType = event.data.event_type;
  const payload = event.data.payload || {};
  const messageId = payload.id;

  if (!deliveryReceipts[messageId]) {
    // Message not found in our tracking store
    console.warn(`Received event for unknown message ID: ${messageId}`);
    return null;
  }

  const receipt = deliveryReceipts[messageId];

  // Update status based on event type
  if (eventType === "message.finalized") {
    const finalStatus = payload.to && payload.to[0] ? payload.to[0].status : "unknown";
    receipt.status = finalStatus;

    if (finalStatus === "delivered") {
      receipt.deliveredAt = new Date().toISOString();
    } else if (finalStatus === "failed") {
      receipt.failureReason =
        payload.to && payload.to[0] ? payload.to[0].error?.message : "Unknown error";
    }
  }

  return receipt;
}

// Route to send SMS (JSON body parsed for this route)
app.post("/sms/send", express.json(), async (req, res) => {
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
    // Log the full error server-side; never leak exception text to clients.
    console.error("Failed to send SMS:", error);

    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    } else if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({
        error: "Rate limit exceeded. Please slow down.",
      });
    } else if (error instanceof Telnyx.APIStatusError) {
      return res.status(error.status_code).json({
        error: "Failed to send message",
        status_code: error.status_code,
      });
    } else if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({
        error: "Network error connecting to Telnyx",
      });
    } else if (error instanceof Error && error.message.includes("E.164")) {
      return res.status(400).json({ error: "Invalid phone number format" });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Webhook endpoint to receive delivery receipts.
// express.raw() captures the unparsed body so we can verify the Telnyx
// signature against the exact bytes that were signed.
app.post(
  "/webhooks/sms",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const rawBody = req.body; // Buffer of the raw request body

    // Enforce signature verification on every inbound Telnyx webhook.
    try {
      await client.webhooks.unwrap(rawBody.toString(), {
        headers: req.headers,
        key: process.env.TELNYX_PUBLIC_KEY,
      });
    } catch (err) {
      console.error("Webhook signature verification failed:", err);
      return res.status(401).json({ error: "invalid signature" });
    }

    let event;
    try {
      event = JSON.parse(rawBody.toString());
    } catch (err) {
      console.error("Failed to parse webhook body:", err);
      return res.status(400).json({ error: "invalid payload" });
    }

    // event_type lives at the data level for Telnyx webhooks.
    if (event.data && event.data.event_type === "message.finalized") {
      const receipt = processDeliveryReceipt(event);
      if (receipt) {
        console.log(
          `Delivery receipt processed for message ${receipt.id}: ${receipt.status}`
        );
      }
    }

    // Always return 200 to acknowledge receipt
    res.status(200).json({ success: true });
  }
);

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
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhooks/sms`);
});
