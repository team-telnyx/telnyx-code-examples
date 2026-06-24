# Scheduled SMS with Node.js and Express

## What Does This Example Do?

Build a production-ready Express application that schedules SMS messages to be sent at specific times using the Telnyx Node.js SDK. This tutorial demonstrates job scheduling with Node.js, proper error handling for telecom APIs, secure credential management, and a REST API for managing scheduled messages.

## Who Is This For?

- **Node.js developers** building sms features with Express.
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
- A Telnyx phone number enabled for outbound SMS.
- Postman, curl, or similar tool for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/schedule-sms-messages-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` with the Express server, Telnyx client initialization, and scheduled message logic:

```javascript
const express = require('express');
const schedule = require('node-schedule');
const Telnyx = require('telnyx');
const config = require('./config');

const app = express();
app.use(express.json());

// Initialize Telnyx client with the new SDK pattern
const client = new Telnyx({ apiKey: config.apiKey });

// In-memory store for scheduled jobs (use a database in production)
const scheduledJobs = new Map();

/**
 * Send SMS via Telnyx and return JSON-serializable response data.
 * @param {string} toNumber - Recipient phone number in E.164 format.
 * @param {string} message - Message text to send.
 * @returns {Promise<Object>} Serializable response data.
 */
async function sendSms(toNumber, message) {
  // Validate E.164 format to prevent API errors
  if (!toNumber.startsWith('+')) {
    throw new Error('Phone number must be in E.164 format (e.g., +15551234567)');
  }

  // Use client.messages.send() to send the message
  const response = await client.messages.send({
    from: config.phoneNumber,
    to: toNumber,
    text: message,
  });

  // Extract serializable data — SDK objects are NOT JSON-serializable
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
 * @param {string} jobId - Unique identifier for the scheduled job.
 * @param {Date} sendTime - When to send the message.
 * @param {string} toNumber - Recipient phone number.
 * @param {string} message - Message text.
 * @returns {Object} Job metadata.
 */
function scheduleMessage(jobId, sendTime, toNumber, message) {
  // Cancel existing job if it exists
  if (scheduledJobs.has(jobId)) {
    scheduledJobs.get(jobId).cancel();
  }

  // Schedule the job using node-schedule
  const job = schedule.scheduleJob(sendTime, async () => {
    try {
      console.log(`[${new Date().toISOString()}] Sending scheduled SMS: ${jobId}`);
      await sendSms(toNumber, message);
      console.log(`[${new Date().toISOString()}] SMS sent successfully: ${jobId}`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Failed to send SMS ${jobId}:`, error.message);
    }
  });

  // Store job metadata
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

  // Validate required fields
  if (!to || !message || !send_at) {
    return res.status(400).json({
      error: 'Missing required fields: "to", "message", and "send_at"',
    });
  }

  // Validate send_at is a valid ISO 8601 datetime in the future
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
    // Generate unique job ID
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
    // Handle Telnyx SDK exceptions
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
    if (error.message.includes('E.164')) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Failed to send SMS' });
  }
});

/**
 * Health check endpoint.
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start the server
app.listen(config.port, () => {
  console.log(`Express server running on port ${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
});
```

## Complete Code

See [`server.js`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/schedule-sms-messages-nodejs/server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Express server. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Scheduled Time in the Past | The endpoint returns `{"error": "Scheduled time must be in the future"}` when scheduling a message. | Ensure the `send_at` parameter is set to a time in the future. Use ISO 8601 format (e.g., `2026-06-24T16:30:00Z`). Check that your system clock is synchronized correctly. When testing, schedule messages at least 1 minute in the future. |
| Jobs Not Executing | Scheduled messages are created but never sent at the scheduled time. | Verify the Express server is still running and has not crashed. Check the console logs for error messages during job execution. In production, use a persistent job queue (e.g., Bull, RabbitMQ) instead of in-memory storage, as jobs are lost if the server restarts. |
| Environment Variable Not Set | The application throws an error on startup: `TELNYX_API_KEY environment variable is required`. | Confirm your `.env` file exists in the same directory as `app.js` and contains the variable. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `require('dotenv').config()` call must execute before accessing `process.env`—verify this is at the top of your code. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What Node.js version do I need?**

Node.js 18 or higher. Node.js 20 LTS is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)

## Related Examples

- [Send a Single SMS with Node.js and Express](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/nodejs/send-single-sms).
- [Receive SMS Webhooks with Node.js and Express](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/nodejs/receive-sms-webhook).
- [Implement Two-Factor Authentication with SMS](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/nodejs/otp-2fa).
