#!/usr/bin/env node
/**
 * Production-ready Express endpoint for creating AI assistants via Telnyx.
 */

require('dotenv').config();
const Telnyx = require('telnyx');
const express = require('express');

const app = express();
app.use(express.json());

// Initialize client with the SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

/**
 * Create an AI assistant and return JSON-serializable response data.
 * @param {string} name - Display name for the assistant.
 * @param {string} instructions - System prompt / persona for the assistant.
 * @param {string} model - LLM model ID (e.g., "meta-llama/Meta-Llama-3.1-70B-Instruct").
 * @param {array} enabledFeatures - Array of enabled features ("telephony" and/or "messaging").
 * @returns {object} Serializable assistant data.
 */
async function createAssistant(name, instructions, model, enabledFeatures) {
  // Validate required fields to prevent API errors
  if (!name || !instructions || !model) {
    throw new Error('Missing required fields: name, instructions, and model');
  }

  if (!Array.isArray(enabledFeatures) || enabledFeatures.length === 0) {
    throw new Error('enabledFeatures must be a non-empty array');
  }

  // Use client.ai_assistants.create() to create a new assistant
  const response = await client.ai_assistants.create({
    name: name,
    instructions: instructions,
    model: model,
    enabled_features: enabledFeatures,
  });

  // Extract serializable data — SDK objects are NOT JSON-serializable
  return {
    id: response.data.id,
    name: response.data.name,
    model: response.data.model,
    instructions: response.data.instructions,
    enabled_features: response.data.enabled_features,
    created_at: response.data.created_at,
  };
}

/**
 * POST /assistants/create
 * Create a new AI assistant.
 */
app.post('/assistants/create', async (req, res) => {
  const { name, instructions, model, enabled_features } = req.body;

  // Validate request body
  if (!name || !instructions || !model || !enabled_features) {
    return res.status(400).json({
      error: 'Missing required fields: name, instructions, model, and enabled_features',
    });
  }

  try {
    const result = await createAssistant(name, instructions, model, enabled_features);
    return res.status(201).json(result);
  } catch (error) {
    // Handle Telnyx-specific errors
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please slow down.' });
    }
    if (error instanceof Telnyx.APIStatusError) {
      return res.status(error.status_code || 400).json({
        error: error.message,
        status_code: error.status_code,
      });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({ error: 'Network error connecting to Telnyx' });
    }
    // Handle validation errors
    if (error.message.includes('Missing required fields') || error.message.includes('enabledFeatures')) {
      return res.status(400).json({ error: error.message });
    }
    // Generic error handler
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /health
 * Health check endpoint.
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
