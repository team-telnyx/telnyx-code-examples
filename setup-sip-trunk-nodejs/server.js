#!/usr/bin/env node
/**
 * Production-ready Express application for managing SIP trunk connections via Telnyx.
 */

const express = require("express");
const Telnyx = require("telnyx");
require("dotenv").config();

const app = express();
app.use(express.json());

// Initialize client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

/**
 * Create a new SIP connection with credential-based authentication.
 * Returns JSON-serializable connection data.
 */
async function createSipConnection(name, username, password, endpoint) {
  // Validate required fields
  if (!name || !username || !password || !endpoint) {
    throw new Error("Missing required fields: name, username, password, endpoint");
  }

  // Validate endpoint format (basic check for host:port or host)
  if (!endpoint.includes(".") && !endpoint.includes(":")) {
    throw new Error("Endpoint must be a valid hostname or IP address with optional port");
  }

  // Create SIP connection via Telnyx API
  const response = await client.sipConnections.create({
    connection_name: name,
    outbound_voice_profile_id: null,
    inbound: {
      sip_subdomain: null,
    },
    outbound: {
      outbound_voice_profile_id: null,
    },
    credentials: {
      authentication: {
        authentication_type: "credential",
        username: username,
        password: password,
      },
    },
    active: true,
  });

  // Extract serializable data — SDK objects are NOT JSON-serializable
  return {
    id: response.data.id,
    name: response.data.connection_name,
    username: username,
    status: response.data.active ? "active" : "inactive",
    created_at: response.data.created_at,
  };
}

/**
 * Retrieve a SIP connection by ID.
 * Returns JSON-serializable connection data.
 */
async function getSipConnection(connectionId) {
  if (!connectionId) {
    throw new Error("Connection ID is required");
  }

  const response = await client.sipConnections.retrieve(connectionId);

  return {
    id: response.data.id,
    name: response.data.connection_name,
    status: response.data.active ? "active" : "inactive",
    created_at: response.data.created_at,
    updated_at: response.data.updated_at,
  };
}

/**
 * List all SIP connections.
 * Returns JSON-serializable list of connections.
 */
async function listSipConnections() {
  const response = await client.sipConnections.list();

  return response.data.map((conn) => ({
    id: conn.id,
    name: conn.connection_name,
    status: conn.active ? "active" : "inactive",
    created_at: conn.created_at,
  }));
}

/**
 * POST /sip/connections
 * Create a new SIP connection with credential authentication.
 */
app.post("/sip/connections", async (req, res) => {
  const { name, username, password, endpoint } = req.body;

  if (!name || !username || !password || !endpoint) {
    return res.status(400).json({
      error: "Missing required fields: name, username, password, endpoint",
    });
  }

  try {
    const result = await createSipConnection(name, username, password, endpoint);
    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({ error: "Rate limit exceeded. Please slow down." });
    }
    if (error instanceof Telnyx.APIStatusError) {
      return res.status(error.status_code || 400).json({
        error: error.message,
        status_code: error.status_code,
      });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({ error: "Network error connecting to Telnyx" });
    }
    // Validation errors
    return res.status(400).json({ error: error.message });
  }
});

/**
 * GET /sip/connections/:id
 * Retrieve a specific SIP connection by ID.
 */
app.get("/sip/connections/:id", async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: "Connection ID is required" });
  }

  try {
    const result = await getSipConnection(id);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({ error: "Rate limit exceeded. Please slow down." });
    }
    if (error instanceof Telnyx.APIStatusError) {
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
 * GET /sip/connections
 * List all SIP connections.
 */
app.get("/sip/connections", async (req, res) => {
  try {
    const result = await listSipConnections();
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({ error: "Rate limit exceeded. Please slow down." });
    }
    if (error instanceof Telnyx.APIStatusError) {
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

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SIP Trunking server running on http://localhost:${PORT}`);
});
