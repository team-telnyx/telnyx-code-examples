#!/usr/bin/env node
/**
 * Production-ready Express server for SIM card activation via Telnyx.
 * 
 * Usage:
 *   1. Set TELNYX_API_KEY in .env
 *   2. npm install
 *   3. node app.js
 *   4. curl -X POST http://localhost:3000/sim/{sim_id}/activate
 */

require('dotenv').config();
const express = require('express');
const Telnyx = require('telnyx');

const app = express();
app.use(express.json());

// Configuration
const config = {
  apiKey: process.env.TELNYX_API_KEY,
  port: process.env.PORT || 3000,
};

// Initialize Telnyx client
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

/**
 * Error handler for Telnyx SDK exceptions.
 * Maps SDK errors to appropriate HTTP status codes.
 */
function handleError(error, res) {
  if (error instanceof Telnyx.AuthenticationError) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  if (error instanceof Telnyx.RateLimitError) {
    return res.status(429).json({
      error: 'Rate limit exceeded. Please slow down.',
    });
  }

  if (error instanceof Telnyx.APIStatusError) {
    return res.status(error.status_code || 500).json({
      error: error.message,
      status_code: error.status_code,
    });
  }

  if (error instanceof Telnyx.APIConnectionError) {
    return res.status(503).json({
      error: 'Network error connecting to Telnyx',
    });
  }

  if (error.message.includes('SIM card ID')) {
    return res.status(400).json({ error: error.message });
  }

  res.status(500).json({
    error: 'Internal server error',
    message: error.message,
  });
}

/**
 * GET /sim/:id
 * Retrieve details for a specific SIM card.
 */
app.get('/sim/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const simCard = await getSimCard(id);
    res.json(simCard);
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * POST /sim/:id/activate
 * Activate a SIM card by ID.
 */
app.post('/sim/:id/activate', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await activateSimCard(id);
    res.status(200).json({
      message: 'SIM card activated successfully',
      sim: result,
    });
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * Health check endpoint.
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Start the server
app.listen(config.port, () => {
  console.log(`SIM activation server running on port ${config.port}`);
  console.log(`GET  http://localhost:${config.port}/sim/{sim_id}`);
  console.log(`POST http://localhost:${config.port}/sim/{sim_id}/activate`);
});
