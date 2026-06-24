#!/usr/bin/env node
/**
 * Production-ready Express application for SMS notifications via Telnyx.
 * Supports single and bulk notification sending with rate limiting and error handling.
 */

require('dotenv').config();
const express = require('express');
const Telnyx = require('telnyx');

const app = express();

// Initialize Telnyx client with API key from environment
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

// Middleware to parse JSON request bodies
app.use(express.json());

const PORT = process.env.PORT || 3000;

/**
 * Send a single SMS notification.
 * @param {string} toNumber - Recipient phone number in E.164 format.
 * @param {string} message - Message text to send.
 * @returns {Promise<Object>} JSON-serializable response data.
 * @throws {Error} Validation or API errors.
 */
async function sendNotification(toNumber, message) {
  const fromNumber = process.env.TELNYX_PHONE_NUMBER;
  
  if (!fromNumber) {
    throw new Error('TELNYX_PHONE_NUMBER environment variable not set');
  }
  
  // Validate E.164 format to prevent API errors
  if (!toNumber.startsWith('+')) {
    throw new Error('Phone number must be in E.164 format (e.g., +15551234567)');
  }
  
  if (message.length === 0) {
    throw new Error('Message cannot be empty');
  }
  
  // Create message via Telnyx API
  const response = await client.messages.send({
    from: fromNumber,
    to: toNumber,
    text: message,
  });
  
  // Extract serializable data — SDK objects are NOT JSON-serializable
  return {
    message_id: response.data.id,
    status: response.data.to && response.data.to.length > 0 
      ? response.data.to[0].status 
      : 'unknown',
    from: fromNumber,
    to: toNumber,
    created_at: response.data.created_at,
  };
}

/**
 * Send notifications to multiple recipients with rate limiting.
 * @param {Array<string>} recipients - Array of phone numbers in E.164 format.
 * @param {string} message - Message text to send.
 * @param {number} delayMs - Delay between sends in milliseconds (default: 100).
 * @returns {Promise<Object>} Summary of sent notifications.
 */
async function sendBulkNotifications(recipients, message, delayMs = 100) {
  const results = {
    total: recipients.length,
    sent: 0,
    failed: 0,
    messages: [],
  };
  
  for (const recipient of recipients) {
    try {
      const result = await sendNotification(recipient, message);
      results.sent += 1;
      results.messages.push({
        to: recipient,
        message_id: result.message_id,
        status: result.status,
      });
      
      // Rate limiting: delay between API calls
      if (recipients.indexOf(recipient) < recipients.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    } catch (error) {
      results.failed += 1;
      results.messages.push({
        to: recipient,
        error: error.message,
      });
    }
  }
  
  return results;
}

/**
 * POST /notifications/send
 * Send a single SMS notification.
 */
app.post('/notifications/send', async (req, res) => {
  const { to, message } = req.body;
  
  // Validate request body
  if (!to || !message) {
    return res.status(400).json({
      error: 'Missing required fields: "to" and "message"',
    });
  }
  
  try {
    const result = await sendNotification(to, message);
    return res.status(200).json(result);
  } catch (error) {
    // Handle Telnyx-specific errors
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please slow down.' });
    }
    if (error instanceof Telnyx.APIError) {
      return res.status(error.status_code || 500).json({
        error: error.message,
        status_code: error.status_code,
      });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({ error: 'Network error connecting to Telnyx' });
    }
    
    // Handle validation errors
    if (error.message.includes('E.164') || error.message.includes('environment')) {
      return res.status(400).json({ error: error.message });
    }
    
    // Generic error fallback
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /notifications/bulk
 * Send SMS notifications to multiple recipients.
 */
app.post('/notifications/bulk', async (req, res) => {
  const { recipients, message, delay_ms } = req.body;
  
  // Validate request body
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({
      error: 'Field "recipients" must be a non-empty array of phone numbers',
    });
  }
  
  if (!message) {
    return res.status(400).json({
      error: 'Missing required field: "message"',
    });
  }
  
  try {
    const result = await sendBulkNotifications(recipients, message, delay_ms || 100);
    return res.status(200).json(result);
  } catch (error) {
    // Handle Telnyx-specific errors
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please slow down.' });
    }
    if (error instanceof Telnyx.APIError) {
      return res.status(error.status_code || 500).json({
        error: error.message,
        status_code: error.status_code,
      });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({ error: 'Network error connecting to Telnyx' });
    }
    
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /health
 * Health check endpoint.
 */
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Start server if this is the main module
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`SMS Notifications server running on port ${PORT}`);
  });
}

module.exports = app;
