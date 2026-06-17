require('dotenv').config();
const express = require('express');
const Telnyx = require('telnyx');

const config = {
  apiKey: process.env.TELNYX_API_KEY,
  port: process.env.PORT || 3000,
  pollingInterval: parseInt(process.env.POLLING_INTERVAL, 10) || 300000,
  dataLimitThreshold: 0.8,
};

const app = express();
app.use(express.json());

// Initialize client with the new SDK pattern
const client = new Telnyx({ apiKey: config.apiKey });

// In-memory cache for SIM card data usage
const simDataCache = new Map();

/**
 * Fetch data usage for a specific SIM card.
 */
async function getSimDataUsage(simCardId) {
  try {
    const simResponse = await client.simCards.retrieve(simCardId);
    const sim = simResponse.data;

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
pollDataUsage();

// Routes
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

app.use('/api', router);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(config.port, () => {
  console.log(`Data usage monitoring server running on port ${config.port}`);
  console.log(`Polling interval: ${config.pollingInterval}ms`);
});
