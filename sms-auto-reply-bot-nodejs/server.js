#!/usr/bin/env node
/**
 * Production-ready SMS Autoresponder using Node.js and Express.
 * Receives inbound SMS via webhooks and sends automatic replies.
 */

const express = require("express");
const bodyParser = require("body-parser");
const Telnyx = require("telnyx");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Initialize client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

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
    from_: fromNumber,
    to: toNumber,
    text: message,
  });

  // Extract serializable data — SDK objects are NOT JSON-serializable
  return {
    message_id: response.data.id,
    status: response.data.to && response.data.to[0] ? response.data.to[0].status : "unknown",
    from: fromNumber,
    to: toNumber,
  };
}

/**
 * Webhook endpoint to receive inbound SMS messages.
 * Telnyx sends POST requests to this endpoint when SMS is received.
 */
app.post("/webhooks/sms", async (req, res) => {
  const event = req.body;

  // Verify the event type is message.received
  if (event.data && event.data.record_type === "message" && event.type === "message.received") {
    const inboundMessage = event.data;
    const fromNumber = inboundMessage.from.phone_number;
    const messageText = inboundMessage.text;

    console.log(`Received SMS from ${fromNumber}: ${messageText}`);

    // Generate autoresponse based on message content
    let autoresponseText = "Thank you for your message. We will respond shortly.";
    if (messageText.toLowerCase().includes("help")) {
      autoresponseText = "Help is on the way! Our team will contact you soon.";
    } else if (messageText.toLowerCase().includes("hours")) {
      autoresponseText = "We are open Monday-Friday, 9 AM - 5 PM EST.";
    }

    try {
      // Send autoresponse
      const result = await sendSMS(fromNumber, autoresponseText);
      console.log(`Sent autoresponse: ${result.message_id}`);
      res.status(200).json({ success: true, message_id: result.message_id });
    } catch (error) {
      // Catch Telnyx exceptions in the route handler
      if (error instanceof Telnyx.AuthenticationError) {
        console.error("Authentication error:", error.message);
        return res.status(401).json({ error: "Invalid API key" });
      } else if (error instanceof Telnyx.RateLimitError) {
        console.error("Rate limit exceeded:", error.message);
        return res.status(429).json({ error: "Rate limit exceeded. Please slow down." });
      } else if (error instanceof Telnyx.APIStatusError) {
        console.error("API error:", error.message);
        return res.status(error.status_code || 500).json({
          error: "API error occurred",
          status_code: error.status_code,
        });
      } else if (error instanceof Telnyx.APIConnectionError) {
        console.error("Connection error:", error.message);
        return res.status(503).json({ error: "Network error connecting to Telnyx" });
      } else {
        console.error("Unexpected error:", error.message);
        return res.status(400).json({ error: "Request processing failed" });
      }
    }
  } else {
    // Acknowledge other event types without processing
    res.status(200).json({ acknowledged: true });
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
    res.status(200).json(result);
  } catch (error) {
    // Catch Telnyx exceptions in the route handler
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    } else if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({ error: "Rate limit exceeded. Please slow down." });
    } else if (error instanceof Telnyx.APIStatusError) {
      return res.status(error.status_code || 500).json({
        error: "Failed to process webhook",
        status_code: error.status_code,
      });
    } else if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({ error: "Network error connecting to Telnyx" });
    } else {
      return res.status(400).json({ error: "Invalid request" });
    }
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
  console.log(`Webhook URL: ${process.env.WEBHOOK_URL}`);
});
