#!/usr/bin/env node
/**
 * Production-ready Express application for call forwarding via Telnyx Voice API.
 * Demonstrates outbound call initiation, webhook event handling, and call state management.
 */

const express = require("express");
const bodyParser = require("body-parser");
const Telnyx = require("telnyx");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Initialize client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

// In-memory store for active call forwarding rules
// In production, use a database like PostgreSQL or MongoDB
const forwardingRules = new Map();

/**
 * Initiate a call and forward it to a destination number.
 * Returns JSON-serializable call data.
 */
async function initiateCallForwarding(toNumber, forwardToNumber) {
  const fromNumber = process.env.TELNYX_PHONE_NUMBER;
  const connectionId = process.env.TELNYX_CONNECTION_ID;

  if (!fromNumber) {
    throw new Error("TELNYX_PHONE_NUMBER environment variable not set");
  }
  if (!connectionId) {
    throw new Error("TELNYX_CONNECTION_ID environment variable not set");
  }

  // Validate E.164 format to prevent API errors
  if (!toNumber.startsWith("+") || !forwardToNumber.startsWith("+")) {
    throw new Error(
      "Phone numbers must be in E.164 format (e.g., +15551234567)"
    );
  }

  // Initiate the outbound call using client.calls.dial()
  // connection_id is REQUIRED and links to your Call Control Application
  // Do NOT pass call_control_id as input — it is returned in the response
  const response = await client.calls.dial({
    from_: fromNumber,
    to: toNumber,
    connection_id: connectionId,
  });

  const callControlId = response.data.call_control_id;

  // Store forwarding rule in memory for webhook event handling
  forwardingRules.set(callControlId, {
    callControlId,
    originalNumber: toNumber,
    forwardToNumber,
    initiatedAt: new Date(),
    status: "initiated",
  });

  // Extract serializable data — SDK objects are NOT JSON-serializable
  return {
    call_control_id: callControlId,
    from: fromNumber,
    to: toNumber,
    forward_to: forwardToNumber,
    status: "initiated",
  };
}

/**
 * Handle incoming call.answered webhook event.
 * When the original call is answered, transfer it to the forwarding destination.
 */
async function handleCallAnswered(callControlId) {
  const rule = forwardingRules.get(callControlId);
  if (!rule) {
    console.warn(`No forwarding rule found for call ${callControlId}`);
    return;
  }

  try {
    // Transfer the call to the forwarding destination
    await client.calls.actions.transfer({
      call_control_id: callControlId,
      to: rule.forwardToNumber,
    });

    rule.status = "transferred";
    console.log(
      `Call ${callControlId} transferred to ${rule.forwardToNumber}`
    );
  } catch (error) {
    console.error(`Failed to transfer call ${callControlId}:`, error.message);
    rule.status = "transfer_failed";
  }
}

/**
 * Handle call.hangup webhook event.
 * Clean up the forwarding rule when the call ends.
 */
function handleCallHangup(callControlId) {
  const rule = forwardingRules.get(callControlId);
  if (rule) {
    rule.status = "hangup";
    console.log(`Call ${callControlId} ended`);
    // In production, persist this data to a database for analytics
  }
}

/**
 * POST /calls/forward
 * Initiate a call forwarding session.
 * Request body: { "to": "+15559876543", "forward_to": "+15551112222" }
 */
app.post("/calls/forward", async (req, res) => {
  const { to, forward_to } = req.body;

  if (!to || !forward_to) {
    return res.status(400).json({
      error: "Missing required fields: 'to' and 'forward_to'",
    });
  }

  try {
    const result = await initiateCallForwarding(to, forward_to);
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
    // Handle validation errors
    return res.status(400).json({ error: error.message });
  }
});

/**
 * POST /webhooks/call
 * Receive call control events from Telnyx.
 * Telnyx sends events like call.initiated, call.answered, call.hangup, etc.
 */
app.post("/webhooks/call", async (req, res) => {
  const event = req.body.data;

  if (!event) {
    return res.status(400).json({ error: "Invalid webhook payload" });
  }

  const callControlId = event.call_control_id;
  const eventType = event.type;

  console.log(`Received event: ${eventType} for call ${callControlId}`);

  try {
    if (eventType === "call.answered") {
      // When the original call is answered, transfer it
      await handleCallAnswered(callControlId);
    } else if (eventType === "call.hangup") {
      // Clean up when the call ends
      handleCallHangup(callControlId);
    }

    // Always return 200 to acknowledge receipt
    return res.status(200).json({ status: "ok" });
  } catch (error) {
    console.error(`Webhook processing error: ${error.message}`);
    // Return 200 even on error to prevent Telnyx from retrying
    return res.status(200).json({ status: "error", message: error.message });
  }
});

/**
 * GET /calls/status/:callControlId
 * Retrieve the status of an active call forwarding session.
 */
app.get("/calls/status/:callControlId", (req, res) => {
  const { callControlId } = req.params;
  const rule = forwardingRules.get(callControlId);

  if (!rule) {
    return res.status(404).json({ error: "Call not found" });
  }

  return res.status(200).json({
    call_control_id: rule.callControlId,
    original_number: rule.originalNumber,
    forward_to: rule.forwardToNumber,
    status: rule.status,
    initiated_at: rule.initiatedAt,
  });
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
  console.log(`Call forwarding server running on port ${PORT}`);
  console.log(`Webhook URL: ${process.env.WEBHOOK_URL}`);
});
