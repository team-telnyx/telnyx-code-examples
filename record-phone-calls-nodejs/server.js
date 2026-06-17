#!/usr/bin/env node
/**
 * Production-ready Express application for call recording via Telnyx Voice API.
 * Initiates outbound calls, manages recording lifecycle, and handles webhooks.
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
 * Initiate an outbound call and prepare for recording.
 * Returns JSON-serializable call data.
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
  const callControlId = response.data.call_control_id;
  activeCalls.set(callControlId, {
    callControlId,
    to: toNumber,
    from: fromNumber,
    status: "initiated",
    recordingId: null,
  });

  return {
    call_control_id: callControlId,
    to: toNumber,
    from: fromNumber,
    status: "initiated",
  };
}

/**
 * Start recording an active call.
 * Returns JSON-serializable recording data.
 */
async function startRecording(callControlId) {
  if (!activeCalls.has(callControlId)) {
    throw new Error(`Call ${callControlId} not found`);
  }

  // Use client.calls.actions.start_recording() to begin recording
  const response = await client.calls.actions.start_recording(callControlId, {
    format: "wav",
  });

  // Update call state with recording ID
  const callData = activeCalls.get(callControlId);
  callData.recordingId = response.data.recording_id;
  callData.recordingStatus = "recording";

  return {
    call_control_id: callControlId,
    recording_id: response.data.recording_id,
    format: "wav",
    status: "recording",
  };
}

/**
 * Stop recording an active call.
 * Returns JSON-serializable response data.
 */
async function stopRecording(callControlId) {
  if (!activeCalls.has(callControlId)) {
    throw new Error(`Call ${callControlId} not found`);
  }

  // Use client.calls.actions.stop_recording() to end recording
  const response = await client.calls.actions.stop_recording(callControlId);

  // Update call state
  const callData = activeCalls.get(callControlId);
  callData.recordingStatus = "stopped";

  return {
    call_control_id: callControlId,
    recording_id: callData.recordingId,
    status: "stopped",
  };
}

/**
 * Retrieve call status and recording information.
 * Returns JSON-serializable call data.
 */
function getCallStatus(callControlId) {
  if (!activeCalls.has(callControlId)) {
    throw new Error(`Call ${callControlId} not found`);
  }

  const callData = activeCalls.get(callControlId);
  return {
    call_control_id: callControlId,
    to: callData.to,
    from: callData.from,
    status: callData.status,
    recording_id: callData.recordingId,
    recording_status: callData.recordingStatus || "not_started",
  };
}

/**
 * POST /calls/initiate
 * Initiate an outbound call.
 */
app.post("/calls/initiate", async (req, res) => {
  const { to } = req.body;

  if (!to) {
    return res.status(400).json({ error: "Missing required field: 'to'" });
  }

  try {
    const result = await initiateCall(to);
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
 * POST /calls/:callControlId/recording/start
 * Start recording an active call.
 */
app.post("/calls/:callControlId/recording/start", async (req, res) => {
  const { callControlId } = req.params;

  try {
    const result = await startRecording(callControlId);
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
 * POST /calls/:callControlId/recording/stop
 * Stop recording an active call.
 */
app.post("/calls/:callControlId/recording/stop", async (req, res) => {
  const { callControlId } = req.params;

  try {
    const result = await stopRecording(callControlId);
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
 * GET /calls/:callControlId/status
 * Retrieve call and recording status.
 */
app.get("/calls/:callControlId/status", (req, res) => {
  const { callControlId } = req.params;

  try {
    const result = getCallStatus(callControlId);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(404).json({ error: error.message });
  }
});

/**
 * POST /webhooks/call
 * Handle Telnyx call lifecycle webhooks.
 * Events: call.initiated, call.answered, call.hangup, call.recording.saved
 */
app.post("/webhooks/call", (req, res) => {
  const event = req.body.data;
  const callControlId = event.call_control_id;

  console.log(`Webhook event: ${event.event_type} for call ${callControlId}`);

  if (event.event_type === "call.answered") {
    // Call was answered — safe to start recording
    if (activeCalls.has(callControlId)) {
      const callData = activeCalls.get(callControlId);
      callData.status = "answered";
    }
  } else if (event.event_type === "call.hangup") {
    // Call ended — clean up
    if (activeCalls.has(callControlId)) {
      activeCalls.delete(callControlId);
    }
  } else if (event.event_type === "call.recording.saved") {
    // Recording is ready for download
    console.log(`Recording saved: ${event.recording_id}`);
    if (activeCalls.has(callControlId)) {
      const callData = activeCalls.get(callControlId);
      callData.recordingUrl = event.recording_urls?.wav_url;
    }
  }

  // Always respond with 200 to acknowledge receipt
  return res.status(200).json({ received: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Express server listening on port ${PORT}`);
  console.log(`Webhook URL: ${process.env.WEBHOOK_URL}`);
});
