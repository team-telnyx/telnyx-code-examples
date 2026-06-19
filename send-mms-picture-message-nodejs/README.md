# MMS Send with Node.js and Express

## What Does This Example Do?

Build a production-ready Express endpoint that sends MMS messages with media attachments using the Telnyx Node.js SDK. This tutorial demonstrates the client-based initialization pattern, proper error handling for multimedia messaging, secure credential management via environment variables, and JSON serialization of SDK responses.

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
- A Telnyx phone number enabled for outbound MMS.
- npm (Node.js package manager).
- A publicly accessible URL or media file to attach (e.g., image, video, or document).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-mms-picture-message-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-mms-picture-message-nodejs
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` and initialize the Telnyx client using the new pattern. Define a helper function to handle MMS creation with proper validation:

```javascript
const Telnyx = require("telnyx");
const express = require("express");
require("dotenv").config();

const app = express();
app.use(express.json());

// Initialize client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

/**
 * Send MMS via Telnyx and return JSON-serializable response data.
 * @param {string} toNumber - Recipient phone number in E.164 format.
 * @param {string} message - Message text content.
 * @param {string[]} mediaUrls - Array of media URLs to attach.
 * @returns {Promise<Object>} JSON-serializable response data.
 */
async function sendMMS(toNumber, message, mediaUrls) {
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

  // Validate media URLs are provided
  if (!mediaUrls || mediaUrls.length === 0) {
    throw new Error("At least one media URL is required for MMS");
  }

  // Use client.messages.create() with media_urls parameter
  const response = await client.messages.create({
    from_: fromNumber,
    to: toNumber,
    text: message,
    media_urls: mediaUrls,
  });

  // Extract serializable data — SDK objects are NOT JSON-serializable
  return {
    message_id: response.data.id,
    status: response.data.to && response.data.to[0] ? response.data.to[0].status : "unknown",
    from: fromNumber,
    to: toNumber,
    media_count: mediaUrls.length,
  };
}
```

## Complete Code

See [`server.js`](./server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Express server. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Media URL Not Accessible | The API returns a 4xx error about invalid or unreachable media URLs. | Verify that each URL in the `media_urls` array is publicly accessible and returns a valid media file (JPEG, PNG, GIF, MP4, etc.). Test the URL in your browser to confirm it loads. Ensure the URL uses HTTPS where required and does not have authentication restrictions. |
| Missing media_urls Field | The endpoint returns `{"error": "Missing required fields: 'to', 'message', and 'media_urls'"}` with HTTP 400. | Confirm your POST request body includes all three required fields: `to` (recipient number), `message` (text content), and `media_urls` (array of URLs). The `media_urls` field must be an array, even if sending a single attachment: `"media_urls": ["https://example.com/image.jpg"]`. |
| Environment Variable Not Set | The application raises `Error: TELNYX_PHONE_NUMBER environment variable not set` on first request. | Confirm your `.env` file exists in the same directory as `app.js` and contains the variable. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `require("dotenv").config()` call must execute before `process.env` is accessed—verify this import order in your code. Restart the server after updating the `.env` file. |

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

- [Send a Single SMS with Node.js and Express](/tutorials/sms/nodejs/send-single-sms).
- [Receive SMS Webhooks with Node.js](/tutorials/sms/nodejs/receive-sms-webhook).
- [Send Bulk SMS Messages with Node.js](/tutorials/sms/nodejs/send-bulk-sms).
