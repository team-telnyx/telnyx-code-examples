#!/usr/bin/env node
/**
 * Production-ready Express webhook receiver for inbound SMS via Telnyx.
 * Validates webhook payloads, processes messages, and responds within 5 seconds.
 */

require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const Telnyx = require("telnyx");

const app = express();

// Middleware to parse JSON request bodies
app.use(bodyParser.json());

// Initialize client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

// In-memory storage for received messages (replace with database in production)
const receivedMessages = [];

/**
 * Process inbound SMS webhook event.
 * Validates webhook payload and extracts message details.
 * @param {Object} payload - Webhook event payload from Telnyx.
 * @returns {Object} Processed message data.
 */
function processInboundSMS(payload) {
  // Validate required fields in webhook payload
  if (!payload.data || !payload.data.payload) {
    throw new Error("Invalid webhook payload structure");
  }

  const messageData = payload.data.payload;

  // Extract message details — ensure fields exist before accessing
  const processedMessage = {
    message_id: messageData.id || null,
    from: messageData.from?.phone_number || null,
    to: messageData.to?.[0]?.phone_number || null,
    text: messageData.text || "",
    received_at: messageData.received_at || new Date().toISOString(),
    direction: messageData.direction || "inbound",
  };

  // Validate critical fields
  if (!processedMessage.from || !processedMessage.to) {
    throw new Error("Missing sender or recipient phone number in webhook");
  }

  return processedMessage;
}

/**
 * Webhook endpoint to receive inbound SMS messages.
 * Telnyx sends POST requests to this endpoint when SMS is received.
 */
app.post("/webhooks/sms", (req, res) => {
  try {
    // Validate webhook payload structure
    if (!req.body || !req.body.data) {
      return res.status(400).json({ error: "Invalid webhook payload" });
    }

    // Process the inbound SMS
    const message = processInboundSMS(req.body);

    // Store message in memory (use database in production)
    receivedMessages.push(message);

    console.log(`[SMS Received] From: ${message.from}, To: ${message.to}`);
    console.log(`Message: ${message.text}`);

    // Respond with 200 OK to acknowledge receipt
    // Telnyx requires a 2xx response within 5 seconds
    res.status(200).json({
      success: true,
      message_id: message.message_id,
      status: "received",
    });
  } catch (error) {
    console.error("Webhook processing error:", error.message);
    // Return 400 for validation errors, but still acknowledge to Telnyx
    res.status(400).json({ error: error.message });
  }
});

/**
 * Health check endpoint to verify server is running.
 */
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * Debug endpoint to view received messages (remove in production).
 */
app.get("/messages", (req, res) => {
  res.status(200).json({
    count: receivedMessages.length,
    messages: receivedMessages,
  });
});

/**
 * Global error handler for uncaught exceptions.
 */
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: "Internal server error",
    message: err.message,
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Express server running on port ${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhooks/sms`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
