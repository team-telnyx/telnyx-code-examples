#!/usr/bin/env node
/**
 * Production-ready Express endpoint for number lookup via Telnyx.
 * Usage: node app.js
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

// Validate required environment variables
if (!config.apiKey) {
  console.error('Error: TELNYX_API_KEY environment variable is not set.');
  process.exit(1);
}

// Initialize client with the new SDK pattern
const client = new Telnyx({ apiKey: config.apiKey });

/**
 * Perform a number lookup and return carrier/line type information.
 * @param {string} phoneNumber - Phone number in E.164 format (e.g., +15551234567)
 * @returns {Promise<Object>} Lookup result with carrier and line type details
 */
async function lookupNumber(phoneNumber) {
  // Validate E.164 format to prevent API errors
  if (!phoneNumber.startsWith('+')) {
    throw new Error('Phone number must be in E.164 format (e.g., +15551234567)');
  }

  // Use client.numberLookup.retrieve() to fetch carrier and line type information
  const response = await client.numberLookup.retrieve(phoneNumber);

  // Extract serializable data — SDK objects are NOT JSON-serializable
  return {
    phone_number: response.data.phone_number,
    carrier_name: response.data.carrier_name || 'Unknown',
    line_type: response.data.line_type || 'Unknown',
    country_code: response.data.country_code || 'Unknown',
    number_type: response.data.number_type || 'Unknown',
    portability_status: response.data.portability_status || 'Unknown',
  };
}

/**
 * POST /lookup
 * Perform a number lookup and return carrier/line type information.
 * Request body: { "phone_number": "+15551234567" }
 */
app.post('/lookup', async (req, res) => {
  const { phone_number } = req.body;

  // Validate request payload
  if (!phone_number) {
    return res.status(400).json({
      error: 'Missing required field: phone_number',
    });
  }

  try {
    const result = await lookupNumber(phone_number);
    return res.status(200).json(result);
  } catch (error) {
    // Handle Telnyx-specific errors
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({
        error: 'Rate limit exceeded. Please slow down.',
      });
    }
    if (error instanceof Telnyx.APIError) {
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
    // Handle validation errors
    if (error.message.includes('E.164 format')) {
      return res.status(400).json({ error: error.message });
    }
    // Generic error fallback
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * GET /health
 * Health check endpoint for monitoring.
 */
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Start the server
app.listen(config.port, () => {
  console.log(`Number Lookup service running on port ${config.port}`);
});
