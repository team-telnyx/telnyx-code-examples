// app.js
const express = require('express');
const Telnyx = require('telnyx');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Initialize Telnyx client
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

// ============================================================================
// ESIMManager Class
// ============================================================================

class ESIMManager {
  constructor(client) {
    this.client = client;
  }

  async createESIMProfile(simCardGroupId, deviceInfo) {
    if (!simCardGroupId) {
      throw new Error('simCardGroupId is required');
    }

    const response = await this.client.sim_cards.create({
      sim_card_group_id: simCardGroupId,
      tags: {
        device_name: deviceInfo.name || 'unknown',
        imei: deviceInfo.imei || 'unknown',
        provisioned_at: new Date().toISOString(),
      },
    });

    return {
      id: response.data.id,
      iccid: response.data.iccid,
      status: response.data.status,
      sim_card_group_id: response.data.sim_card_group_id,
      tags: response.data.tags,
    };
  }

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

// ============================================================================
// Routes
// ============================================================================

const esimManager = new ESIMManager(client);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Provision eSIM
app.post('/esim/provision', async (req, res, next) => {
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

// Activate eSIM
app.post('/esim/:simCardId/activate', async (req, res, next) => {
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

// Get eSIM profile
app.get('/esim/:simCardId', async (req, res, next) => {
  try {
    const { simCardId } = req.params;

    const profile = await esimManager.getESIMProfile(simCardId);

    res.json(profile);
  } catch (error) {
    next(error);
  }
});

// List eSIM profiles in group
app.get('/esim/group/:simCardGroupId', async (req, res, next) => {
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

// Suspend eSIM
app.post('/esim/:simCardId/suspend', async (req, res, next) => {
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

// Webhook handler
app.post('/webhooks/esim', (req, res) => {
  const event = req.body;

  console.log('Webhook received:', {
    type: event.type,
    simCardId: event.data?.id,
    status: event.data?.status,
    timestamp: new Date().toISOString(),
  });

  if (event.type === 'sim_card.status.changed') {
    const { id, status } = event.data;
    console.log(`SIM Card ${id} status changed to: ${status}`);
  }

  if (event.type === 'sim_card.data_limit.reached') {
    const { id } = event.data;
    console.log(`SIM Card ${id} has reached its data limit`);
  }

  if (event.type === 'sim_card.network.attached') {
    const { id } = event.data;
    console.log(`Device with SIM Card ${id} attached to network`);
  }

  res.status(200).json({ received: true });
});

// ============================================================================
// Error Handling Middleware
// ============================================================================

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

// ============================================================================
// Server Startup
// ============================================================================

app.listen(PORT, () => {
  console.log(`eSIM Provisioning server running on port ${PORT}`);
  console.log(`Webhook URL: ${process.env.WEBHOOK_URL || 'Not configured'}`);
});

module.exports = { app, client };
