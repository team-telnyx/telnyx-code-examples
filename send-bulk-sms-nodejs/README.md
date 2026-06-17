# Send Bulk SMS with Node.js and Express

## What Does This Example Do?

Build a production-ready Express endpoint that sends bulk SMS messages using the Telnyx Node.js SDK. This tutorial demonstrates rate-limited batch processing, proper error handling for telecom APIs, and secure credential management via environment variables. You'll learn how to send hundreds of messages efficiently while respecting API rate limits and handling failures gracefully.

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
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for outbound SMS.
- npm (Node.js package manager).
- Postman or curl for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-bulk-sms-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-bulk-sms-nodejs
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` and initialize the Telnyx client using the new pattern. Define helper functions to handle batch message creation with rate limiting and proper validation:

```javascript
const Telnyx = require("telnyx");
const express = require("express");
require("dotenv").config();

const app = express();
app.use(express.json());

// Initialize client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

/**
 * Sleep utility for rate limiting between API calls.
 * @param {number} ms - Milliseconds to sleep.
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send a single SMS message via Telnyx.
 * @param {string} toNumber - Recipient phone number in E.164 format.
 * @param {string} message - Message text.
 * @returns {Promise<Object>} JSON-serializable response data.
 */
async function sendSingleSMS(toNumber, message) {
  const fromNumber = process.env.TELNYX_PHONE_NUMBER;
  if (!fromNumber) {
    throw new Error("TELNYX_PHONE_NUMBER environment variable not set");
  }

  // Validate E.164 format to prevent API errors
  if (!toNumber.startsWith("+")) {
    throw new Error(
      "Phone number must be in E.164 format (e.g., +15551234567)"
    );
  }

  // Use client.messages.create() with the new SDK pattern
  const response = await client.messages.create({
    from_: fromNumber,
    to: toNumber,
    text: message,
  });

  // Extract serializable data — SDK objects are NOT JSON-serializable
  return {
    message_id: response.data.id,
    status: response.data.to && response.data.to[0] ? response.data.to[0].status : "unknown",
    from: fromNumber,
    to: toNumber,
  };
}

/**
 * Send bulk SMS with rate limiting and error tracking.
 * @param {Array<Object>} recipients - Array of {to: string, message: string}.
 * @param {number} delayMs - Delay between API calls in milliseconds.
 * @returns {Promise<Object>} Summary with successful and failed sends.
 */
async function sendBulkSMS(recipients, delayMs = 100) {
  const results = {
    successful: [],
    failed: [],
    total: recipients.length,
  };

  for (let i = 0; i < recipients.length; i++) {
    const { to, message } = recipients[i];

    try {
      const result = await sendSingleSMS(to, message);
      results.successful.push(result);
    } catch (error) {
      results.failed.push({
        to,
        error: error.message,
        index: i,
      });
    }

    // Rate limiting: sleep between requests (except after the last one)
    if (i < recipients.length - 1) {
      await sleep(delayMs);
    }
  }

  return results;
}
```

## Complete Code

See [`server.js`](./server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Express server. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429 after sending many messages. | Increase the `RATE_LIMIT_DELAY_MS` value in your `.env` file (try 200–500ms). This adds a delay between API calls to respect Telnyx rate limits. Restart the server after updating the environment variable. |
| Environment Variable Not Set | The application raises an error about `TELNYX_PHONE_NUMBER` or `TELNYX_API_KEY` not being set. | Confirm your `.env` file exists in the same directory as `app.js` and contains all required variables. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `require("dotenv").config()` call must execute before `process.env` is accessed—verify this import order in your code. |
| Partial Bulk Send Failures | Some messages in a bulk request succeed while others fail, and you need to retry only the failed ones. | The response includes a `failed` array with the index and error message for each failed recipient. Implement retry logic by extracting the failed recipients and re-submitting them in a separate request with a longer delay. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

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

- [Receive SMS Webhooks with Node.js](/tutorials/sms/nodejs/receive-sms-webhook).
- [Implement Two-Factor Authentication with SMS](/tutorials/sms/nodejs/otp-2fa).
- [Send Single SMS with Node.js](/tutorials/sms/nodejs/send-single-sms).
