#!/usr/bin/env node
/**
 * Production-ready Express voicemail application using Telnyx Voice API.
 * Handles inbound calls, records voicemail, and provides retrieval endpoints.
 */

const express = require("express");
const bodyParser = require("body-parser");
const Telnyx = require("telnyx");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Initialize client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

// In-memory store for active calls and voicemail recordings
// In production, use a database like PostgreSQL or MongoDB
const callStore = new Map();
const voicemailStore = new Map();

/**
 * Answer an inbound call and start recording voicemail.
 * @param {string} callControlId - The call control ID from the webhook event.
 * @returns {Promise<object>} - Response data from the API.
 */
async function answerAndRecord(callControlId) {
  // Answer the call
  const answerResponse = await client.calls.actions.answer(callControlId);

  // Start recording the voicemail
  const recordResponse = await client.calls.actions.startRecording(
    callControlId,
    {
      format: "wav",
    }
  );

  return {
    answered: answerResponse.data,
    recording: recordResponse.data,
  };
}

/**
 * Hangup a call and clean up resources.
 * @param {string} callControlId - The call control ID.
 * @returns {Promise<object>} - Response data from the API.
 */
async function hangupCall(callControlId) {
  const response = await client.calls.actions.hangup(callControlId);
  callStore.delete(callControlId);
  return {"call_control_id": response.data.call_control_id};
}

/**
 * Retrieve voicemail recording details.
 * @param {string} recordingId - The recording ID.
 * @returns {object|null} - Recording metadata or null if not found.
 */
function getRecordingDetails(recordingId) {
  return voicemailStore.get(recordingId) || null;
}

/**
 * Webhook endpoint for Telnyx call events.
 * Handles call.initiated, call.answered, call.hangup, and call.recording.saved events.
 */
app.post("/webhooks/call", async (req, res) => {
  const event = req.body.data;
  const eventType = req.body.type;

  console.log(`Received event: ${eventType}`, event);

  try {
    if (eventType === "call.initiated") {
      // Store call metadata for tracking
      callStore.set(event.call_control_id, {
        from: event.from.phone_number,
        to: event.to.phone_number,
        initiatedAt: new Date(),
      });

      // Answer the call and start recording
      await answerAndRecord(event.call_control_id);

      res.json({ status: "call answered and recording started" });
    } else if (eventType === "call.answered") {
      // Call is now connected; recording is active
      res.json({ status: "call connected" });
    } else if (eventType === "call.recording.saved") {
      // Recording is complete and available for download
      const callData = callStore.get(event.call_control_id);

      voicemailStore.set(event.recording_id, {
        recordingId: event.recording_id,
        callControlId: event.call_control_id,
        from: callData?.from,
        to: callData?.to,
        duration: event.duration_millis,
        downloadUrl: event.download_urls?.wav,
        savedAt: new Date(),
      });

      console.log(`Voicemail saved: ${event.recording_id}`);
      res.json({ status: "recording saved" });
    } else if (eventType === "call.hangup") {
      // Call ended; clean up resources
      await hangupCall(event.call_control_id);
      res.json({ status: "call ended" });
    } else {
      res.json({ status: "event processed" });
    }
  } catch (error) {
    console.error(`Error processing webhook: ${error.message}`);
    // Always return 200 to acknowledge receipt; log errors for debugging
    res.status(200).json({ error: error.message });
  }
});

/**
 * GET endpoint to retrieve all voicemail messages.
 */
app.get("/voicemail", (req, res) => {
  try {
    const voicemails = Array.from(voicemailStore.values()).map((vm) => ({
      recordingId: vm.recordingId,
      from: vm.from,
      to: vm.to,
      duration: vm.duration,
      downloadUrl: vm.downloadUrl,
      savedAt: vm.savedAt,
    }));

    res.json({ voicemails, count: voicemails.length });
  } catch (error) {
    console.error(`Error retrieving voicemail: ${error.message}`);
    res.status(500).json({ error: "Failed to retrieve voicemail messages" });
  }
});

/**
 * GET endpoint to retrieve a specific voicemail message.
 */
app.get("/voicemail/:recordingId", (req, res) => {
  try {
    const voicemail = getRecordingDetails(req.params.recordingId);

    if (!voicemail) {
      return res.status(404).json({ error: "Voicemail not found" });
    }

    res.json(voicemail);
  } catch (error) {
    console.error(`Error retrieving voicemail: ${error.message}`);
    res.status(500).json({ error: "Failed to retrieve voicemail" });
  }
});

/**
 * Global error handler for Telnyx API exceptions.
 */
app.use((err, req, res, next) => {
  console.error(`Unhandled error: ${err.message}`);

  if (err instanceof Telnyx.AuthenticationError) {
    return res.status(401).json({ error: "Invalid API key" });
  }

  if (err instanceof Telnyx.RateLimitError) {
    return res
      .status(429)
      .json({ error: "Rate limit exceeded. Please slow down." });
  }

  if (err instanceof Telnyx.APIError) {
    return res.status(err.status_code).json({
      error: err.message,
      status_code: err.status_code,
    });
  }

  if (err instanceof Telnyx.APIConnectionError) {
    return res
      .status(503)
      .json({ error: "Network error connecting to Telnyx" });
  }

  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Voicemail server running on port ${PORT}`);
  console.log(`Webhook URL: ${process.env.WEBHOOK_URL}`);
});
