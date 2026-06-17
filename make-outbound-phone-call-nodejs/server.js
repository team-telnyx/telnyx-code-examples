#!/usr/bin/env node
/**
 * Production-ready Express endpoint for initiating outbound calls via Telnyx.
 */

const Telnyx = require("telnyx");
const express = require("express");
require("dotenv").config();

// Initialize client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

const app = express();
app.use(express.json());

/**
 * Initiate an outbound call via Telnyx.
 * Returns JSON-serializable response data.
 * @param {string} toNumber - Destination phone number in E.164 format.
 * @returns {Promise<Object>} Call control ID and status.
 * @throws {Error} Validation or API errors.
 */
async function initiateCall(toNumber) {
  const fromNumber = process.env.TELNYX_PHONE_NUMBER;
  const connectionId = process.env.TELNYX_CONNECTION_ID;

  if (!fromNumber) {
    throw new Error("TELNYX_PHONE_NUMBER environment variable not set");
  }

  if (!connectionId) {
    throw new Error("TELNYX_CONNECTION_ID environment variable not set");
  }

  // Validate E.164 format to prevent API errors
  if (!toNumber.startsWith("+")) {
    throw new Error(
      "Phone number must be in E.164 format (e.g., +15551234567)"
    );
  }

  // Initiate the call using client.calls.dial()
  // connection_id is REQUIRED and links the call to your Call Control Application
  // call_control_id is RETURNED in the response — do not pass it as input
  const response = await client.calls.dial({
    from_: fromNumber,
    to: toNumber,
    connection_id: connectionId,
  });

  // Extract serializable data — SDK objects are NOT JSON-serializable
  return {
    call_control_id: response.data.call_control_id,
    from: fromNumber,
    to: toNumber,
    state: response.data.state || "initiated",
  };
}

/**
 * POST /calls/dial
 * Initiates an outbound call to the specified phone number.
 */
app.post("/calls/dial", async (req, res) => {
  const { to } = req.body;

  if (!to) {
    return res.status(400).json({ error: "Missing required field: 'to'" });
  }

  try {
    const result = await initiateCall(to);
    return res.status(200).json(result);
  } catch (error) {
    // Catch Telnyx SDK exceptions in the route handler
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }

    if (error instanceof Telnyx.RateLimitError) {
      return res
        .status(429)
        .json({ error: "Rate limit exceeded. Please slow down." });
    }

    if (error instanceof Telnyx.APIStatusError) {
      return res.status(error.status_code).json({
        error: error.message,
        status_code: error.status_code,
      });
    }

    if (error instanceof Telnyx.APIConnectionError) {
      return res
        .status(503)
        .json({ error: "Network error connecting to Telnyx" });
    }

    // Handle validation errors
    if (error instanceof Error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: "Internal server error" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
