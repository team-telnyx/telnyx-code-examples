#!/usr/bin/env node
/**
 * Production-ready Express endpoint for sending MMS via Telnyx.
 * Supports multiple media attachments and comprehensive error handling.
 */

const Telnyx = require("telnyx");
const express = require("express");
require("dotenv").config();

const app = express();
app.use(express.json());

// Initialize client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

/**
 * Send MMS via Telnyx and return JSON-serializable response data.
 * @param {string} toNumber - Recipient phone number in E.164 format.
 * @param {string} message - Message text content.
 * @param {string[]} mediaUrls - Array of media URLs to attach.
 * @returns {Promise<Object>} JSON-serializable response data.
 */
async function sendMMS(toNumber, message, mediaUrls) {
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

  // Validate media URLs are provided
  if (!mediaUrls || mediaUrls.length === 0) {
    throw new Error("At least one media URL is required for MMS");
  }

  // Use client.messages.create() with media_urls parameter
  const response = await client.messages.create({
    from_: fromNumber,
    to: toNumber,
    text: message,
    media_urls: mediaUrls,
  });

  // Extract serializable data — SDK objects are NOT JSON-serializable
  return {
    message_id: response.data.id,
    status: response.data.to && response.data.to[0] ? response.data.to[0].status : "unknown",
    from: fromNumber,
    to: toNumber,
    media_count: mediaUrls.length,
  };
}

/**
 * HTTP endpoint to send MMS with media attachments.
 * POST /mms/send
 * Body: { "to": "+15559876543", "message": "Check this out!", "media_urls": ["https://example.com/image.jpg"] }
 */
app.post("/mms/send", async (req, res) => {
  const { to, message, media_urls } = req.body;

  // Validate request body
  if (!to || !message || !media_urls) {
    return res.status(400).json({
      error: "Missing required fields: 'to', 'message', and 'media_urls'",
    });
  }

  // Ensure media_urls is an array
  if (!Array.isArray(media_urls)) {
    return res.status(400).json({
      error: "'media_urls' must be an array of URLs",
    });
  }

  try {
    const result = await sendMMS(to, message, media_urls);
    return res.status(200).json(result);
  } catch (error) {
    // Handle Telnyx-specific errors
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }

    if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({
        error: "Rate limit exceeded. Please slow down.",
      });
    }

    if (error instanceof Telnyx.APIStatusError) {
      return res.status(error.status_code || 500).json({
        error: "Failed to send MMS",
        status_code: error.status_code,
      });
    }

    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({
        error: "Network error connecting to Telnyx",
      });
    }

    // Handle validation errors
    if (error.message.includes("E.164") || error.message.includes("environment")) {
      return res.status(400).json({ error: "Invalid request parameters" });
    }

    // Generic error fallback
    return res.status(500).json({
      error: "Internal server error",
      details: "API request failed",
    });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MMS server running on http://localhost:${PORT}`);
});
