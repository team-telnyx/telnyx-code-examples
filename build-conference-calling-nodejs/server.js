#!/usr/bin/env node
/**
 * Production-ready Express application for managing conference calls via Telnyx.
 * Demonstrates the command-event model: send commands (dial, hangup), receive webhooks.
 */

const express = require("express");
const bodyParser = require("body-parser");
const Telnyx = require("telnyx");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Initialize Telnyx client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

// In-memory store for active conferences and calls
// In production, use a database like PostgreSQL or Redis
const conferences = new Map();

/**
 * Initiate an outbound call to a participant.
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

  // Call the Telnyx API to initiate the call
  const response = await client.calls.dial({
    from_: fromNumber,
    to: toNumber,
    connection_id: connectionId,
  });

  // Extract and return the call_control_id for subsequent actions
  return {
    call_control_id: response.data.call_control_id,
    to: toNumber,
    from: fromNumber,
  };
}

/**
 * Create a new conference and store its metadata.
 */
function createConference(conferenceId, participants) {
  const conference = {
    id: conferenceId,
    participants: participants || [],
    created_at: new Date().toISOString(),
    status: "pending",
  };
  conferences.set(conferenceId, conference);
  return conference;
}

/**
 * Add a participant to an existing conference.
 */
function addParticipantToConference(conferenceId, callControlId, phoneNumber) {
  const conference = conferences.get(conferenceId);
  if (!conference) {
    throw new Error(`Conference ${conferenceId} not found`);
  }

  conference.participants.push({
    call_control_id: callControlId,
    phone_number: phoneNumber,
    joined_at: new Date().toISOString(),
    status: "pending",
  });

  return conference;
}

/**
 * Update participant status when webhook events arrive.
 */
function updateParticipantStatus(conferenceId, callControlId, status) {
  const conference = conferences.get(conferenceId);
  if (!conference) {
    return null;
  }

  const participant = conference.participants.find(
    (p) => p.call_control_id === callControlId
  );
  if (participant) {
    participant.status = status;
  }

  return conference;
}

/**
 * POST /conferences/create
 * Create a new conference and initiate calls to all participants.
 */
app.post("/conferences/create", async (req, res) => {
  const { conference_id, participants } = req.body;

  if (!conference_id || !participants || participants.length === 0) {
    return res.status(400).json({
      error: "Missing required fields: 'conference_id' and 'participants' array",
    });
  }

  try {
    // Create the conference record
    const conference = createConference(conference_id, []);

    // Initiate calls to each participant
    const callPromises = participants.map(async (phoneNumber) => {
      const callData = await initiateCall(phoneNumber);
      addParticipantToConference(
        conference_id,
        callData.call_control_id,
        phoneNumber
      );
      return callData;
    });

    const calls = await Promise.all(callPromises);

    return res.status(200).json({
      conference_id: conference_id,
      status: "initiated",
      participants: calls.map((c) => ({
        call_control_id: c.call_control_id,
        phone_number: c.to,
      })),
    });
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
 * GET /conferences/:conference_id
 * Retrieve the current state of a conference.
 */
app.get("/conferences/:conference_id", (req, res) => {
  const { conference_id } = req.params;
  const conference = conferences.get(conference_id);

  if (!conference) {
    return res.status(404).json({ error: "Conference not found" });
  }

  return res.status(200).json({
    id: conference.id,
    status: conference.status,
    created_at: conference.created_at,
    participants: conference.participants.map((p) => ({
      call_control_id: p.call_control_id,
      phone_number: p.phone_number,
      status: p.status,
      joined_at: p.joined_at,
    })),
  });
});

/**
 * POST /webhooks/call
 * Handle incoming webhook events from Telnyx (call.initiated, call.answered, call.hangup, etc.).
 * This endpoint receives real-time call state changes.
 */
app.post("/webhooks/call", (req, res) => {
  const event = req.body;

  // Acknowledge receipt immediately to prevent retries
  res.status(200).json({ received: true });

  // Extract call metadata from the webhook
  const callControlId = event.data?.call_control_id;
  const eventType = event.type;

  if (!callControlId) {
    console.warn("Webhook received without call_control_id:", event);
    return;
  }

  // Find the conference this call belongs to
  let targetConference = null;
  for (const [confId, conf] of conferences.entries()) {
    const participant = conf.participants.find(
      (p) => p.call_control_id === callControlId
    );
    if (participant) {
      targetConference = confId;
      break;
    }
  }

  if (!targetConference) {
    console.warn(
      `Webhook for unknown call ${callControlId}. Conference may have ended.`
    );
    return;
  }

  // Update participant status based on event type
  switch (eventType) {
    case "call.initiated":
      console.log(`Call initiated: ${callControlId}`);
      updateParticipantStatus(targetConference, callControlId, "initiated");
      break;

    case "call.answered":
      console.log(`Call answered: ${callControlId}`);
      updateParticipantStatus(targetConference, callControlId, "answered");
      break;

    case "call.hangup":
      console.log(`Call ended: ${callControlId}`);
      updateParticipantStatus(targetConference, callControlId, "hangup");
      break;

    case "call.dtmf.received":
      console.log(
        `DTMF received on ${callControlId}: ${event.data?.dtmf_digit}`
      );
      break;

    default:
      console.log(`Unhandled event type: ${eventType}`);
  }
});

/**
 * POST /conferences/:conference_id/hangup
 * End all calls in a conference.
 */
app.post("/conferences/:conference_id/hangup", async (req, res) => {
  const { conference_id } = req.params;
  const conference = conferences.get(conference_id);

  if (!conference) {
    return res.status(404).json({ error: "Conference not found" });
  }

  try {
    // Hangup all active participants
    const hangupPromises = conference.participants
      .filter((p) => p.status !== "hangup")
      .map((p) =>
        client.calls.actions.hangup(p.call_control_id).catch((err) => {
          console.error(`Failed to hangup ${p.call_control_id}:`, err.message);
          return null;
        })
      );

    await Promise.all(hangupPromises);

    // Mark conference as ended
    conference.status = "ended";

    return res.status(200).json({
      conference_id: conference_id,
      status: "ended",
      message: "All participants have been disconnected",
    });
  } catch (error) {
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof Telnyx.APIStatusError) {
      return res.status(error.status_code || 500).json({
        error: error.message,
        status_code: error.status_code,
      });
    }
    return res.status(500).json({ error: error.message });
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
  console.log(`Conference server running on port ${PORT}`);
  console.log(`Webhook URL: ${process.env.WEBHOOK_URL}`);
});
