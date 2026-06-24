#!/usr/bin/env node
/**
 * Production-ready Express server for SIP connection registration via Telnyx.
 * Demonstrates credential-based SIP authentication and error handling.
 */

const Telnyx = require("telnyx");
const express = require("express");
require("dotenv").config();

const app = express();
app.use(express.json());

// Initialize client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

/**
 * Create a SIP connection with credential-based authentication.
 * Returns JSON-serializable response data.
 */
async function createSipConnection(connectionName, username, password, endpoint) {
  // Validate required fields
  if (!connectionName || !username || !password || !endpoint) {
    throw new Error("Missing required SIP connection parameters");
  }

  // Validate endpoint format (IP or hostname)
  if (!/^[\w.-]+$/.test(endpoint)) {
    throw new Error("Invalid SIP endpoint format. Use IP address or hostname.");
  }

  // Create SIP connection with credential authentication
  const response = await client.credentialConnections.create({
    connection_name: connectionName,
    outbound_voice_profile_id: null,
    inbound: {
      sip_subdomain: connectionName.toLowerCase().replace(/\s+/g, "-"),
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
  });

  // Extract serializable data — SDK objects are NOT JSON-serializable
  return {
    id: response.data.id,
    connection_name: response.data.connection_name,
    username: response.data.credentials?.authentication?.username || username,
    sip_subdomain: response.data.inbound?.sip_subdomain || null,
    created_at: response.data.created_at,
  };
}

/**
 * Retrieve an existing SIP connection by ID.
 */
async function getSipConnection(connectionId) {
  const response = await client.credentialConnections.retrieve(connectionId);

  return {
    id: response.data.id,
    connection_name: response.data.connection_name,
    username: response.data.credentials?.authentication?.username || null,
    sip_subdomain: response.data.inbound?.sip_subdomain || null,
    created_at: response.data.created_at,
  };
}

/**
 * List all SIP connections.
 */
async function listSipConnections() {
  const response = await client.credentialConnections.list();

  return response.data.map((conn) => ({
    id: conn.id,
    connection_name: conn.connection_name,
    username: conn.credentials?.authentication?.username || null,
    sip_subdomain: conn.inbound?.sip_subdomain || null,
    created_at: conn.created_at,
  }));
}

/**
 * POST /sip/connections
 * Create a new SIP connection with credential authentication.
 */
app.post("/sip/connections", async (req, res) => {
  const { connection_name, username, password, endpoint } = req.body;

  if (!connection_name || !username || !password || !endpoint) {
    return res.status(400).json({
      error: "Missing required fields: connection_name, username, password, endpoint",
    });
  }

  try {
    const result = await createSipConnection(
      connection_name,
      username,
      password,
      endpoint
    );
    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({
        error: "Rate limit exceeded. Please slow down.",
      });
    }
    if (error instanceof Telnyx.APIError) {
      return res.status(error.status_code || 400).json({
        error: error.message,
        status_code: error.status_code,
      });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({
        error: "Network error connecting to Telnyx",
      });
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
    return res.status(400).json({ error: "Connection ID required" });
  }

  try {
    const result = await getSipConnection(id);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof Telnyx.APIError) {
      if (error.status_code === 404) {
        return res.status(404).json({ error: "SIP connection not found" });
      }
      return res.status(error.status_code || 400).json({
        error: error.message,
        status_code: error.status_code,
      });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({
        error: "Network error connecting to Telnyx",
      });
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
    const result = await listSipConnections();
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({
        error: "Rate limit exceeded. Please slow down.",
      });
    }
    if (error instanceof Telnyx.APIError) {
      return res.status(error.status_code || 400).json({
        error: error.message,
        status_code: error.status_code,
      });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({
        error: "Network error connecting to Telnyx",
      });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SIP Registration server running on http://localhost:${PORT}`);
});
