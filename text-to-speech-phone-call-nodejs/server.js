#!/usr/bin/env node
/**
 * Production-ready Express server for text-to-speech voice calls via Telnyx.
 * Initiates outbound calls and plays TTS messages on answer.
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
 * Initiate an outbound call and prepare for TTS playback.
 * Returns call_control_id for subsequent control actions.
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
 * Play text-to-speech message on an active call.
 * Requires call_control_id from an initiated or answered call.
 */
async function playTTS(callControlId, message, language = "en-US") {
  if (!callControlId) {
    throw new Error("call_control_id is required to play TTS");
  }

  // Use client.calls.actions.speak() to play TTS
  const response = await client.calls.actions.speak(callControlId, {
    payload: message,
    language: language,
    voice: "female",
  });

  // Extract serializable data
  return {
    call_control_id: response.data.call_control_id,
    status: response.data.status,
  };
}

/**
 * POST /calls/initiate
 * Initiates an outbound call and returns call_control_id.
 */
app.post("/calls/initiate", async (req, res) => {
  const { to, message } = req.body;

  if (!to || !message) {
    return res
      .status(400)
      .json({ error: "Missing required fields: 'to' and 'message'" });
  }

  try {
    const callData = await initiateCall(to);
    return res.status(200).json(callData);
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
    // Handle validation errors
    return res.status(400).json({ error: error.message });
  }
});

/**
 * POST /calls/:callControlId/speak
 * Plays text-to-speech on an active call.
 */
app.post("/calls/:callControlId/speak", async (req, res) => {
  const { callControlId } = req.params;
  const { message, language } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Missing required field: 'message'" });
  }

  try {
    const result = await playTTS(callControlId, message, language || "en-US");
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
 * Receives call control events from Telnyx.
 * Automatically plays TTS when call is answered.
 */
app.post("/webhooks/call", async (req, res) => {
  const event = req.body.data;

  // Log the event for debugging
  console.log(`Received event: ${event.event_type}`);

  // Handle call.answered event — play TTS automatically
  if (event.event_type === "call.answered") {
    const callControlId = event.call_control_id;
    const message =
      "Hello! This is a text-to-speech message from Telnyx. Thank you for calling.";

    try {
      await playTTS(callControlId, message);
      console.log(`TTS played on call ${callControlId}`);
    } catch (error) {
      console.error(`Failed to play TTS: ${error.message}`);
    }
  }

  // Handle call.hangup event — clean up resources
  if (event.event_type === "call.hangup") {
    console.log(`Call ${event.call_control_id} ended`);
  }

  // Always return 200 to acknowledge receipt
  return res.status(200).json({ status: "received" });
});

/**
 * GET /health
 * Health check endpoint for monitoring.
 */
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Webhook URL: ${process.env.WEBHOOK_URL}`);
});
