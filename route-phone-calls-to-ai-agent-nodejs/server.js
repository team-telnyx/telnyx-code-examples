#!/usr/bin/env node
/**
 * Production-ready Express webhook handler for inbound calls via Telnyx Voice API.
 * Receives call.initiated events and answers calls programmatically.
 */

const express = require("express");
const crypto = require("crypto");
require("dotenv").config();

const app = express();

// Initialize the Telnyx client. Used for outbound API calls
// (answering the call) and SDK error types.
const Telnyx = require("telnyx");
const telnyx = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

// Verify the Telnyx Ed25519 webhook signature (version-proof; stdlib only — no SDK dependency).
function verifyTelnyxSignature(rawBody, headers, toleranceSec = 300) {
  const sig = headers["telnyx-signature-ed25519"];
  const ts = headers["telnyx-timestamp"];
  const pub = process.env.TELNYX_PUBLIC_KEY;
  if (!sig || !ts || !pub) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > toleranceSec) return false;
  try {
    const der = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(pub, "base64"),
    ]);
    const key = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(`${ts}|${rawBody}`), key, Buffer.from(sig, "base64"));
  } catch (e) {
    return false;
  }
}

/**
 * Handle incoming call webhook event.
 * Validates the event type and answers the call.
 * @param {Object} event - Webhook event payload from Telnyx.
 * @returns {Object} JSON-serializable response data.
 */
async function handleInboundCall(event) {
  const payload = event.data.payload || {};
  const callControlId = payload.call_control_id;
  const from = payload.from;
  const to = payload.to;
  const eventType = event.data.event_type;

  if (!callControlId) {
    throw new Error("Missing call_control_id in webhook event");
  }

  // Log the incoming call for debugging
  console.log(`Incoming call from ${from} to ${to} (Event: ${eventType})`);

  // Only answer on the 'call.initiated' event
  if (eventType === "call.initiated") {
    // Answer the call using the call_control_id returned in the webhook
    await telnyx.calls.actions.answer(callControlId);

    return {
      call_control_id: callControlId,
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
 *
 * `express.raw({ type: "*\/*" })` is mounted ONLY on this route so the handler
 * receives the unparsed request body as a Buffer. The Ed25519 signature must be
 * verified over the exact raw bytes Telnyx signed; parsing the JSON first would
 * change the byte representation and reject every legitimate webhook.
 */
app.post(
  "/webhooks/inbound-call",
  express.raw({ type: "*/*" }),
  async (req, res) => {
    // req.body is the raw request Buffer (express.raw). Guard against any
    // upstream middleware accidentally consuming the stream.
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(req.body ?? "");

    // ENFORCE-ALWAYS: verify the Telnyx webhook signature before any processing.
    if (!verifyTelnyxSignature(rawBody.toString(), req.headers)) {
      return res.status(401).json({ error: "invalid signature" });
    }

    // Parse the body AFTER the signature has been verified.
    let event;
    try {
      event = JSON.parse(rawBody.toString());
    } catch (e) {
      return res.status(400).json({ error: "Invalid JSON payload" });
    }

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

      if (error instanceof Telnyx.APIConnectionError) {
        return res
          .status(503)
          .json({ error: "Network error connecting to Telnyx" });
      }

      if (error instanceof Telnyx.APIError) {
        return res.status(error.status || 502).json({ error: "Telnyx API error" });
      }

      // Handle validation errors
      if (error instanceof Error && error.message.includes("Missing")) {
        return res.status(400).json({ error: error.message });
      }

      // Generic error handler
      console.error("Unexpected error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// JSON body parser for all other (non-webhook) routes. Mounted AFTER the
// webhook route so it never consumes the raw webhook stream.
app.use(express.json());

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
