#!/usr/bin/env node
/**
 * Production-ready Express application for inbound SIP routing via Telnyx.
 * Demonstrates SIP connection creation, listing, and inbound call webhook handling.
 */

const express = require("express");
const Telnyx = require("telnyx");
const crypto = require("crypto");
require("dotenv").config();

// Verify the Telnyx Ed25519 webhook signature (version-proof; stdlib only — no SDK dependency).
function verifyTelnyxSignature(rawBody, headers, toleranceSec = 300) {
  const sig = headers["telnyx-signature-ed25519"];
  const ts = headers["telnyx-timestamp"];
  const pub = process.env.TELNYX_PUBLIC_KEY;
  if (!sig || !ts || !pub) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > toleranceSec) return false;
  try {
    const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pub, "base64")]);
    const key = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(`${ts}|${rawBody}`), key, Buffer.from(sig, "base64"));
  } catch (e) {
    return false;
  }
}

const app = express();

// Initialize the Telnyx client. The constructor form takes an options object
// while error classes (AuthenticationError, etc.) remain on the module export.
const telnyx = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });
const client = telnyx;

// Mount the raw body parser on the webhook route so the exact bytes Telnyx
// signed reach the handler for signature verification. JSON parsing is applied
// to every other route. A global JSON parser must NOT run ahead of the webhook
// route, otherwise it would consume the stream and leave req.body as a parsed
// object instead of the raw Buffer.
app.use("/webhooks/inbound-call", express.raw({ type: "*/*" }));
app.use((req, res, next) => {
  if (req.path === "/webhooks/inbound-call") {
    return next();
  }
  return express.json()(req, res, next);
});

/**
 * Create a SIP connection for inbound call routing.
 * Returns JSON-serializable connection data.
 */
async function createSipConnection(connectionName) {
  const response = await client.credentialConnections.create({
    connection_name: connectionName,
    user_name: process.env.SIP_USERNAME,
    password: process.env.SIP_PASSWORD,
  });

  // Extract serializable data — SDK objects are NOT JSON-serializable
  return {
    id: response.data.id,
    connection_name: response.data.connection_name,
    user_name: response.data.user_name,
    created_at: response.data.created_at,
  };
}

/**
 * List all SIP connections.
 * Returns array of JSON-serializable connection objects.
 */
async function listSipConnections() {
  const response = await client.credentialConnections.list();

  return response.data.map((conn) => ({
    id: conn.id,
    connection_name: conn.connection_name,
    user_name: conn.user_name,
    created_at: conn.created_at,
  }));
}

/**
 * Retrieve a specific SIP connection by ID.
 * Returns JSON-serializable connection data.
 */
async function getSipConnection(connectionId) {
  const response = await client.credentialConnections.retrieve(connectionId);

  return {
    id: response.data.id,
    connection_name: response.data.connection_name,
    user_name: response.data.user_name,
    created_at: response.data.created_at,
  };
}

/**
 * POST /sip/connections
 * Create a new SIP connection for inbound routing.
 */
app.post("/sip/connections", async (req, res) => {
  const { connection_name } = req.body;

  if (!connection_name) {
    return res.status(400).json({ error: "Missing required field: connection_name" });
  }

  try {
    const result = await createSipConnection(connection_name);
    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({ error: "Rate limit exceeded. Please slow down." });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({ error: "Network error connecting to Telnyx" });
    }
    if (error instanceof Telnyx.APIError) {
      return res.status(error.status).json({ error: error.message });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /sip/connections
 * List all SIP connections.
 */
app.get("/sip/connections", async (req, res) => {
  try {
    const connections = await listSipConnections();
    return res.status(200).json(connections);
  } catch (error) {
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({ error: "Rate limit exceeded. Please slow down." });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({ error: "Network error connecting to Telnyx" });
    }
    if (error instanceof Telnyx.APIError) {
      return res.status(error.status).json({ error: error.message });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /sip/connections/:id
 * Retrieve a specific SIP connection.
 */
app.get("/sip/connections/:id", async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: "Missing required parameter: id" });
  }

  try {
    const connection = await getSipConnection(id);
    return res.status(200).json(connection);
  } catch (error) {
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({ error: "Rate limit exceeded. Please slow down." });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({ error: "Network error connecting to Telnyx" });
    }
    if (error instanceof Telnyx.APIError) {
      return res.status(error.status).json({ error: error.message });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /webhooks/inbound-call
 * Receive inbound call webhooks from Telnyx.
 * This endpoint logs call events and can be extended to route calls.
 *
 * The Telnyx signature is verified against the raw request body before the
 * payload is trusted. The `express.raw` middleware captures the unparsed body
 * so the signature check operates on the exact bytes Telnyx signed.
 */
app.post("/webhooks/inbound-call", async (req, res) => {
  // The route-level express.raw middleware leaves the unparsed bytes on
  // req.body as a Buffer. Capture them before any parsing happens.
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");

  // ENFORCE-ALWAYS: verify the Telnyx webhook signature before processing.
  // The native-crypto helper verifies the Ed25519 signature over the RAW
  // request body, independent of any SDK version.
  if (!verifyTelnyxSignature(rawBody.toString(), req.headers)) {
    return res.status(401).json({ error: "invalid signature" });
  }

  // Parse the payload only AFTER the signature has been verified.
  const event = JSON.parse(rawBody.toString());

  console.log("Inbound call event received:", {
    event_type: event.data?.event_type,
    call_session_id: event.data?.payload?.call_session_id,
    from: event.data?.payload?.from,
    to: event.data?.payload?.to,
    timestamp: event.data?.occurred_at,
  });

  // Acknowledge receipt of webhook immediately
  res.status(200).json({ status: "received" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SIP routing server listening on port ${PORT}`);
  console.log(`Webhook URL: ${process.env.WEBHOOK_URL}/webhooks/inbound-call`);
});
