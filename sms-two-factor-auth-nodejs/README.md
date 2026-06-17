# OTP 2FA with Node.js and Express

## What Does This Example Do?

Build a production-ready two-factor authentication (2FA) system using one-time passwords (OTPs) delivered via SMS with the Telnyx Node.js SDK and Express. This tutorial demonstrates secure OTP generation, storage with expiration, verification workflows, and comprehensive error handling for a real-world authentication flow.

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
- npm (Node package manager).
- Postman or curl for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-two-factor-auth-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-two-factor-auth-nodejs
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` and implement the OTP 2FA system with helper functions for OTP generation, storage, and verification:

```javascript
const express = require("express");
const bodyParser = require("body-parser");
const Telnyx = require("telnyx");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Initialize Telnyx client with the SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

// In-memory OTP storage (use Redis or database in production)
const otpStore = new Map();

/**
 * Generate a random OTP of specified length.
 * @param {number} length - Number of digits in OTP.
 * @returns {string} Random OTP string.
 */
function generateOTP(length = 6) {
  return Math.floor(Math.pow(10, length - 1) + Math.random() * 9 * Math.pow(10, length - 1))
    .toString()
    .slice(0, length);
}

/**
 * Send OTP via SMS to the specified phone number.
 * @param {string} toNumber - Recipient phone number in E.164 format.
 * @param {string} otp - The OTP code to send.
 * @returns {Promise<object>} Response with message ID and status.
 */
async function sendOTPSMS(toNumber, otp) {
  const fromNumber = process.env.TELNYX_PHONE_NUMBER;
  if (!fromNumber) {
    throw new Error("TELNYX_PHONE_NUMBER environment variable not set");
  }

  // Validate E.164 format to prevent API errors
  if (!toNumber.startsWith("+")) {
    throw new Error("Phone number must be in E.164 format (e.g., +15551234567)");
  }

  const message = `Your verification code is: ${otp}. Do not share this code with anyone.`;

  const response = await client.messages.create({
    from_: fromNumber,
    to: toNumber,
    text: message,
  });

  // Extract serializable data — SDK objects are NOT JSON-serializable
  return {
    message_id: response.data.id,
    status: response.data.to && response.data.to[0] ? response.data.to[0].status : "pending",
    to: toNumber,
  };
}

/**
 * Store OTP with expiration timestamp.
 * @param {string} phoneNumber - Phone number to associate with OTP.
 * @param {string} otp - The OTP code.
 */
function storeOTP(phoneNumber, otp) {
  const expirySeconds = parseInt(process.env.OTP_EXPIRY_SECONDS || "300", 10);
  const expiresAt = Date.now() + expirySeconds * 1000;

  otpStore.set(phoneNumber, {
    otp,
    expiresAt,
    attempts: 0,
  });
}

/**
 * Verify OTP against stored value and expiration.
 * @param {string} phoneNumber - Phone number to verify.
 * @param {string} otp - OTP code provided by user.
 * @returns {object} Verification result with success flag and message.
 */
function verifyOTP(phoneNumber, otp) {
  const stored = otpStore.get(phoneNumber);

  if (!stored) {
    return { success: false, message: "No OTP found for this phone number" };
  }

  // Check expiration
  if (Date.now() > stored.expiresAt) {
    otpStore.delete(phoneNumber);
    return { success: false, message: "OTP has expired. Request a new one." };
  }

  // Prevent brute force: limit attempts
  if (stored.attempts >= 3) {
    otpStore.delete(phoneNumber);
    return { success: false, message: "Too many failed attempts. Request a new OTP." };
  }

  // Verify OTP
  if (stored.otp !== otp) {
    stored.attempts += 1;
    return { success: false, message: "Invalid OTP. Please try again." };
  }

  // Success: remove OTP from store
  otpStore.delete(phoneNumber);
  return { success: true, message: "OTP verified successfully" };
}

/**
 * POST /auth/request-otp
 * Request an OTP to be sent to the provided phone number.
 */
app.post("/auth/request-otp", async (req, res) => {
  const { phone_number } = req.body;

  if (!phone_number) {
    return res.status(400).json({ error: "Missing required field: 'phone_number'" });
  }

  try {
    // Generate and send OTP
    const otp = generateOTP(parseInt(process.env.OTP_LENGTH || "6", 10));
    const smsResult = await sendOTPSMS(phone_number, otp);

    // Store OTP for verification
    storeOTP(phone_number, otp);

    return res.status(200).json({
      message: "OTP sent successfully",
      message_id: smsResult.message_id,
      expires_in_seconds: parseInt(process.env.OTP_EXPIRY_SECONDS || "300", 10),
    });
  } catch (error) {
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({ error: "Rate limit exceeded. Please slow down." });
    }
    if (error instanceof Telnyx.APIStatusError) {
      return res.status(error.status_code || 500).json({ error: error.message });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({ error: "Network error connecting to Telnyx" });
    }
    // Handle validation errors
    if (error.message.includes("E.164 format")) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /auth/verify-otp
 * Verify the OTP provided by the user.
 */
app.post("/auth/verify-otp", (req, res) => {
  const { phone_number, otp } = req.body;

  if (!phone_number || !otp) {
    return res.status(400).json({ error: "Missing required fields: 'phone_number' and 'otp'" });
  }

  try {
    const result = verifyOTP(phone_number, otp);

    if (result.success) {
      return res.status(200).json({
        message: result.message,
        authenticated: true,
        // In production, issue a session token or JWT here
        session_token: `session_${Date.now()}`,
      });
    }

    return res.status(401).json({
      message: result.message,
      authenticated: false,
    });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /health
 * Health check endpoint.
 */
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Error handler middleware
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`OTP 2FA server running on http://localhost:${PORT}`);
});
```

## Complete Code

See [`server.js`](./server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Express server with `npm run dev`. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| OTP Expired Before Verification | The verification endpoint returns `{"message": "OTP has expired. Request a new one."}` even though the OTP was just sent. | Check the `OTP_EXPIRY_SECONDS` value in your `.env` file. The default is 300 seconds (5 minutes). If you need more time for testing, increase this value. Remember that in production, shorter expiry times (3–5 minutes) are more secure. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | Telnyx enforces rate limits on API calls. Space out your OTP requests by at least 1 second between calls. In production, implement exponential backoff and queue requests if sending OTPs to many users simultaneously. |
| OTP Not Received | The SMS with the OTP code does not arrive on the phone. | Verify that your `TELNYX_PHONE_NUMBER` in the `.env` file is correct and enabled for outbound SMS in the [Telnyx Portal](https://portal.telnyx.com). Check that the recipient phone number is in E.164 format and is a valid, active number. Confirm your Telnyx account has sufficient credits or an active payment method. |

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

- [Send Bulk SMS Messages](/tutorials/sms/nodejs/send-bulk-sms).
- [Receive SMS Webhooks with Node.js](/tutorials/sms/nodejs/receive-sms-webhook).
- [Build Two-Way SMS Conversations](/tutorials/sms/nodejs/two-way-sms).
