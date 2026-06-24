#!/usr/bin/env node
/**
 * Production-ready Express application for warm transfers via Telnyx Voice API.
 * Demonstrates call control, webhook handling, and state management.
 */

const express = require("express");
const bodyParser = require("body-parser");
const telnyx = require("telnyx");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Initialize Telnyx client with the new SDK pattern
const client = new telnyx.Telnyx({
  apiKey: process.env.TELNYX_API_KEY,
});

// In-memory store for call state (use a database in production)
const callState = {};

/**
 * Initiate an outbound call.
 * Returns call_control_id for subsequent control actions.
 */
async function initiateCall(toNumber) {
  const response = await client.calls.dial({
    from: process.env.TELNYX_PHONE_NUMBER,
    to: toNumber,
    connection_id: process.env.TELNYX_CONNECTION_ID,
  });

  // Extract serializable data — SDK objects are NOT JSON-serializable
  return {
    call_control_id: response.data.call_control_id,
    state: "initiated",
  };
}

/**
 * Answer an inbound call.
 */
async function answerCall(callControlId) {
  await client.calls.actions.answer(callControlId);
}

/**
 * Transfer the call to a third party.
 * The agent stays on the line during the transfer (warm transfer).
 */
async function transferCall(callControlId, transferTo) {
  await client.calls.actions.transfer(callControlId, {
    to: transferTo,
  });
}

/**
 * Hangup a call.
 */
async function hangupCall(callControlId) {
  await client.calls.actions.hangup(callControlId);
}

/**
 * Speak text to the call participant.
 */
async function speakToCall(callControlId, text) {
  await client.calls.actions.speak(callControlId, {
    payload: text,
    language: "en-US",
    voice: "female",
  });
}

/**
 * POST /webhooks/call-events
 * Receive and process Telnyx call control webhooks.
 */
app.post("/webhooks/call-events", (req, res) => {
  const event = req.body.data;
  const callControlId = event.call_control_id;

  console.log(`Webhook received: ${event.event_type} for call ${callControlId}`);

  try {
    // Store call state for tracking
    if (!callState[callControlId]) {
      callState[callControlId] = {};
    }

    switch (event.event_type) {
      case "call.initiated":
        // Outbound call started
        callState[callControlId].state = "initiated";
        callState[callControlId].from = event.from;
        callState[callControlId].to = event.to;
        console.log(`Call initiated from ${event.from} to ${event.to}`);
        break;

      case "call.answered":
        // Call connected
        callState[callControlId].state = "answered";
        console.log(`Call answered: ${callControlId}`);
        break;

      case "call.hangup":
        // Call ended — clean up state
        console.log(`Call ended: ${callControlId}`);
        delete callState[callControlId];
        break;

      default:
        console.log(`Unhandled event type: ${event.event_type}`);
    }

    // Always return 200 to acknowledge receipt
    res.status(200).json({ status: "ok" });
  } catch (error) {
    console.error(`Error processing webhook: ${error.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /calls/initiate
 * HTTP endpoint to initiate an outbound call.
 */
app.post("/calls/initiate", async (req, res) => {
  const { to_number } = req.body;

  if (!to_number) {
    return res.status(400).json({ error: "Missing required field: 'to_number'" });
  }

  // Validate E.164 format
  if (!to_number.startsWith("+")) {
    return res
      .status(400)
      .json({ error: "Phone number must be in E.164 format (e.g., +15551234567)" });
  }

  try {
    const result = await initiateCall(to_number);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof telnyx.RateLimitError) {
      return res.status(429).json({ error: "Rate limit exceeded. Please slow down." });
    }
    if (error instanceof telnyx.APIStatusError) {
      return res
        .status(error.status_code || 400)
        .json({ error: error.message, status_code: error.status_code });
    }
    if (error instanceof telnyx.APIConnectionError) {
      return res.status(503).json({ error: "Network error connecting to Telnyx" });
    }
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /calls/:call_control_id/answer
 * HTTP endpoint to answer an inbound call.
 */
app.post("/calls/:call_control_id/answer", async (req, res) => {
  const { call_control_id } = req.params;

  try {
    await answerCall(call_control_id);
    return res.status(200).json({ status: "answered", call_control_id });
  } catch (error) {
    if (error instanceof telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof telnyx.APIStatusError) {
      return res
        .status(error.status_code || 400)
        .json({ error: error.message, status_code: error.status_code });
    }
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /calls/:call_control_id/transfer
 * HTTP endpoint to transfer a call to a third party.
 * The agent stays on the line during the transfer (warm transfer).
 */
app.post("/calls/:call_control_id/transfer", async (req, res) => {
  const { call_control_id } = req.params;
  const { transfer_to } = req.body;

  if (!transfer_to) {
    return res.status(400).json({ error: "Missing required field: 'transfer_to'" });
  }

  // Validate E.164 format
  if (!transfer_to.startsWith("+")) {
    return res
      .status(400)
      .json({ error: "Phone number must be in E.164 format (e.g., +15551234567)" });
  }

  try {
    await transferCall(call_control_id, transfer_to);
    return res.status(200).json({ status: "transferred", call_control_id, transfer_to });
  } catch (error) {
    if (error instanceof telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof telnyx.APIStatusError) {
      return res
        .status(error.status_code || 400)
        .json({ error: error.message, status_code: error.status_code });
    }
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /calls/:call_control_id/speak
 * HTTP endpoint to speak text to a call participant.
 */
app.post("/calls/:call_control_id/speak", async (req, res) => {
  const { call_control_id } = req.params;
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Missing required field: 'text'" });
  }

  try {
    await speakToCall(call_control_id, text);
    return res.status(200).json({ status: "speaking", call_control_id });
  } catch (error) {
    if (error instanceof telnyx.APIStatusError) {
      return res
        .status(error.status_code || 400)
        .json({ error: error.message, status_code: error.status_code });
    }
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /calls/:call_control_id/hangup
 * HTTP endpoint to end a call.
 */
app.post("/calls/:call_control_id/hangup", async (req, res) => {
  const { call_control_id } = req.params;

  try {
    await hangupCall(call_control_id);
    return res.status(200).json({ status: "hangup", call_control_id });
  } catch (error) {
    if (error instanceof telnyx.APIStatusError) {
      return res
        .status(error.status_code || 400)
        .json({ error: error.message, status_code: error.status_code });
    }
    return res.status(500).json({ error: error.message });
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
  console.log(`Express server running on port ${PORT}`);
  console.log(`Webhook URL: ${process.env.WEBHOOK_URL}/webhooks/call-events`);
});
