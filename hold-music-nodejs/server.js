#!/usr/bin/env node
/**
 * Production-ready Express application for hold music with Telnyx Voice API.
 * Demonstrates call control, webhook handling, and audio streaming.
 */

const express = require("express");
const bodyParser = require("body-parser");
const Telnyx = require("telnyx");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Initialize client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

// In-memory store for active calls (use a database in production)
const activeCalls = new Map();

/**
 * Initiate an outbound call and place caller on hold.
 * Returns call_control_id for subsequent control actions.
 */
async function initiateCallWithHold(toNumber) {
  const fromNumber = process.env.TELNYX_PHONE_NUMBER;
  const connectionId = process.env.TELNYX_CONNECTION_ID;

  if (!fromNumber || !connectionId) {
    throw new Error(
      "TELNYX_PHONE_NUMBER and TELNYX_CONNECTION_ID environment variables required"
    );
  }

  // Validate E.164 format to prevent API errors
  if (!toNumber.startsWith("+")) {
    throw new Error(
      "Phone number must be in E.164 format (e.g., +15551234567)"
    );
  }

  // Initiate the call — connection_id is REQUIRED, call_control_id is RETURNED
  const response = await client.calls.dial({
    from: fromNumber,
    to: toNumber,
    connection_id: connectionId,
  });

  // Extract call_control_id from response — use for subsequent actions
  const callControlId = response.data.call_control_id;

  // Store call metadata for webhook processing
  activeCalls.set(callControlId, {
    callControlId,
    toNumber,
    fromNumber,
    status: "initiated",
    createdAt: new Date(),
  });

  return {
    call_control_id: callControlId,
    to: toNumber,
    from: fromNumber,
    status: "initiated",
  };
}

/**
 * Play hold music on an active call.
 * Requires call_control_id from the initiated call.
 */
async function playHoldMusic(callControlId) {
  const holdMusicUrl = process.env.HOLD_MUSIC_URL;

  if (!holdMusicUrl) {
    throw new Error("HOLD_MUSIC_URL environment variable not set");
  }

  // Use speak action to play audio file via TTS or direct audio URL
  const response = await client.calls.actions.speak(callControlId, {
    payload: holdMusicUrl,
    language: "en-US",
    voice: "male",
  });

  return {
    call_control_id: callControlId,
    action: "speak",
    status: "playing",
  };
}

/**
 * Hangup an active call and clean up resources.
 */
async function hangupCall(callControlId) {
  const response = await client.calls.actions.hangup(callControlId);

  // Remove from active calls store
  activeCalls.delete(callControlId);

  return {
    call_control_id: callControlId,
    action: "hangup",
    status: "ended",
  };
}

/**
 * POST /calls/initiate — Initiate an outbound call with hold music.
 */
app.post("/calls/initiate", async (req, res) => {
  const { to } = req.body;

  if (!to) {
    return res.status(400).json({ error: "Missing required field: 'to'" });
  }

  try {
    const result = await initiateCallWithHold(to);
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
    if (error instanceof Telnyx.APIError) {
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
    return res.status(400).json({ error: error.message });
  }
});

/**
 * POST /webhooks/call — Receive call control events from Telnyx.
 * Handles call.initiated, call.answered, call.hangup, and other events.
 */
app.post("/webhooks/call", async (req, res) => {
  const event = req.body.data;
  const eventType = req.body.type;

  console.log(`Received event: ${eventType}`, event);

  try {
    // Handle call answered event — play hold music
    if (eventType === "call.answered") {
      const callControlId = event.call_control_id;

      // Update call status in store
      if (activeCalls.has(callControlId)) {
        const callData = activeCalls.get(callControlId);
        callData.status = "answered";
        activeCalls.set(callControlId, callData);
      }

      // Play hold music asynchronously (don't block webhook response)
      playHoldMusic(callControlId).catch((err) => {
        console.error(`Failed to play hold music for ${callControlId}:`, err);
      });
    }

    // Handle call hangup event — clean up resources
    if (eventType === "call.hangup") {
      const callControlId = event.call_control_id;
      activeCalls.delete(callControlId);
      console.log(`Call ${callControlId} ended`);
    }

    // Handle call initiated event — confirm outbound call started
    if (eventType === "call.initiated") {
      const callControlId = event.call_control_id;
      console.log(`Call ${callControlId} initiated`);
    }

    // Always return 200 OK to acknowledge webhook receipt
    return res.status(200).json({ status: "received" });
  } catch (error) {
    console.error("Webhook processing error:", error);
    // Return 200 to prevent Telnyx from retrying
    return res.status(200).json({ status: "error", message: error.message });
  }
});

/**
 * GET /calls/:callControlId — Retrieve call status.
 */
app.get("/calls/:callControlId", async (req, res) => {
  const { callControlId } = req.params;

  try {
    const response = await client.calls.retrieve_status(callControlId);

    return res.status(200).json({
      call_control_id: response.data.call_control_id,
      is_alive: response.data.is_alive,
      state: response.data.state,
    });
  } catch (error) {
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof Telnyx.APIError) {
      return res.status(error.status_code).json({
        error: error.message,
        status_code: error.status_code,
      });
    }
    return res.status(400).json({ error: error.message });
  }
});

/**
 * POST /calls/:callControlId/hangup — Terminate an active call.
 */
app.post("/calls/:callControlId/hangup", async (req, res) => {
  const { callControlId } = req.params;

  try {
    const result = await hangupCall(callControlId);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof Telnyx.APIError) {
      return res.status(error.status_code).json({
        error: error.message,
        status_code: error.status_code,
      });
    }
    return res.status(400).json({ error: error.message });
  }
});

/**
 * GET /health — Health check endpoint.
 */
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Express server running on port ${PORT}`);
  console.log(`Webhook URL: ${process.env.WEBHOOK_URL}`);
});
