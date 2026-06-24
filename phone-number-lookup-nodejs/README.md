# Number Lookup with Node.js and Express

## What Does This Example Do?

Build a production-ready Express endpoint that performs number lookups using the Telnyx SMS API. This tutorial demonstrates how to retrieve detailed information about phone numbers, including carrier details, line type, and number portability status. You'll learn the new client-based initialization pattern, proper error handling for telecom APIs, and secure credential management via environment variables.

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
- A publicly accessible URL for webhook testing (optional, for advanced use cases).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/phone-number-lookup-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` and initialize the Telnyx client using the new pattern. Define a helper function to handle number lookups with proper validation:

```javascript
const express = require('express');
const Telnyx = require('telnyx');
const config = require('./config');

const app = express();
app.use(express.json());

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

module.exports = { app, client, lookupNumber };
```

## Complete Code

See [`server.js`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/phone-number-lookup-nodejs/server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Express server. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Environment Variable Not Set | The application exits with `Error: TELNYX_API_KEY environment variable is not set.` | Confirm your `.env` file exists in the same directory as `app.js` and contains the variable. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `require('dotenv').config()` call must execute before `process.env` is accessed—verify this import order at the top of your code. |
| Number Lookup Returns "Unknown" Fields | The response contains `"carrier_name": "Unknown"` or other fields are missing. | This typically occurs when the number is not recognized by the carrier database or is from a region with limited data. Verify the phone number is valid and active. Try testing with a different phone number from a major carrier. Check the [Telnyx documentation](https://developers.telnyx.com) for supported regions and data availability. |
| Rate Limit Error (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | You are making too many requests in a short time. Implement exponential backoff in your client code: wait 1 second, then 2 seconds, then 4 seconds between retries. For production, use a queue system (Bull, RabbitMQ) to throttle lookups. Check your Telnyx plan for rate limits. |

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

- [Send a Single SMS with Node.js](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/nodejs/send-single-sms).
- [Receive SMS Webhooks with Node.js](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/nodejs/receive-sms-webhook).
- [Send Bulk SMS Messages with Node.js](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/nodejs/send-bulk-sms).
