#!/usr/bin/env node
/**
 * Production-ready Express application for scheduling SMS via Telnyx.
 * Demonstrates job scheduling, error handling, and REST API design.
 */

require('dotenv').config();
const express = require('express');
const schedule = require('node-schedule');
const Telnyx = require('telnyx');

// Configuration
const config = {
  apiKey: process.env.TELNYX_API_KEY,
  phoneNumber: process.env.TELNYX_PHONE_NUMBER,
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
};

// Validate required environment variables
if (!config.apiKey) {
  throw new Error('TELNYX_API_KEY environment variable is required');
}
if (!config.phoneNumber) {
  throw new Error('TELNYX_PHONE_NUMBER environment variable is required');
}

const app = express();
app.use(express.json());

// Initialize Telnyx client
const client = new Telnyx({ apiKey: config.apiKey });

// In-memory store for scheduled jobs (use a database in production)
const scheduledJobs = new Map();

/**
 * Send SMS via Telnyx and return JSON-serializable response data.
 */
async function sendSms(toNumber, message) {
  if (!toNumber.startsWith('+')) {
    throw new Error('Phone number must be in E.164 format (e.g., +15551234567)');
  }

  const response = await client.messages.send({
    from: config.phoneNumber,
    to: toNumber,
    text: message,
  });

  return {
    message_id: response.data.id,
    status: response.data.to && response.data.to.length > 0 
      ? response.data.to[0].status 
      : 'unknown',
    from: config.phoneNumber,
    to: toNumber,
    created_at: response.data.created_at,
  };
}

/**
 * Schedule an SMS to be sent at a specific time.
 */
function scheduleMessage(jobId, sendTime, toNumber, message) {
  if (scheduledJobs.has(jobId)) {
    scheduledJobs.get(jobId).cancel();
  }

  const job = schedule.scheduleJob(sendTime, async () => {
    try {
      console.log(`[${new Date().toISOString()}] Sending scheduled SMS: ${jobId}`);
      await sendSms(toNumber, message);
      console.log(`[${new Date().toISOString()}] SMS sent successfully: ${jobId}`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Failed to send SMS ${jobId}:`, error.message);
    }
  });

  scheduledJobs.set(jobId, {
    job,
    toNumber,
    message,
    scheduledTime: sendTime,
    createdAt: new Date(),
  });

  return {
    job_id: jobId,
    scheduled_time: sendTime.toISOString(),
    to: toNumber,
    status: 'scheduled',
  };
}

/**
 * POST /sms/schedule - Schedule an SMS to be sent at a specific time.
 */
app.post('/sms/schedule', (req, res) => {
  const { to, message, send_at } = req.body;

  if (!to || !message || !send_at) {
    return res.status(400).json({
      error: 'Missing required fields: "to", "message", and "send_at"',
    });
  }

  const sendTime = new Date(send_at);
  if (isNaN(sendTime.getTime())) {
    return res.status(400).json({
      error: 'Invalid "send_at" format. Use ISO 8601 format (e.g., 2026-06-24T14:30:00Z)',
    });
  }

  if (sendTime <= new Date()) {
    return res.status(400).json({
      error: 'Scheduled time must be in the future',
    });
  }

  try {
    const jobId = `sms_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const result = scheduleMessage(jobId, sendTime, to, message);
    return res.status(201).json(result);
  } catch (error) {
    console.error('Error scheduling message:', error.message);
    return res.status(500).json({ error: 'Failed to schedule message' });
  }
});

/**
 * GET /sms/scheduled - List all scheduled messages.
 */
app.get('/sms/scheduled', (req, res) => {
  const scheduled = Array.from(scheduledJobs.entries()).map(([jobId, metadata]) => ({
    job_id: jobId,
    to: metadata.toNumber,
    message: metadata.message,
    scheduled_time: metadata.scheduledTime.toISOString(),
    created_at: metadata.createdAt.toISOString(),
  }));

  return res.json({ scheduled_messages: scheduled, count: scheduled.length });
});

/**
 * DELETE /sms/scheduled/:jobId - Cancel a scheduled message.
 */
app.delete('/sms/scheduled/:jobId', (req, res) => {
  const { jobId } = req.params;

  if (!scheduledJobs.has(jobId)) {
    return res.status(404).json({ error: 'Scheduled message not found' });
  }

  const metadata = scheduledJobs.get(jobId);
  metadata.job.cancel();
  scheduledJobs.delete(jobId);

  return res.json({
    message: 'Scheduled message cancelled',
    job_id: jobId,
  });
});

/**
 * POST /sms/send - Send an SMS immediately (for testing).
 */
app.post('/sms/send', async (req, res) => {
  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({
      error: 'Missing required fields: "to" and "message"',
    });
  }

  try {
    const result = await sendSms(to, message);
    return res.status(200).json(result);
  } catch (error) {
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
    if (error.message.includes('E.164')) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Failed to send SMS' });
  }
});

/**
 * GET /health - Health check endpoint.
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start the server
app.listen(config.port, () => {
  console.log(`Express server running on port ${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
});
