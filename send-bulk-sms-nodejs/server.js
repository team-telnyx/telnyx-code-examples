#!/usr/bin/env node
/**
 * Production-ready Express server for sending bulk SMS via Telnyx.
 * Includes rate limiting, error handling, and batch processing.
 */

const Telnyx = require("telnyx");
const express = require("express");
require("dotenv").config();

const app = express();
app.use(express.json());

// Initialize client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

/**
 * Sleep utility for rate limiting between API calls.
 * @param {number} ms - Milliseconds to sleep.
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send a single SMS message via Telnyx.
 * @param {string} toNumber - Recipient phone number in E.164 format.
 * @param {string} message - Message text.
 * @returns {Promise<Object>} JSON-serializable response data.
 */
async function sendSingleSMS(toNumber, message) {
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

  // Use client.messages.create() with the new SDK pattern
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
 * Send bulk SMS with rate limiting and error tracking.
 * @param {Array<Object>} recipients - Array of {to: string, message: string}.
 * @param {number} delayMs - Delay between API calls in milliseconds.
 * @returns {Promise<Object>} Summary with successful and failed sends.
 */
async function sendBulkSMS(recipients, delayMs = 100) {
  const results = {
    successful: [],
    failed: [],
    total: recipients.length,
  };

  for (let i = 0; i < recipients.length; i++) {
    const { to, message } = recipients[i];

    try {
      const result = await sendSingleSMS(to, message);
      results.successful.push(result);
    } catch (error) {
      results.failed.push({
        to,
        error: error.message,
        index: i,
      });
    }

    // Rate limiting: sleep between requests (except after the last one)
    if (i < recipients.length - 1) {
      await sleep(delayMs);
    }
  }

  return results;
}

/**
 * POST /sms/send-bulk
 * Send bulk SMS to multiple recipients.
 * Request body: { recipients: [{to: "+1...", message: "..."}, ...] }
 */
app.post("/sms/send-bulk", async (req, res) => {
  const { recipients } = req.body;

  // Validate request structure
  if (!recipients || !Array.isArray(recipients)) {
    return res.status(400).json({
      error: "Request body must contain 'recipients' array",
    });
  }

  if (recipients.length === 0) {
    return res.status(400).json({
      error: "Recipients array cannot be empty",
    });
  }

  // Validate each recipient
  for (let i = 0; i < recipients.length; i++) {
    const { to, message } = recipients[i];
    if (!to || !message) {
      return res.status(400).json({
        error: `Recipient at index ${i} missing required fields: 'to' and 'message'`,
      });
    }
  }

  try {
    const delayMs = parseInt(process.env.RATE_LIMIT_DELAY_MS || "100", 10);
    const results = await sendBulkSMS(recipients, delayMs);

    return res.status(200).json({
      summary: {
        total: results.total,
        successful: results.successful.length,
        failed: results.failed.length,
      },
      successful: results.successful,
      failed: results.failed,
    });
  } catch (error) {
    // Catch Telnyx SDK exceptions in the route handler
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
        error: error.message,
        status_code: error.status_code,
      });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({
        error: "Network error connecting to Telnyx",
      });
    }

    // Generic error fallback
    return res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

/**
 * POST /sms/send-single
 * Send a single SMS message (for testing).
 * Request body: { to: "+1...", message: "..." }
 */
app.post("/sms/send-single", async (req, res) => {
  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({
      error: "Missing required fields: 'to' and 'message'",
    });
  }

  try {
    const result = await sendSingleSMS(to, message);
    return res.status(200).json(result);
  } catch (error) {
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
        error: error.message,
        status_code: error.status_code,
      });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({
        error: "Network error connecting to Telnyx",
      });
    }

    return res.status(400).json({ error: error.message });
  }
});

/**
 * GET /health
 * Health check endpoint.
 */
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Telnyx bulk SMS server running on http://localhost:${PORT}`);
});
