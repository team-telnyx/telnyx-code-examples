# eSIM Provisioning with Node.js and Express

## What Does This Example Do?

Build a production-ready Express application that provisions eSIM profiles over-the-air using the Telnyx IoT API. This tutorial demonstrates how to manage eSIM lifecycle—from profile creation through activation and status monitoring—with proper error handling, webhook integration, and secure credential management. You'll learn to handle asynchronous provisioning workflows and integrate with device management systems.

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
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- Access to the Telnyx IoT / SIM Management API.
- npm (Node package manager).
- A publicly accessible URL for webhook callbacks (ngrok or similar for local testing).
- Basic understanding of async/await and Express middleware.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/provision-esim-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create the main Express application at `app.js`:

```javascript
const express = require('express');
const Telnyx = require('telnyx');
const config = require('./config');

const app = express();

// Middleware
app.use(express.json());

// Initialize Telnyx client with the new SDK pattern
const client = new Telnyx({ apiKey: config.apiKey });

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware — catch all Telnyx exceptions here
app.use((err, req, res, next) => {
  console.error('Error:', err.message);

  if (err instanceof Telnyx.AuthenticationError) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  if (err instanceof Telnyx.RateLimitError) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please slow down.' });
  }
  if (err instanceof Telnyx.APIError) {
    return res.status(err.status_code || 500).json({
      error: err.message,
      status_code: err.status_code,
    });
  }
  if (err instanceof Telnyx.APIConnectionError) {
    return res.status(503).json({ error: 'Network error connecting to Telnyx' });
  }

  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(config.port, () => {
  console.log(`eSIM Provisioning server running on port ${config.port}`);
});

module.exports = { app, client };
```

Create a helper module at `models/esimManager.js` to encapsulate eSIM provisioning logic:

```javascript
const Telnyx = require('telnyx');

class ESIMManager {
  constructor(client) {
    this.client = client;
  }

  /**
   * Create an eSIM profile for a device.
   * @param {string} simCardGroupId - The SIM card group ID for organization.
   * @param {object} deviceInfo - Device metadata (name, imei, etc.).
   * @returns {Promise<object>} Provisioned SIM card data.
   */
  async createESIMProfile(simCardGroupId, deviceInfo) {
    if (!simCardGroupId) {
      throw new Error('simCardGroupId is required');
    }

    // Create a new SIM card in the specified group
    const response = await this.client.sim_cards.create({
      sim_card_group_id: simCardGroupId,
      tags: {
        device_name: deviceInfo.name || 'unknown',
        imei: deviceInfo.imei || 'unknown',
        provisioned_at: new Date().toISOString(),
      },
    });

    // Extract serializable data — SDK objects are NOT JSON-serializable
    return {
      id: response.data.id,
      iccid: response.data.iccid,
      status: response.data.status,
      sim_card_group_id: response.data.sim_card_group_id,
      tags: response.data.tags,
    };
  }

  /**
   * Activate an eSIM profile for a device.
   * @param {string} simCardId - The SIM card ID to activate.
   * @returns {Promise<object>} Activated SIM card data.
   */
  async activateESIM(simCardId) {
    if (!simCardId) {
      throw new Error('simCardId is required');
    }

    const response = await this.client.sim_cards.activate(simCardId);

    return {
      id: response.data.id,
      iccid: response.data.iccid,
      status: response.data.status,
      activated_at: new Date().toISOString(),
    };
  }

  /**
   * Retrieve eSIM profile details.
   * @param {string} simCardId - The SIM card ID.
   * @returns {Promise<object>} SIM card details.
   */
  async getESIMProfile(simCardId) {
    if (!simCardId) {
      throw new Error('simCardId is required');
    }

    const response = await this.client.sim_cards.retrieve(simCardId);

    return {
      id: response.data.id,
      iccid: response.data.iccid,
      status: response.data.status,
      sim_card_group_id: response.data.sim_card_group_id,
      tags: response.data.tags,
      created_at: response.data.created_at,
    };
  }

  /**
   * List all eSIM profiles in a SIM card group.
   * @param {string} simCardGroupId - The SIM card group ID.
   * @returns {Promise<array>} List of SIM cards.
   */
  async listESIMProfiles(simCardGroupId) {
    if (!simCardGroupId) {
      throw new Error('simCardGroupId is required');
    }

    const response = await this.client.sim_cards.list({
      filter: { sim_card_group_id: simCardGroupId },
    });

    return response.data.map((sim) => ({
      id: sim.id,
      iccid: sim.iccid,
      status: sim.status,
      sim_card_group_id: sim.sim_card_group_id,
      tags: sim.tags,
    }));
  }

  /**
   * Suspend an eSIM profile.
   * @param {string} simCardId - The SIM card ID to suspend.
   * @returns {Promise<object>} Suspended SIM card data.
   */
  async suspendESIM(simCardId) {
    if (!simCardId) {
      throw new Error('simCardId is required');
    }

    const response = await this.client.sim_cards.deactivate(simCardId);

    return {
      id: response.data.id,
      iccid: response.data.iccid,
      status: response.data.status,
      suspended_at: new Date().toISOString(),
    };
  }
}

module.exports = ESIMManager;
```

Create API routes at `routes/esim.js`:

```javascript
const express = require('express');
const Telnyx = require('telnyx');
const ESIMManager = require('../models/esimManager');

module.exports = (client) => {
  const router = express.Router();
  const esimManager = new ESIMManager(client);

  /**
   * POST /esim/provision
   * Create and provision a new eSIM profile.
   */
  router.post('/provision', async (req, res, next) => {
    try {
      const { simCardGroupId, deviceInfo } = req.body;

      if (!simCardGroupId || !deviceInfo) {
        return res.status(400).json({
          error: 'Missing required fields: simCardGroupId, deviceInfo',
        });
      }

      const profile = await esimManager.createESIMProfile(
        simCardGroupId,
        deviceInfo
      );

      res.status(201).json({
        message: 'eSIM profile created successfully',
        profile,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /esim/:simCardId/activate
   * Activate an eSIM profile.
   */
  router.post('/:simCardId/activate', async (req, res, next) => {
    try {
      const { simCardId } = req.params;

      const profile = await esimManager.activateESIM(simCardId);

      res.json({
        message: 'eSIM profile activated successfully',
        profile,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /esim/:simCardId
   * Retrieve eSIM profile details.
   */
  router.get('/:simCardId', async (req, res, next) => {
    try {
      const { simCardId } = req.params;

      const profile = await esimManager.getESIMProfile(simCardId);

      res.json(profile);
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /esim/group/:simCardGroupId
   * List all eSIM profiles in a group.
   */
  router.get('/group/:simCardGroupId', async (req, res, next) => {
    try {
      const { simCardGroupId } = req.params;

      const profiles = await esimManager.listESIMProfiles(simCardGroupId);

      res.json({
        count: profiles.length,
        profiles,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /esim/:simCardId/suspend
   * Suspend an eSIM profile.
   */
  router.post('/:simCardId/suspend', async (req, res, next) => {
    try {
      const { simCardId } = req.params;

      const profile = await esimManager.suspendESIM(simCardId);

      res.json({
        message: 'eSIM profile suspended successfully',
        profile,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
```

Create webhook handling at `routes/webhooks.js`:

```javascript
const express = require('express');

module.exports = () => {
  const router = express.Router();

  /**
   * POST /webhooks/esim
   * Handle eSIM status change webhooks from Telnyx.
   */
  router.post('/esim', (req, res) => {
    const event = req.body;

    console.log('Webhook received:', {
      type: event.type,
      simCardId: event.data?.id,
      status: event.data?.status,
      timestamp: new Date().toISOString(),
    });

    // Handle different webhook event types
    if (event.type === 'sim_card.status.changed') {
      const { id, status } = event.data;
      console.log(`SIM Card ${id} status changed to: ${status}`);

      // Implement your business logic here:
      // - Update device database
      // - Notify device management system
      // - Trigger provisioning workflows
    }

    if (event.type === 'sim_card.data_limit.reached') {
      const { id } = event.data;
      console.log(`SIM Card ${id} has reached its data limit`);

      // Implement your business logic:
      // - Alert user
      // - Suspend service
      // - Trigger upgrade workflow
    }

    if (event.type === 'sim_card.network.attached') {
      const { id } = event.data;
      console.log(`Device with SIM Card ${id} attached to network`);

      // Implement your business logic:
      // - Update device status
      // - Log connection event
      // - Trigger device initialization
    }

    // Always respond with 200 to acknowledge receipt
    res.status(200).json({ received: true });
  });

  return router;
};
```

Update `app.js` to include the routes:

```javascript
const express = require('express');
const Telnyx = require('telnyx');
const config = require('./config');
const esimRoutes = require('./routes/esim');
const webhookRoutes = require('./routes/webhooks');

const app = express();

// Middleware
app.use(express.json());

// Initialize Telnyx client
const client = new Telnyx({ apiKey: config.apiKey });

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount routes
app.use('/esim', esimRoutes(client));
app.use('/webhooks', webhookRoutes());

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.message);

  if (err instanceof Telnyx.AuthenticationError) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  if (err instanceof Telnyx.RateLimitError) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please slow down.' });
  }
  if (err instanceof Telnyx.APIError) {
    return res.status(err.status_code || 500).json({
      error: err.message,
      status_code: err.status_code,
    });
  }
  if (err instanceof Telnyx.APIConnectionError) {
    return res.status(503).json({ error: 'Network error connecting to Telnyx' });
  }

  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(config.port, () => {
  console.log(`eSIM Provisioning server running on port ${config.port}`);
});

module.exports = { app, client };
```

## Complete Code

See [`server.js`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/provision-esim-nodejs/server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Node.js server after updating the `.env` file. The `dotenv` module only reads environment variables at startup. |
| SIM Card Group Not Found | API returns a 404 error when provisioning with an invalid `simCardGroupId`. | Confirm the SIM Card Group ID exists in your Telnyx account. Navigate to the [Telnyx Portal](https://portal.telnyx.com) → IoT → SIM Card Groups to view available groups. Copy the exact ID and ensure it's passed in the request body without extra whitespace. |
| Webhook Not Receiving Events | Webhook endpoint is configured but not receiving status change notifications from Telnyx. | Ensure the `WEBHOOK_URL` in your `.env` file is publicly accessible (not localhost). Use ngrok (`ngrok http 3000`) to expose your local server during development. Configure the webhook URL in the Telnyx Portal under IoT settings. Verify your server is running and responding with HTTP 200 to webhook POST requests. Check server logs for incoming webhook requests. |
| Rate Limit Exceeded (429) | Requests fail with `{"error": "Rate limit exceeded. Please slow down."}` and HTTP 429. | Implement exponential backoff retry logic in your client code. Space out API calls by at least 100ms. For bulk operations, use SIM Card Group actions instead of individual SIM card API calls. Contact Telnyx support if you need higher rate limits for your use case. |
| Async Provisioning Timeout | eSIM profile creation succeeds but activation fails immediately after. | eSIM provisioning is asynchronous. Add a 2-5 second delay between creation and activation. Monitor webhook events (`sim_card.status.changed`) to detect when profiles are ready for activation. Implement a polling mechanism with exponential backoff if webhooks are unavailable. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this IoT example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

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

- [Monitor SIM Card Data Usage](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/nodejs/data-usage-monitoring).
- [Activate SIM Cards in Bulk](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/nodejs/sim-activation).
- [Handle SIM Status Change Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/nodejs/sim-status-webhook).
