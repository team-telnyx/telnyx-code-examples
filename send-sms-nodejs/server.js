#!/usr/bin/env node
/**
 * Production-ready Express endpoint for sending SMS via Telnyx.
 * Usage: node app.js
 */

const express = require("express");
const Telnyx = require("telnyx");
require("dotenv").config();

// Initialize client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

async function sendSms(toNumber, message) {
  /**
   * Send SMS via Telnyx and return JSON-serializable response data.
   * Throws errors for invalid input or API failures.
   */
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

  // Use client.messages.create() to send the SMS
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

const app = express();
app.use(express.json());

app.post("/sms/send", async (req, res) => {
  /**
   * HTTP endpoint to send single SMS.
   * Expects JSON body with 'to' and 'message' fields.
   */
  const { to, message } = req.body;

  // Validate required fields
  if (!to || !message) {
    return res
      .status(400)
      .json({ error: "Missing required fields: 'to' and 'message'" });
  }

  try {
    const result = await sendSms(to, message);
    return res.status(200).json(result);
  } catch (error) {
    // Handle Telnyx-specific errors with appropriate HTTP status codes
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof Telnyx.RateLimitError) {
      return res
        .status(429)
        .json({ error: "Rate limit exceeded. Please slow down." });
    }
    if (error instanceof Telnyx.APIStatusError) {
      return res
        .status(error.status_code || 500)
        .json({ error: error.message, status_code: error.status_code });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res
        .status(503)
        .json({ error: "Network error connecting to Telnyx" });
    }
    // Handle validation errors (from sendSms helper)
    if (error.message.includes("E.164") || error.message.includes("environment")) {
      return res.status(400).json({ error: error.message });
    }
    // Catch-all for unexpected errors
    return res.status(500).json({ error: "Internal server error" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`SMS server running on http://localhost:${PORT}`);
});
