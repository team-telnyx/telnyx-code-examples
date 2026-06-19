#!/usr/bin/env node
/**
 * Production-ready Express server for text-to-speech voice calls via Telnyx.
 * Initiates outbound calls and plays TTS messages on answer.
 */

const express = require("express");
const crypto = require("crypto");
const Telnyx = require("telnyx");
require("dotenv").config();

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

const app = express();

// IMPORTANT: do NOT register a global JSON body parser here. Telnyx webhook
// signature verification must run over the EXACT raw request bytes. A global
// express.json()/bodyParser.json() would consume the request stream before the
// webhook route's express.raw(), leaving req.body a parsed object and causing
// verification to run over "[object Object]" — which rejects every real
// webhook. JSON parsing is therefore applied per-route on the JSON API routes
// only, while the webhook route uses express.raw({ type: "*/*" }) below.
const jsonParser = express.json();

// Initialize the Telnyx client for outbound API calls (dial / speak).
// Inbound webhook signatures are verified with the native-crypto helper above,
// not the SDK, so verification is independent of the installed SDK version.
const telnyx = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });
const client = telnyx;

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
    from: fromNumber,
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
app.post("/calls/initiate", jsonParser, async (req, res) => {
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
    if (error instanceof Telnyx.APIConnectionError) {
      return res
        .status(503)
        .json({ error: "Network error connecting to Telnyx" });
    }
    if (error instanceof Telnyx.APIError) {
      return res
        .status(error.status || 500)
        .json({ error: error.message, status_code: error.status });
    }
    // Handle validation errors
    return res.status(400).json({ error: error.message });
  }
});

/**
 * POST /calls/:callControlId/speak
 * Plays text-to-speech on an active call.
 */
app.post("/calls/:callControlId/speak", jsonParser, async (req, res) => {
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
    if (error instanceof Telnyx.APIConnectionError) {
      return res
        .status(503)
        .json({ error: "Network error connecting to Telnyx" });
    }
    if (error instanceof Telnyx.APIError) {
      return res
        .status(error.status || 500)
        .json({ error: error.message, status_code: error.status });
    }
    return res.status(400).json({ error: error.message });
  }
});

/**
 * POST /webhooks/call
 * Receives call control events from Telnyx.
 * Automatically plays TTS when call is answered.
 *
 * Uses express.raw() to capture the unparsed request body, which is required
 * for Telnyx webhook signature verification (the signature is computed over
 * the exact raw bytes).
 */
app.post(
  "/webhooks/call",
  express.raw({ type: "*/*" }),
  async (req, res) => {
    // express.raw() leaves req.body as a Buffer of the exact wire bytes. The
    // signature is computed over these raw bytes, so we must verify BEFORE any
    // JSON parsing. Guard against misconfiguration that would hand us a parsed
    // object instead of the raw buffer.
    const rawBody = req.body;
    if (!Buffer.isBuffer(rawBody)) {
      return res.status(400).json({ error: "raw body not available" });
    }

    // Verify the Telnyx Ed25519 webhook signature over the EXACT raw bytes
    // before processing. Reject forged/tampered requests with 401.
    if (!verifyTelnyxSignature(rawBody.toString(), req.headers)) {
      return res.status(401).json({ error: "invalid signature" });
    }

    // Parse the verified raw body into JSON for handling (AFTER verifying).
    const event = JSON.parse(rawBody.toString()).data;
    const payload = event.payload || {};

    // Log the event for debugging
    console.log(`Received event: ${event.event_type}`);

    // Handle call.answered event — play TTS automatically
    if (event.event_type === "call.answered") {
      const callControlId = payload.call_control_id;
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
      console.log(`Call ${payload.call_control_id} ended`);
    }

    // Always return 200 to acknowledge receipt
    return res.status(200).json({ status: "received" });
  }
);

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
