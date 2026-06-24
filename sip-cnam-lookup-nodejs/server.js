#!/usr/bin/env node
/**
 * Production-ready Express endpoint for CNAM lookup via Telnyx.
 * Performs caller name identification on incoming phone numbers.
 */

const express = require("express");
const Telnyx = require("telnyx");
require("dotenv").config();

const app = express();
app.use(express.json());

// Initialize Telnyx client with API key from environment
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

/**
 * Perform CNAM lookup for a given phone number.
 * @param {string} phoneNumber - Phone number in E.164 format (e.g., +15551234567)
 * @returns {Promise<Object>} CNAM lookup result with caller name and carrier info
 * @throws {Error} If phone number format is invalid or API call fails
 */
async function lookupCNAM(phoneNumber) {
  // Validate E.164 format to prevent API errors
  if (!phoneNumber.startsWith("+")) {
    throw new Error("Phone number must be in E.164 format (e.g., +15551234567)");
  }

  // Remove any non-digit characters except the leading +
  const cleanNumber = phoneNumber.replace(/[^\d+]/g, "");
  if (!/^\+\d{10,15}$/.test(cleanNumber)) {
    throw new Error("Invalid phone number format");
  }

  // Call the CNAM lookup endpoint via REST
  const response = await client.get(`/v2/cnam_lookups/${cleanNumber}`);

  // Extract serializable data from the response
  return {
    phone_number: response.data.phone_number,
    cnam: response.data.cnam,
    carrier_name: response.data.carrier_name || null,
    last_updated: response.data.last_updated || null,
  };
}

/**
 * POST /cnam/lookup
 * Perform CNAM lookup for a phone number.
 * Request body: { "phone_number": "+15551234567" }
 */
app.post("/cnam/lookup", async (req, res) => {
  const { phone_number } = req.body;

  // Validate request payload
  if (!phone_number) {
    return res.status(400).json({
      error: "Missing required field: 'phone_number'",
    });
  }

  try {
    const result = await lookupCNAM(phone_number);
    return res.status(200).json(result);
  } catch (error) {
    // Handle Telnyx-specific errors
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({
        error: "Invalid API key",
      });
    }

    if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({
        error: "Rate limit exceeded. Please slow down.",
      });
    }

    if (error instanceof Telnyx.APIError) {
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

    // Handle validation errors
    if (error.message.includes("E.164 format") || error.message.includes("Invalid phone")) {
      return res.status(400).json({
        error: error.message,
      });
    }

    // Generic error handler
    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

/**
 * GET /health
 * Health check endpoint for monitoring.
 */
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CNAM lookup server running on port ${PORT}`);
});
