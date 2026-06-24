#!/usr/bin/env node
/**
 * Production-ready Express application for call analytics using Telnyx Voice API.
 * Tracks call metrics, processes webhook events, and exposes analytics endpoints.
 */

const express = require("express");
const bodyParser = require("body-parser");
const Telnyx = require("telnyx");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Initialize Telnyx client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

// In-memory store for call analytics (use a database in production)
const callStore = new Map();

/**
 * Initiate an outbound call and store initial metadata.
 * Returns call_control_id for subsequent control actions.
 */
async function initiateCall(toNumber) {
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

  // Initiate the call using client.calls.dial()
  const response = await client.calls.dial({
    from: fromNumber,
    to: toNumber,
    connection_id: connectionId,
  });

  const callControlId = response.data.call_control_id;

  // Store initial call metadata for analytics
  callStore.set(callControlId, {
    call_control_id: callControlId,
    from: fromNumber,
    to: toNumber,
    initiated_at: new Date().toISOString(),
    state: "initiated",
    duration_seconds: 0,
    events: [],
  });

  return {
    call_control_id: callControlId,
    from: fromNumber,
    to: toNumber,
    initiated_at: callStore.get(callControlId).initiated_at,
  };
}

/**
 * Process incoming webhook events and update call analytics.
 * Telnyx sends events like call.initiated, call.answered, call.hangup.
 */
function processWebhookEvent(event) {
  const callControlId = event.data.call_control_id;
  const eventType = event.type;

  if (!callStore.has(callControlId)) {
    // Create entry if webhook arrives before dial response (race condition)
    callStore.set(callControlId, {
      call_control_id: callControlId,
      from: event.data.from?.phone_number || "unknown",
      to: event.data.to?.phone_number || "unknown",
      initiated_at: new Date().toISOString(),
      state: "unknown",
      duration_seconds: 0,
      events: [],
    });
  }

  const callData = callStore.get(callControlId);

  // Record the event with timestamp
  callData.events.push({
    type: eventType,
    timestamp: new Date().toISOString(),
    details: event.data,
  });

  // Update call state based on event type
  switch (eventType) {
    case "call.initiated":
      callData.state = "initiated";
      break;
    case "call.answered":
      callData.state = "answered";
      callData.answered_at = new Date().toISOString();
      break;
    case "call.hangup":
      callData.state = "completed";
      callData.ended_at = new Date().toISOString();
      // Calculate duration if we have both answered_at and ended_at
      if (callData.answered_at && callData.ended_at) {
        const answeredTime = new Date(callData.answered_at).getTime();
        const endedTime = new Date(callData.ended_at).getTime();
        callData.duration_seconds = Math.round((endedTime - answeredTime) / 1000);
      }
      break;
    case "call.dtmf.received":
      // Track DTMF digits for IVR analytics
      if (!callData.dtmf_digits) {
        callData.dtmf_digits = "";
      }
      callData.dtmf_digits += event.data.digit;
      break;
    case "call.recording.saved":
      callData.recording_url = event.data.recording_url;
      break;
  }

  return callData;
}

/**
 * Retrieve analytics for a specific call.
 */
function getCallAnalytics(callControlId) {
  if (!callStore.has(callControlId)) {
    return null;
  }

  const callData = callStore.get(callControlId);
  return {
    call_control_id: callData.call_control_id,
    from: callData.from,
    to: callData.to,
    state: callData.state,
    initiated_at: callData.initiated_at,
    answered_at: callData.answered_at || null,
    ended_at: callData.ended_at || null,
    duration_seconds: callData.duration_seconds,
    dtmf_digits: callData.dtmf_digits || null,
    recording_url: callData.recording_url || null,
    event_count: callData.events.length,
    events: callData.events,
  };
}

/**
 * Generate aggregate analytics across all calls.
 */
function getAggregateAnalytics() {
  const calls = Array.from(callStore.values());

  if (calls.length === 0) {
    return {
      total_calls: 0,
      completed_calls: 0,
      answered_calls: 0,
      success_rate: 0,
      average_duration_seconds: 0,
      total_duration_seconds: 0,
    };
  }

  const completedCalls = calls.filter((c) => c.state === "completed");
  const answeredCalls = calls.filter((c) => c.state === "answered" || c.state === "completed");
  const totalDuration = completedCalls.reduce((sum, c) => sum + c.duration_seconds, 0);

  return {
    total_calls: calls.length,
    completed_calls: completedCalls.length,
    answered_calls: answeredCalls.length,
    success_rate: calls.length > 0 ? (answeredCalls.length / calls.length) * 100 : 0,
    average_duration_seconds:
      completedCalls.length > 0 ? Math.round(totalDuration / completedCalls.length) : 0,
    total_duration_seconds: totalDuration,
  };
}

// ============================================================================
// Express Routes
// ============================================================================

/**
 * POST /calls/initiate
 * Initiate an outbound call and return call_control_id.
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
      return res.status(429).json({ error: "Rate limit exceeded. Please slow down." });
    }
    if (error instanceof Telnyx.APIError) {
      return res.status(error.status_code || 400).json({
        error: error.message,
        status_code: error.status_code,
      });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({ error: "Network error connecting to Telnyx" });
    }
    return res.status(400).json({ error: error.message });
  }
});

/**
 * POST /webhooks/call
 * Receive and process Telnyx call control webhooks.
 * Telnyx sends events like call.initiated, call.answered, call.hangup, etc.
 */
app.post("/webhooks/call", (req, res) => {
  const event = req.body;

  // Acknowledge receipt immediately (Telnyx expects 200 OK)
  res.status(200).json({ received: true });

  // Process the event asynchronously
  try {
    processWebhookEvent(event);
  } catch (error) {
    console.error("Error processing webhook event:", error);
  }
});

/**
 * GET /analytics/calls/:callControlId
 * Retrieve detailed analytics for a specific call.
 */
app.get("/analytics/calls/:callControlId", (req, res) => {
  const { callControlId } = req.params;
  const analytics = getCallAnalytics(callControlId);

  if (!analytics) {
    return res.status(404).json({ error: "Call not found" });
  }

  return res.status(200).json(analytics);
});

/**
 * GET /analytics/aggregate
 * Retrieve aggregate analytics across all calls.
 */
app.get("/analytics/aggregate", (req, res) => {
  const analytics = getAggregateAnalytics();
  return res.status(200).json(analytics);
});

/**
 * GET /health
 * Health check endpoint for monitoring.
 */
app.get("/health", (req, res) => {
  return res.status(200).json({ status: "ok" });
});

// ============================================================================
// Error Handler
// ============================================================================

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  return res.status(500).json({
    error: "Internal server error",
    message: err.message,
  });
});

// ============================================================================
// Server Startup
// ============================================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Call Analytics server running on port ${PORT}`);
  console.log(`Webhook URL: ${process.env.WEBHOOK_URL}`);
});
