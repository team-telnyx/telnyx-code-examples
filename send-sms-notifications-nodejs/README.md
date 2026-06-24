# SMS Notifications with Node.js and Express

## What Does This Example Do?

Build a production-ready Express application that sends SMS notifications to users using the Telnyx Node.js SDK. This tutorial demonstrates how to set up notification endpoints, handle multiple recipients, implement retry logic, and manage delivery status tracking. You'll learn the new client-based initialization pattern, proper error handling for telecom APIs, and secure credential management via environment variables.

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

- Node.js 14 or higher and npm.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for outbound SMS.
- A code editor (VS Code, Sublime Text, or similar).
- curl or Postman for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-sms-notifications-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create helper functions to handle SMS notification logic. Add this to your `app.js` file:

```javascript
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
```

Now add Express routes to handle notification requests. Add this to your `app.js` file after the helper functions:

```javascript
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
```

## Complete Code

See [`server.js`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-notifications-nodejs/server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Express server with `npm run dev`. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your curl commands and request payloads to use properly formatted numbers. |
| Environment Variable Not Set | The application raises an error about `TELNYX_PHONE_NUMBER` or `TELNYX_API_KEY` not being set. | Confirm your `.env` file exists in the same directory as `app.js` and contains both variables. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `require('dotenv').config()` call must execute at the top of `app.js` before any other code. Restart the server after updating the `.env` file. |
| Rate Limit Exceeded (429) | Bulk notifications fail with `{"error": "Rate limit exceeded. Please slow down."}` and HTTP 429. | Increase the `delay_ms` parameter in your bulk notification request to add more time between API calls. Start with 200–500 ms between sends. The `sendBulkNotifications` function already implements per-recipient error handling, so individual failures won't stop the entire batch. |
| Network Error (503) | The endpoint returns `{"error": "Network error connecting to Telnyx"}` with HTTP 503. | Check your internet connection and verify that the Telnyx API is accessible. Ensure your firewall or proxy is not blocking outbound HTTPS connections to `api.telnyx.com`. If the issue persists, check the [Telnyx Status Page](https://status.telnyx.com) for service incidents. |

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

- [Receive SMS Webhooks with Node.js](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/nodejs/receive-sms-webhook).
- [Send Bulk SMS Messages](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/nodejs/send-bulk-sms).
- [Implement Two-Factor Authentication with SMS](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/nodejs/otp-2fa).
