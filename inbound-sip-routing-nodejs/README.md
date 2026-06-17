# Inbound SIP Routing with Node.js and Express

## What Does This Example Do?

Build a production-ready Express application that receives inbound SIP calls and routes them to your SIP endpoints using the Telnyx Node.js SDK. This tutorial demonstrates how to create a SIP connection, configure inbound routing, and handle call webhooks with proper error handling and secure credential management.

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
- A Telnyx phone number enabled for inbound calls.
- npm (Node.js package manager).
- A publicly accessible URL for webhook callbacks (ngrok or similar for local development).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/inbound-sip-routing-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/inbound-sip-routing-nodejs
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` and initialize the Telnyx client using the Node.js SDK pattern. Define a helper function to create a SIP connection with proper validation:

```javascript
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
```

## Complete Code

See [`server.js`](./server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Express server. |
| SIP Connection Creation Fails | You receive a 400 or 422 error when creating a SIP connection. | Verify that `SIP_ENDPOINT`, `SIP_USERNAME`, and `SIP_PASSWORD` are correctly set in your `.env` file. Ensure the SIP endpoint is reachable and supports the authentication method you configured. Test connectivity to your SIP server from the command line using a SIP client like `sipsak` or `sipgrep`. |
| Webhook Not Receiving Events | Inbound calls are not triggering the `/webhooks/inbound-call` endpoint. | Confirm that your `WEBHOOK_URL` in the `.env` file is publicly accessible and correctly configured in the Telnyx Portal. If using ngrok, ensure the tunnel is active and the URL matches your ngrok public URL. Check your firewall and router settings to allow inbound traffic on port 3000 (or your configured port). Verify that the SIP connection is properly linked to your Telnyx phone number in the Portal. |
| Environment Variables Not Loading | The application crashes with `Cannot read property 'apiKey' of undefined` or similar. | Confirm your `.env` file exists in the same directory as `app.js` and contains all required variables. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `require("dotenv").config()` call must execute before any `process.env` access. Restart the Node.js process after updating the `.env` file. |

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

- [Set Up SIP Trunking with Telnyx](/tutorials/sip/nodejs/sip-trunking-setup).
- [Configure SIP Authentication](/tutorials/sip/nodejs/sip-authentication).
- [Implement Failover Routing for SIP Connections](/tutorials/sip/nodejs/failover-routing).
