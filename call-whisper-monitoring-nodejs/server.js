#!/usr/bin/env node
/**
 * Production-ready Express application for initiating calls with whisper prompts.
 * Demonstrates Telnyx Voice API call control and webhook event handling.
 */

require("dotenv").config();
const express = require("express");
const Telnyx = require("telnyx");

const app = express();
app.use(express.json());

// Initialize Telnyx client with API key
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

/**
 * Initiate an outbound call with a whisper prompt.
 * The whisper message is played to the caller before the call connects.
 */
async function initiateCallWithWhisper(toNumber, whisperMessage) {
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

  // Initiate the call using the Call Control API
  const response = await client.calls.dial({
    from_: fromNumber,
    to: toNumber,
    connection_id: connectionId,
  });

  // Extract call_control_id from response for subsequent control actions
  const callControlId = response.data.call_control_id;

  // Store call metadata for webhook processing
  return {
    call_control_id: callControlId,
    to: toNumber,
    from: fromNumber,
    whisper_message: whisperMessage,
  };
}

/**
 * Handle incoming webhook events from Telnyx.
 * Process call.answered event to play the whisper prompt.
 */
async function handleCallWebhook(event) {
  const callControlId = event.data.payload.call_control_id;
  const eventType = event.data.event_type;

  console.log(`Webhook event: ${eventType} for call ${callControlId}`);

  // When the call is answered, play the whisper prompt
  if (eventType === "call.answered") {
    const whisperMessage =
      event.data.payload.whisper_message || "Your call is being connected.";

    try {
      // Use the speak action to play the whisper message
      await client.calls.actions.speak(callControlId, {
        payload: whisperMessage,
        voice: "female",
        language: "en-US",
      });

      console.log(`Whisper prompt played for call ${callControlId}`);
    } catch (error) {
      console.error(`Failed to play whisper prompt: ${error.message}`);
    }
  }

  // Log call hangup for cleanup
  if (eventType === "call.hangup") {
    console.log(`Call ${callControlId} ended`);
  }
}

/**
 * Express route to initiate a call with whisper prompt.
 */
app.post("/call/initiate", async (req, res) => {
  const { to, whisper_message } = req.body;

  if (!to || !whisper_message) {
    return res.status(400).json({
      error: "Missing required fields: 'to' and 'whisper_message'",
    });
  }

  try {
    const callData = await initiateCallWithWhisper(to, whisper_message);
    return res.status(200).json({
      call_control_id: callData.call_control_id,
      to: callData.to,
      from: callData.from,
      status: "initiated",
    });
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
      return res.status(error.status_code || 500).json({
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
 * Express route to receive Telnyx webhook events.
 * Telnyx sends call state changes (answered, hangup, etc.) to this endpoint.
 */
app.post("/webhooks/call", async (req, res) => {
  const event = req.body;

  // Acknowledge receipt immediately to prevent retries
  res.status(200).json({ received: true });

  // Process the event asynchronously
  try {
    await handleCallWebhook(event);
  } catch (error) {
    console.error(`Webhook processing error: ${error.message}`);
  }
});

/**
 * Health check endpoint for monitoring.
 */
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Start the Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Whisper prompt server running on port ${PORT}`);
  console.log(`Webhook URL: ${process.env.WEBHOOK_URL}/webhooks/call`);
});
