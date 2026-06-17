#!/usr/bin/env node
/**
 * Production-ready Express application for inbound SIP routing via Telnyx.
 * Demonstrates SIP connection creation, listing, and inbound call webhook handling.
 */

const express = require("express");
const Telnyx = require("telnyx");
require("dotenv").config();

const app = express();
app.use(express.json());

// Initialize client with the SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

/**
 * Create a SIP connection for inbound call routing.
 * Returns JSON-serializable connection data.
 */
async function createSipConnection(connectionName) {
  const response = await client.sipConnections.create({
    connection_name: connectionName,
    inbound: {
      uri: process.env.SIP_ENDPOINT,
    },
    inbound_authentication: {
      username: process.env.SIP_USERNAME,
      password: process.env.SIP_PASSWORD,
    },
  });

  // Extract serializable data — SDK objects are NOT JSON-serializable
  return {
    id: response.data.id,
    connection_name: response.data.connection_name,
    inbound_uri: response.data.inbound?.uri,
    created_at: response.data.created_at,
  };
}

/**
 * List all SIP connections.
 * Returns array of JSON-serializable connection objects.
 */
async function listSipConnections() {
  const response = await client.sipConnections.list();

  return response.data.map((conn) => ({
    id: conn.id,
    connection_name: conn.connection_name,
    inbound_uri: conn.inbound?.uri,
    created_at: conn.created_at,
  }));
}

/**
 * Retrieve a specific SIP connection by ID.
 * Returns JSON-serializable connection data.
 */
async function getSipConnection(connectionId) {
  const response = await client.sipConnections.retrieve(connectionId);

  return {
    id: response.data.id,
    connection_name: response.data.connection_name,
    inbound_uri: response.data.inbound?.uri,
    inbound_authentication_username: response.data.inbound_authentication?.username,
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
    if (error instanceof Telnyx.APIStatusError) {
      return res.status(error.status_code).json({ error: error.message });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({ error: "Network error connecting to Telnyx" });
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
    if (error instanceof Telnyx.APIStatusError) {
      return res.status(error.status_code).json({ error: error.message });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({ error: "Network error connecting to Telnyx" });
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
    if (error instanceof Telnyx.APIStatusError) {
      return res.status(error.status_code).json({ error: error.message });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({ error: "Network error connecting to Telnyx" });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /webhooks/inbound-call
 * Receive inbound call webhooks from Telnyx.
 * This endpoint logs call events and can be extended to route calls.
 */
app.post("/webhooks/inbound-call", (req, res) => {
  const event = req.body;

  console.log("Inbound call event received:", {
    event_type: event.data?.event_type,
    call_session_id: event.data?.call_session_id,
    from: event.data?.from,
    to: event.data?.to,
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
