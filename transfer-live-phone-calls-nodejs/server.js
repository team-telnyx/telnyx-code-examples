#!/usr/bin/env node
/**
 * Production-ready Express application for call transfer via Telnyx Voice API.
 * Demonstrates outbound call initiation and transfer using Call Control.
 */

const Telnyx = require("telnyx");
const express = require("express");
const bodyParser = require("body-parser");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Initialize client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

// In-memory store for active calls (use a database in production)
const activeCalls = new Map();

/**
 * Initiate an outbound call.
 * Returns the call_control_id for subsequent control actions.
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

  // Use client.calls.dial() to initiate the call
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
  };
}

/**
 * Transfer an active call to a new destination.
 * Requires the call_control_id from the initiated call.
 */
async function transferCall(callControlId, transferTo) {
  if (!callControlId) {
    throw new Error("call_control_id is required for transfer");
  }

  if (!transferTo.startsWith("+")) {
    throw new Error(
      "Transfer number must be in E.164 format (e.g., +15551234567)"
    );
  }

  // Use client.calls.actions.transfer() to transfer the call
  const response = await client.calls.actions.transfer(callControlId, {
    to: transferTo,
  });

  // Extract serializable data
  return {
    call_control_id: response.data.call_control_id,
    status: response.data.state,
  };
}

/**
 * POST /calls/initiate
 * Initiates an outbound call.
 * Request body: { "to": "+15559876543" }
 */
app.post("/calls/initiate", async (req, res) => {
  const { to } = req.body;

  if (!to) {
    return res.status(400).json({ error: "Missing required field: 'to'" });
  }

  try {
    const result = await initiateCall(to);
    // Store the call in memory for later transfer
    activeCalls.set(result.call_control_id, {
      to: result.to,
      from: result.from,
      initiatedAt: new Date(),
    });
    return res.status(200).json(result);
  } catch (error) {
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
    return res.status(400).json({ error: error.message });
  }
});

/**
 * POST /calls/transfer
 * Transfers an active call to a new destination.
 * Request body: { "call_control_id": "...", "transfer_to": "+15551111111" }
 */
app.post("/calls/transfer", async (req, res) => {
  const { call_control_id, transfer_to } = req.body;

  if (!call_control_id || !transfer_to) {
    return res.status(400).json({
      error: "Missing required fields: 'call_control_id' and 'transfer_to'",
    });
  }

  try {
    const result = await transferCall(call_control_id, transfer_to);
    return res.status(200).json(result);
  } catch (error) {
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
    return res.status(400).json({ error: error.message });
  }
});

/**
 * POST /webhooks/call
 * Receives webhook events from Telnyx Call Control.
 * Events: call.initiated, call.answered, call.hangup, etc.
 */
app.post("/webhooks/call", (req, res) => {
  const event = req.body.data;

  if (!event) {
    return res.status(400).json({ error: "Invalid webhook payload" });
  }

  const callControlId = event.call_control_id;
  const eventType = req.body.type;

  console.log(`[${eventType}] Call ${callControlId}: ${event.state}`);

  // Handle call lifecycle events
  if (eventType === "call.initiated") {
    console.log(`Call initiated: ${callControlId}`);
  } else if (eventType === "call.answered") {
    console.log(`Call answered: ${callControlId}`);
  } else if (eventType === "call.hangup") {
    console.log(`Call ended: ${callControlId}`);
    // Clean up the call from memory
    activeCalls.delete(callControlId);
  }

  // Always respond with 200 to acknowledge receipt
  res.status(200).json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Express server running on port ${PORT}`);
  console.log(`Webhook URL: ${process.env.WEBHOOK_URL}`);
});
