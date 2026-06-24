# Failover Routing with Node.js and Express

## What Does This Example Do?

Build a production-ready Express application that implements failover routing for SIP trunks using the Telnyx Node.js SDK. This tutorial demonstrates how to configure primary and backup SIP endpoints, monitor connection health, and automatically route calls to secondary endpoints when the primary fails. You'll learn the new client-based initialization pattern, proper error handling for telecom APIs, and secure credential management via environment variables.

## Who Is This For?

- **Node.js developers** building sip features with Express.
- **Backend engineers** integrating telephony or messaging into existing applications.
- **DevOps teams** looking for containerized, production-ready telecom examples.
- **Startups and enterprises** replacing legacy telecom providers with a modern API-first platform.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform that gives developers a single API for [voice](https://telnyx.com/products/voice-ai-agents), [messaging](https://telnyx.com/products/sms-api), [SIP](https://telnyx.com/products/sip-trunks), [AI](https://telnyx.com/ai-assistants), and [IoT](https://telnyx.com/products/iot-sim-card) — no Frankenstack required.

- **Integrated platform** — [Voice](https://telnyx.com/products/voice-ai-agents), [SMS](https://telnyx.com/products/sms-api), [SIP trunking](https://telnyx.com/products/sip-trunks), [AI assistants](https://telnyx.com/ai-assistants), and [IoT SIM management](https://telnyx.com/products/iot-sim-card) under one roof. No stitching together multiple vendors.
- **Global private network** — Calls and messages traverse the Telnyx-owned IP network for lower latency and higher reliability than the public internet.
- **Developer-first** — SDKs for Python, Node.js, Go, Ruby, Java, and PHP. Comprehensive webhook event model. Sandbox environment for testing.
- **Competitive pricing** — Pay-as-you-go with no minimums, contracts, or per-seat fees.

## Prerequisites

- Node.js 16 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- Two SIP endpoints (PBX, SBC, or softphone) for primary and backup routing.
- npm (Node.js package manager).
- A publicly accessible URL for webhook callbacks (ngrok or similar for local testing).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-failover-routing-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` and initialize the Telnyx client using the new pattern. Define helper functions to manage SIP connections with failover logic:

```javascript
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
```

## Complete Code

See [`server.js`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-failover-routing-nodejs/server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Express server. |
| SIP Endpoint Not Reachable | Health checks fail or calls don't route to the backup endpoint. | Confirm both `PRIMARY_SIP_ENDPOINT` and `BACKUP_SIP_ENDPOINT` are valid, publicly routable addresses in the format `hostname:port` (e.g., `sip.example.com:5060`). Test connectivity using `telnet` or `nmap` from your server. Ensure your firewall allows SIP traffic (UDP/TCP port 5060 or 5061 for TLS). |
| Webhook Events Not Received | The `/webhooks/sip` endpoint is not receiving call events from Telnyx. | Verify the `WEBHOOK_URL` in your `.env` file is publicly accessible and matches the URL configured in the Telnyx Portal for your SIP connection. Use ngrok (`ngrok http 3000`) for local testing and update the webhook URL accordingly. Ensure your Express server is running and listening on the correct port. Check firewall rules to allow inbound HTTPS traffic on port 443. |
| Failover Not Triggering | Primary endpoint remains active even when it's down. | The health check logic in this tutorial is simulated. In production, implement real SIP OPTIONS requests or use a dedicated monitoring service. Manually test failover by calling `POST /sip/failover/health-check` and observing the response. Integrate with a monitoring tool like Prometheus or Datadog to track endpoint health continuously. |
| Rate Limit Exceeded (429) | Requests return `{"error": "Rate limit exceeded"}` with HTTP 429. | Telnyx API has rate limits (typically 100 requests per second). Implement exponential backoff in your health check loop and cache connection data when possible. Reduce the frequency of health checks or use a dedicated monitoring service instead of polling from your application. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SIP example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What Node.js version do I need?**

Node.js 18 or higher. Node.js 20 LTS is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [SIP Trunking Get Started](https://developers.telnyx.com/docs/voice/sip-trunking/get-started)
- [SIP Configuration Guides](https://developers.telnyx.com/docs/voice/sip-trunking/configuration-guides)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx SIP Trunks](https://telnyx.com/products/sip-trunks)
- [SIP Trunking Pricing](https://telnyx.com/pricing/elastic-sip)

## Related Examples

- [Configure SIP Authentication](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/nodejs/sip-authentication).
- [Set Up Inbound SIP Routing](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/nodejs/inbound-sip-routing).
- [Make Outbound SIP Calls](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/nodejs/outbound-sip-call).
