# SIP Trunking Setup with Node.js and Express

## What Does This Example Do?

Build a production-ready Express application that manages SIP trunk connections using the Telnyx Node.js SDK. This tutorial demonstrates how to create SIP connections, configure authentication credentials, and retrieve connection details for integrating your PBX or SBC with Telnyx's SIP infrastructure. You'll learn the new client-based initialization pattern, proper error handling for telecom APIs, and secure credential management via environment variables.

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
- npm (Node package manager).
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A publicly accessible domain or IP address for your SIP endpoint (for production deployments).
- Basic understanding of SIP concepts (SIP proxy, credentials, endpoints).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/setup-sip-trunk-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/setup-sip-trunk-nodejs
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` and initialize the Telnyx client using the new pattern. Define helper functions to manage SIP connections with proper validation and error handling:

```javascript
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

  // Parse endpoint to extract host and port
  const [host, port] = endpoint.split(":");
  const sipPort = port ? parseInt(port, 10) : 5060;

  // Create SIP connection via Telnyx API
  const response = await client.sipConnections.create({
    connection_name: name,
    outbound_voice_profile_id: null, // Will be assigned separately if needed
    inbound: {
      sip_subdomain: null, // Use default Telnyx subdomain
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
```

## Complete Code

See [`server.js`](./server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Express server. |
| Invalid Endpoint Format | You receive a 400 error stating "Endpoint must be a valid hostname or IP address with optional port". | Ensure your SIP endpoint is formatted correctly: use a fully qualified domain name (e.g., `sip.example.com`) or IP address with optional port (e.g., `192.168.1.100:5060`). The endpoint must contain a dot (for domain) or colon (for port) to pass validation. |
| Environment Variable Not Set | The application fails to initialize or returns `undefined` for API key. | Confirm your `.env` file exists in the same directory as `app.js` and contains `TELNYX_API_KEY=your_key_here`. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `require("dotenv").config()` call must execute before any API calls—verify this import order at the top of your file. |
| Connection Creation Fails with 400 | The API returns a 400 error with a message about invalid parameters. | Verify all required fields are present in your POST request: `name`, `username`, `password`, and `endpoint`. Ensure the `username` and `password` are valid SIP credentials (alphanumeric, no special characters). Check that your endpoint is reachable and supports SIP on the specified port (default 5060). |
| Rate Limit Error (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | You have exceeded the Telnyx API rate limit. Implement exponential backoff in your client code: wait 1 second, then 2 seconds, then 4 seconds between retries. Check the [Telnyx API documentation](https://developers.telnyx.com/docs/api) for current rate limits and contact support if you need higher limits. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SIP example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

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

- [Configure SIP Registration and Authentication](/tutorials/sip/nodejs/sip-authentication).
- [Set Up Inbound SIP Call Routing](/tutorials/sip/nodejs/inbound-sip-routing).
- [Implement SIP Failover and Load Balancing](/tutorials/sip/nodejs/failover-routing).
