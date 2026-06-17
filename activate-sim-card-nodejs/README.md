# SIM Activation with Node.js and Express

## What Does This Example Do?

Build a production-ready Express endpoint that activates SIM cards using the Telnyx Node.js SDK. This tutorial demonstrates the client-based initialization pattern, proper error handling for IoT APIs, and secure credential management via environment variables. You'll learn how to retrieve SIM card details, activate them, and handle common errors in a real-world application.

## Who Is This For?

- **Node.js developers** building iot features with Express.
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
- At least one SIM card in your Telnyx account (in `ready` or `standby` status).
- A code editor and terminal.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/activate-sim-card-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/activate-sim-card-nodejs
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` and initialize the Telnyx client using the Node.js SDK pattern. Define a helper function to handle SIM activation with proper validation:

```javascript
const express = require('express');
const Telnyx = require('telnyx');
const config = require('./config');

const app = express();
app.use(express.json());

// Initialize client with the SDK pattern
const client = new Telnyx({ apiKey: config.apiKey });

/**
 * Retrieve SIM card details by ID.
 * Returns a plain object (not SDK object) for JSON serialization.
 */
async function getSimCard(simCardId) {
  const response = await client.simCards.retrieve(simCardId);
  
  return {
    id: response.data.id,
    iccid: response.data.iccid,
    status: response.data.status,
    simCardGroupId: response.data.sim_card_group_id,
    phoneNumber: response.data.phone_number || null,
  };
}

/**
 * Activate a SIM card by ID.
 * Returns activation response data as a plain object.
 */
async function activateSimCard(simCardId) {
  // Validate that the SIM ID is provided
  if (!simCardId || typeof simCardId !== 'string') {
    throw new Error('SIM card ID must be a non-empty string');
  }

  const response = await client.simCards.activate(simCardId);

  return {
    id: response.data.id,
    iccid: response.data.iccid,
    status: response.data.status,
    simCardGroupId: response.data.sim_card_group_id,
    activatedAt: response.data.activated_at || null,
  };
}

module.exports = { app, client, getSimCard, activateSimCard };
```

## Complete Code

See [`server.js`](./server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Node.js server after updating the `.env` file. The SDK reads environment variables at startup, so changes require a restart. |
| SIM Card Not Found (404) | The API returns a 404 error when retrieving or activating a SIM card. | Confirm the SIM card ID is correct and exists in your Telnyx account. Check the [Telnyx Portal](https://portal.telnyx.com) under IoT → SIM Cards to verify the ID. Ensure the SIM is in a state that allows activation (typically `ready` or `standby` status). |
| Rate Limit Error (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | The Telnyx API enforces rate limits. Implement exponential backoff in your client code: wait 1 second, then 2 seconds, then 4 seconds between retries. For bulk SIM activation, use the SIM Card Group API to activate multiple SIMs in a single request instead of looping through individual activations. |
| Network Error (503) | The endpoint returns `{"error": "Network error connecting to Telnyx"}` with HTTP 503. | Verify your internet connection and that the Telnyx API is reachable. Check if your firewall or proxy blocks outbound HTTPS connections to `api.telnyx.com`. Temporarily disable VPN or proxy software to test connectivity. If the issue persists, check the [Telnyx Status Page](https://status.telnyx.com) for service incidents. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this IoT example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What Node.js version do I need?**

Node.js 18 or higher. Node.js 20 LTS is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [IoT SIM Get Started](https://developers.telnyx.com/docs/iot-sim/get-started)
- [SIM Card API Reference](https://developers.telnyx.com/api-reference/sim-cards/get-all-sim-cards)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx IoT SIM Cards](https://telnyx.com/products/iot-sim-card)
- [IoT Data Plans Pricing](https://telnyx.com/pricing/iot-data-plans)

## Related Examples

- [Monitor SIM Data Usage](/tutorials/iot/nodejs/data-usage-monitoring).
- [Configure Custom APN Settings](/tutorials/iot/nodejs/apn-configuration).
- [Handle SIM Status Change Webhooks](/tutorials/iot/nodejs/sim-status-webhook).
