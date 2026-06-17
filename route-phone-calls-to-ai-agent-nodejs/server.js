#!/usr/bin/env node
/**
 * Production-ready Express webhook handler for inbound calls via Telnyx Voice API.
 * Receives call.initiated events and answers calls programmatically.
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
 * Handle incoming call webhook event.
 * Validates the event type and answers the call.
 * @param {Object} event - Webhook event payload from Telnyx.
 * @returns {Object} JSON-serializable response data.
 */
async function handleInboundCall(event) {
  const callControlId = event.data.call_control_id;
  const from = event.data.from;
  const to = event.data.to;
  const eventType = event.data.event_type;

  if (!callControlId) {
    throw new Error("Missing call_control_id in webhook event");
  }

  // Log the incoming call for debugging
  console.log(`Incoming call from ${from} to ${to} (Event: ${eventType})`);

  // Only answer on the 'call.initiated' event
  if (eventType === "call.initiated") {
    // Answer the call using the call_control_id returned in the webhook
    const response = await client.calls.actions.answer(callControlId);

    return {
      call_control_id: response.data.call_control_id,
      status: "answered",
      from: from,
      to: to,
    };
  }

  // For other events (call.answered, call.hangup, etc.), just acknowledge
  return {
    call_control_id: callControlId,
    status: "acknowledged",
    event_type: eventType,
  };
}

/**
 * POST /webhooks/inbound-call
 * Receives inbound call webhooks from Telnyx.
 * Validates the event and answers the call.
 */
app.post("/webhooks/inbound-call", async (req, res) => {
  const event = req.body;

  // Validate webhook payload structure
  if (!event || !event.data) {
    return res.status(400).json({ error: "Invalid webhook payload" });
  }

  try {
    const result = await handleInboundCall(event);
    return res.status(200).json(result);
  } catch (error) {
    // Handle Telnyx SDK errors
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
    if (error instanceof Error && error.message.includes("Missing")) {
      return res.status(400).json({ error: error.message });
    }

    // Generic error handler
    console.error("Unexpected error:", error);
    return res.status(500).json({ error: "Internal server error" });
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
  console.log(`Webhook server listening on port ${PORT}`);
  console.log(
    `Configure your Telnyx Call Control App webhook URL to: https://your-domain.com/webhooks/inbound-call`
  );
});
