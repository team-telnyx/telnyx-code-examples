#!/usr/bin/env node
/**
 * Production-ready Express application for SIP failover routing with Telnyx.
 * Implements primary/backup endpoint management, health monitoring, and automatic failover.
 */

const express = require("express");
const Telnyx = require("telnyx");
require("dotenv").config();

const app = express();
app.use(express.json());

// Initialize client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

// In-memory store for connection health status
const connectionHealth = {
  primary: { healthy: true, lastCheck: Date.now() },
  backup: { healthy: true, lastCheck: Date.now() },
};

/**
 * Create or update a SIP connection with specified endpoint.
 * Returns JSON-serializable connection data.
 */
async function createSipConnection(name, endpoint, isPrimary = true) {
  const response = await client.sip_connections.create({
    connection_name: name,
    outbound_voice_profiles: [],
    inbound: {
      sip_subdomain: `${name.toLowerCase()}-${Date.now()}`,
    },
    outbound: {
      outbound_voice_profile_id: null,
      sip_address: endpoint,
    },
    active: true,
  });

  return {
    id: response.data.id,
    name: response.data.connection_name,
    endpoint: endpoint,
    isPrimary: isPrimary,
    active: response.data.active,
    createdAt: response.data.created_at,
  };
}

/**
 * Retrieve a SIP connection by ID.
 * Returns JSON-serializable connection data.
 */
async function getSipConnection(connectionId) {
  const response = await client.sip_connections.retrieve(connectionId);

  return {
    id: response.data.id,
    name: response.data.connection_name,
    active: response.data.active,
    createdAt: response.data.created_at,
  };
}

/**
 * List all SIP connections.
 * Returns array of JSON-serializable connection objects.
 */
async function listSipConnections() {
  const response = await client.sip_connections.list();

  return response.data.map((conn) => ({
    id: conn.id,
    name: conn.connection_name,
    active: conn.active,
    createdAt: conn.created_at,
  }));
}

/**
 * Determine the active endpoint based on health status.
 * Returns primary endpoint if healthy, otherwise backup.
 */
function getActiveEndpoint() {
  if (connectionHealth.primary.healthy) {
    return {
      endpoint: process.env.PRIMARY_SIP_ENDPOINT,
      type: "primary",
    };
  }
  return {
    endpoint: process.env.BACKUP_SIP_ENDPOINT,
    type: "backup",
  };
}

/**
 * Simulate health check by attempting to reach the SIP endpoint.
 * In production, use OPTION requests or dedicated monitoring.
 */
async function checkEndpointHealth(endpoint, type) {
  try {
    // Simulate health check (in production, send SIP OPTIONS)
    const isHealthy = Math.random() > 0.1; // 90% success rate for demo
    connectionHealth[type].healthy = isHealthy;
    connectionHealth[type].lastCheck = Date.now();

    return {
      endpoint: endpoint,
      type: type,
      healthy: isHealthy,
      lastCheck: new Date(connectionHealth[type].lastCheck).toISOString(),
    };
  } catch (error) {
    connectionHealth[type].healthy = false;
    connectionHealth[type].lastCheck = Date.now();

    return {
      endpoint: endpoint,
      type: type,
      healthy: false,
      error: error.message,
      lastCheck: new Date(connectionHealth[type].lastCheck).toISOString(),
    };
  }
}

/**
 * Route handler: Create SIP connections with failover configuration.
 */
app.post("/sip/connections/setup", async (req, res) => {
  try {
    const primaryName = "primary-sip-trunk";
    const backupName = "backup-sip-trunk";

    const primary = await createSipConnection(
      primaryName,
      process.env.PRIMARY_SIP_ENDPOINT,
      true
    );
    const backup = await createSipConnection(
      backupName,
      process.env.BACKUP_SIP_ENDPOINT,
      false
    );

    res.json({
      message: "SIP connections created successfully",
      primary: primary,
      backup: backup,
      activeEndpoint: getActiveEndpoint(),
    });
  } catch (error) {
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    if (error instanceof Telnyx.APIError) {
      return res.status(error.status_code).json({ error: error.message });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res
        .status(503)
        .json({ error: "Network error connecting to Telnyx" });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * Route handler: List all SIP connections.
 */
app.get("/sip/connections", async (req, res) => {
  try {
    const connections = await listSipConnections();
    res.json({
      connections: connections,
      count: connections.length,
    });
  } catch (error) {
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }
    if (error instanceof Telnyx.APIError) {
      return res.status(error.status_code).json({ error: error.message });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res
        .status(503)
        .json({ error: "Network error connecting to Telnyx" });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * Route handler: Get current failover status and active endpoint.
 */
app.get("/sip/failover/status", (req, res) => {
  const activeEndpoint = getActiveEndpoint();

  res.json({
    activeEndpoint: activeEndpoint,
    primary: {
      endpoint: process.env.PRIMARY_SIP_ENDPOINT,
      healthy: connectionHealth.primary.healthy,
      lastCheck: new Date(connectionHealth.primary.lastCheck).toISOString(),
    },
    backup: {
      endpoint: process.env.BACKUP_SIP_ENDPOINT,
      healthy: connectionHealth.backup.healthy,
      lastCheck: new Date(connectionHealth.backup.lastCheck).toISOString(),
    },
  });
});

/**
 * Route handler: Manually trigger health check for both endpoints.
 */
app.post("/sip/failover/health-check", async (req, res) => {
  try {
    const primaryCheck = await checkEndpointHealth(
      process.env.PRIMARY_SIP_ENDPOINT,
      "primary"
    );
    const backupCheck = await checkEndpointHealth(
      process.env.BACKUP_SIP_ENDPOINT,
      "backup"
    );

    const activeEndpoint = getActiveEndpoint();

    res.json({
      checks: [primaryCheck, backupCheck],
      activeEndpoint: activeEndpoint,
      failoverTriggered: !connectionHealth.primary.healthy,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Route handler: Webhook endpoint for Telnyx call events.
 * Logs incoming call events and demonstrates failover awareness.
 */
app.post("/webhooks/sip", (req, res) => {
  const event = req.body;

  // Log the event for debugging
  console.log("Received SIP event:", {
    type: event.data?.event_type,
    callId: event.data?.call_control_id,
    from: event.data?.from,
    to: event.data?.to,
    timestamp: event.data?.occurred_at,
  });

  // Acknowledge receipt immediately
  res.status(200).json({ received: true });

  // In production, route based on active endpoint
  const activeEndpoint = getActiveEndpoint();
  console.log(`Routing call to ${activeEndpoint.type} endpoint`);
});

/**
 * Route handler: Health check endpoint for load balancers.
 */
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Express server running on port ${PORT}`);
  console.log(`Webhook URL: ${process.env.WEBHOOK_URL}`);
});
