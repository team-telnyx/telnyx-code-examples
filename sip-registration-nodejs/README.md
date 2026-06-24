# SIP Registration with Node.js and Express

## What Does This Example Do?

Build a production-ready Express endpoint that manages SIP connection registration using the Telnyx Node.js SDK. This tutorial demonstrates credential-based SIP authentication, proper error handling for telecom APIs, and secure credential management via environment variables. By the end, you'll have a working SIP trunk configured for inbound and outbound calls.

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

- Node.js 14 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number assigned to your account.
- npm (Node.js package manager).
- A SIP endpoint (PBX, softphone, or SBC) to register with Telnyx.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-registration-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` and initialize the Telnyx client using the new pattern. Define a helper function to handle SIP connection creation with proper validation:

```javascript
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
    outbound_voice_profile_id: null, // Will be set separately if needed
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
```

## Complete Code

See [`server.js`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-registration-nodejs/server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Express server. |
| Invalid SIP Endpoint Format | You receive a 400 error stating "Invalid SIP endpoint format. Use IP address or hostname." | Ensure the `endpoint` parameter is a valid IP address (e.g., `192.168.1.100`) or hostname (e.g., `pbx.example.com`). Do not include the `sip://` protocol prefix or port number in the endpoint field. |
| Missing Environment Variables | The application fails to start or crashes with `Cannot read property 'apiKey' of undefined`. | Confirm your `.env` file exists in the same directory as `app.js` and contains `TELNYX_API_KEY`. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `require("dotenv").config()` call must execute before the Telnyx client is initialized. Restart the server after updating the `.env` file. |
| SIP Connection Not Found (404) | Retrieving a connection by ID returns `{"error": "SIP connection not found"}` with HTTP 404. | Verify the connection ID is correct by listing all connections with `GET /sip/connections`. Copy the exact `id` value from the list response and use it in the retrieve request. Connection IDs are case-sensitive. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | Telnyx API has rate limits. Implement exponential backoff in your client code: wait 1 second, then 2 seconds, then 4 seconds between retries. For production, use a queue system (Bull, RabbitMQ) to throttle requests. |

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

- [Configure SIP Trunking Setup](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/nodejs/sip-trunking-setup).
- [Make Outbound SIP Calls](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/nodejs/outbound-sip-call).
- [Set Up Inbound SIP Routing](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/nodejs/inbound-sip-routing).
