# Data Usage Monitoring with Node.js and Express

## What Does This Example Do?

Build a production-ready Express application that monitors SIM card data usage in real time using the Telnyx IoT SDK. This tutorial demonstrates how to retrieve data consumption metrics, set up periodic polling for usage updates, and expose REST endpoints for querying SIM card data limits and current usage. You'll learn the new client-based initialization pattern, proper error handling for telecom APIs, and secure credential management via environment variables.

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

- Node.js 16 or higher.
- npm (Node package manager).
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- At least one active SIM card in your Telnyx account.
- A publicly accessible URL or ngrok tunnel for webhook testing (optional but recommended).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/monitor-iot-data-usage-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/monitor-iot-data-usage-nodejs
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` and initialize the Telnyx client using the new pattern. Define helper functions to fetch SIM card data usage and manage polling:

```javascript
const express = require('express');
const Telnyx = require('telnyx');
const config = require('./config');

const app = express();
app.use(express.json());

// Initialize client with the new SDK pattern
const client = new Telnyx({ apiKey: config.apiKey });

// In-memory cache for SIM card data usage (in production, use a database)
const simDataCache = new Map();

/**
 * Fetch data usage for a specific SIM card.
 * Returns null if the SIM card is not found or data is unavailable.
 */
async function getSimDataUsage(simCardId) {
  try {
    // Retrieve SIM card details
    const simResponse = await client.simCards.retrieve(simCardId);
    const sim = simResponse.data;

    // Fetch network usage data via REST endpoint
    // Note: The SDK may not expose network_usage directly; use axios for REST calls
    const axios = require('axios');
    const usageResponse = await axios.get(
      `https://api.telnyx.com/v2/sim_cards/${simCardId}/network_usage`,
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return {
      simCardId: sim.id,
      iccid: sim.iccid,
      status: sim.status,
      simCardGroupId: sim.sim_card_group_id,
      dataUsage: usageResponse.data.data, // Contains usage metrics
    };
  } catch (error) {
    console.error(`Error fetching data usage for SIM ${simCardId}:`, error.message);
    return null;
  }
}

/**
 * List all SIM cards and return serializable data.
 */
async function listAllSimCards() {
  try {
    const response = await client.simCards.list();
    return response.data.map((sim) => ({
      id: sim.id,
      iccid: sim.iccid,
      status: sim.status,
      simCardGroupId: sim.sim_card_group_id,
    }));
  } catch (error) {
    console.error('Error listing SIM cards:', error.message);
    throw error;
  }
}

/**
 * Poll data usage for all SIM cards and update cache.
 */
async function pollDataUsage() {
  try {
    const sims = await listAllSimCards();
    for (const sim of sims) {
      const usage = await getSimDataUsage(sim.id);
      if (usage) {
        simDataCache.set(sim.id, usage);
        console.log(`Updated data usage for SIM ${sim.id}`);
      }
    }
  } catch (error) {
    console.error('Error during data usage polling:', error.message);
  }
}

// Start polling on server startup
setInterval(pollDataUsage, config.pollingInterval);
pollDataUsage(); // Initial poll

module.exports = { app, client, getSimDataUsage, listAllSimCards, simDataCache };
```

Create `routes.js` to define REST endpoints for querying SIM data usage:

```javascript
const express = require('express');
const Telnyx = require('telnyx');
const { client, getSimDataUsage, listAllSimCards, simDataCache } = require('./app');

const router = express.Router();

/**
 * GET /sims
 * List all SIM cards with cached data usage.
 */
router.get('/sims', async (req, res) => {
  try {
    const sims = await listAllSimCards();
    const simsWithUsage = sims.map((sim) => {
      const cached = simDataCache.get(sim.id);
      return {
        ...sim,
        dataUsage: cached ? cached.dataUsage : null,
        lastUpdated: cached ? new Date().toISOString() : null,
      };
    });
    res.json(simsWithUsage);
  } catch (error) {
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please slow down.' });
    }
    if (error instanceof Telnyx.APIStatusError) {
      return res.status(error.status_code).json({ error: error.message });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({ error: 'Network error connecting to Telnyx' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /sims/:simCardId
 * Retrieve detailed data usage for a specific SIM card.
 */
router.get('/sims/:simCardId', async (req, res) => {
  const { simCardId } = req.params;

  try {
    const usage = await getSimDataUsage(simCardId);
    if (!usage) {
      return res.status(404).json({ error: 'SIM card not found or data unavailable' });
    }
    res.json(usage);
  } catch (error) {
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please slow down.' });
    }
    if (error instanceof Telnyx.APIStatusError) {
      return res.status(error.status_code).json({ error: error.message });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({ error: 'Network error connecting to Telnyx' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /sims/:simCardId/usage-summary
 * Return a human-readable usage summary with percentage and alerts.
 */
router.get('/sims/:simCardId/usage-summary', async (req, res) => {
  const { simCardId } = req.params;

  try {
    const cached = simDataCache.get(simCardId);
    if (!cached) {
      return res.status(404).json({ error: 'SIM card data not yet cached. Try again in a moment.' });
    }

    const { dataUsage } = cached;
    const totalBytes = dataUsage.limit_bytes || 0;
    const usedBytes = dataUsage.usage_bytes || 0;
    const percentageUsed = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;

    const summary = {
      simCardId,
      totalDataLimitMB: (totalBytes / 1024 / 1024).toFixed(2),
      usedDataMB: (usedBytes / 1024 / 1024).toFixed(2),
      remainingDataMB: ((totalBytes - usedBytes) / 1024 / 1024).toFixed(2),
      percentageUsed: percentageUsed.toFixed(2),
      alert: percentageUsed > 80 ? 'WARNING: Data usage exceeds 80%' : 'OK',
    };

    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
```

Update `app.js` to include the routes:

```javascript
const express = require('express');
const Telnyx = require('telnyx');
const config = require('./config');
const routes = require('./routes');

const app = express();
app.use(express.json());

// Initialize client with the new SDK pattern
const client = new Telnyx({ apiKey: config.apiKey });

// In-memory cache for SIM card data usage (in production, use a database)
const simDataCache = new Map();

/**
 * Fetch data usage for a specific SIM card.
 * Returns null if the SIM card is not found or data is unavailable.
 */
async function getSimDataUsage(simCardId) {
  try {
    // Retrieve SIM card details
    const simResponse = await client.simCards.retrieve(simCardId);
    const sim = simResponse.data;

    // Fetch network usage data via REST endpoint
    const axios = require('axios');
    const usageResponse = await axios.get(
      `https://api.telnyx.com/v2/sim_cards/${simCardId}/network_usage`,
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return {
      simCardId: sim.id,
      iccid: sim.iccid,
      status: sim.status,
      simCardGroupId: sim.sim_card_group_id,
      dataUsage: usageResponse.data.data,
    };
  } catch (error) {
    console.error(`Error fetching data usage for SIM ${simCardId}:`, error.message);
    return null;
  }
}

/**
 * List all SIM cards and return serializable data.
 */
async function listAllSimCards() {
  try {
    const response = await client.simCards.list();
    return response.data.map((sim) => ({
      id: sim.id,
      iccid: sim.iccid,
      status: sim.status,
      simCardGroupId: sim.sim_card_group_id,
    }));
  } catch (error) {
    console.error('Error listing SIM cards:', error.message);
    throw error;
  }
}

/**
 * Poll data usage for all SIM cards and update cache.
 */
async function pollDataUsage() {
  try {
    const sims = await listAllSimCards();
    for (const sim of sims) {
      const usage = await getSimDataUsage(sim.id);
      if (usage) {
        simDataCache.set(sim.id, usage);
        console.log(`Updated data usage for SIM ${sim.id}`);
      }
    }
  } catch (error) {
    console.error('Error during data usage polling:', error.message);
  }
}

// Start polling on server startup
setInterval(pollDataUsage, config.pollingInterval);
pollDataUsage(); // Initial poll

// Register routes
app.use('/api', routes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = { app, client, getSimDataUsage, listAllSimCards, simDataCache };
```

Create `server.js` to start the Express server:

```javascript
const { app } = require('./app');
const config = require('./config');

app.listen(config.port, () => {
  console.log(`Data usage monitoring server running on port ${config.port}`);
  console.log(`Polling interval: ${config.pollingInterval}ms`);
});
```

## Complete Code

See [`server.js`](./server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Express server. |
| SIM Card Data Not Yet Cached | The `/usage-summary` endpoint returns `{"error": "SIM card data not yet cached. Try again in a moment."}` with HTTP 404. | The polling interval may not have completed yet. Wait for the polling interval to elapse (default 5 minutes) or reduce the `POLLING_INTERVAL` in your `.env` file to speed up testing. Alternatively, manually trigger `pollDataUsage()` by restarting the server. |
| Network Error Connecting to Telnyx | The endpoint returns `{"error": "Network error connecting to Telnyx"}` with HTTP 503. | Verify your internet connection and that the Telnyx API is accessible. Check that your firewall or proxy does not block requests to `api.telnyx.com`. Ensure the `Authorization` header in the axios request includes the correct Bearer token format. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | You are making too many requests to the Telnyx API. Increase the `POLLING_INTERVAL` in your `.env` file to reduce polling frequency. Implement exponential backoff in your polling logic for production use. |
| SIM Card Not Found | The `/sims/:simCardId` endpoint returns `{"error": "SIM card not found or data unavailable"}` with HTTP 404. | Verify that the `simCardId` parameter is correct and matches a SIM card in your Telnyx account. Check the [Telnyx Portal](https://portal.telnyx.com) to confirm the SIM card exists and is active. Ensure the SIM card has network usage data available. |

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

- [Activate a SIM Card with Node.js](/tutorials/iot/nodejs/sim-activation).
- [Monitor SIM Status Changes with Webhooks](/tutorials/iot/nodejs/sim-status-webhook).
- [Configure APN Settings for IoT Devices](/tutorials/iot/nodejs/apn-configuration).
