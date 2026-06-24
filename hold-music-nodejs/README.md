# Hold Music with Node.js and Express

## What Does This Example Do?

Build a production-ready Express application that places callers on hold with custom music using the Telnyx Voice API. This tutorial demonstrates the command-event model for call control, webhook handling for real-time call events, and proper audio streaming integration. You'll learn to initiate calls, detect when they're answered, and play hold music while managing the call lifecycle.

## Who Is This For?

- **Node.js developers** building voice features with Express.
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

- Node.js 16 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for outbound calls.
- A Call Control Application configured in the Telnyx Portal with a webhook URL.
- A publicly accessible URL for receiving webhooks (use ngrok for local development).
- npm (Node.js package manager).
- An audio file (MP3 or WAV) hosted at a publicly accessible URL for hold music.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/hold-music-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` and initialize the Telnyx client using the new pattern. Define helper functions to manage call control and hold music:

```javascript
const express = require("express");
const bodyParser = require("body-parser");
const Telnyx = require("telnyx");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Initialize client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

// In-memory store for active calls (use a database in production)
const activeCalls = new Map();

/**
 * Initiate an outbound call and place caller on hold.
 * Returns call_control_id for subsequent control actions.
 */
async function initiateCallWithHold(toNumber) {
  const fromNumber = process.env.TELNYX_PHONE_NUMBER;
  const connectionId = process.env.TELNYX_CONNECTION_ID;

  if (!fromNumber || !connectionId) {
    throw new Error(
      "TELNYX_PHONE_NUMBER and TELNYX_CONNECTION_ID environment variables required"
    );
  }

  // Validate E.164 format to prevent API errors
  if (!toNumber.startsWith("+")) {
    throw new Error(
      "Phone number must be in E.164 format (e.g., +15551234567)"
    );
  }

  // Initiate the call — connection_id is REQUIRED, call_control_id is RETURNED
  const response = await client.calls.dial({
    from: fromNumber,
    to: toNumber,
    connection_id: connectionId,
  });

  // Extract call_control_id from response — use for subsequent actions
  const callControlId = response.data.call_control_id;

  // Store call metadata for webhook processing
  activeCalls.set(callControlId, {
    callControlId,
    toNumber,
    fromNumber,
    status: "initiated",
    createdAt: new Date(),
  });

  return {
    call_control_id: callControlId,
    to: toNumber,
    from: fromNumber,
    status: "initiated",
  };
}

/**
 * Play hold music on an active call.
 * Requires call_control_id from the initiated call.
 */
async function playHoldMusic(callControlId) {
  const holdMusicUrl = process.env.HOLD_MUSIC_URL;

  if (!holdMusicUrl) {
    throw new Error("HOLD_MUSIC_URL environment variable not set");
  }

  // Use speak action to play audio file via TTS or direct audio URL
  const response = await client.calls.actions.speak(callControlId, {
    payload: holdMusicUrl,
    language: "en-US",
    voice: "male",
  });

  return {
    call_control_id: callControlId,
    action: "speak",
    status: "playing",
  };
}

/**
 * Hangup an active call and clean up resources.
 */
async function hangupCall(callControlId) {
  const response = await client.calls.actions.hangup(callControlId);

  // Remove from active calls store
  activeCalls.delete(callControlId);

  return {
    call_control_id: callControlId,
    action: "hangup",
    status: "ended",
  };
}

module.exports = { initiateCallWithHold, playHoldMusic, hangupCall };
```

## Complete Code

See [`server.js`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/hold-music-nodejs/server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Express server. |
| Connection ID Not Found | You receive an error stating "TELNYX_CONNECTION_ID environment variable required" or a 422 error from the API. | Confirm your `.env` file contains `TELNYX_CONNECTION_ID` set to your Call Control Application ID from the Telnyx Portal. This is a static value, not a call-specific ID. Verify the Connection ID is active and linked to your phone number. |
| Webhook Not Receiving Events | Call is initiated but no webhook events arrive, or hold music doesn't play. | Ensure your webhook URL in the Telnyx Portal matches the `WEBHOOK_URL` in your `.env` file. Use ngrok to expose your local Express server: `ngrok http 3000`, then set `WEBHOOK_URL=https://your-ngrok-url.ngrok.io/webhooks/call`. Verify the webhook endpoint is publicly accessible and returns HTTP 200. Check Express server logs for incoming POST requests. |
| Hold Music Not Playing | Call connects but no audio is heard. | Verify `HOLD_MUSIC_URL` points to a publicly accessible audio file (MP3 or WAV). Test the URL in a browser to confirm it's reachable. Ensure the audio file is in a supported format. Check that the `playHoldMusic()` function is called after the `call.answered` event is received. Review Telnyx logs in the Portal for speak action errors. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this Voice example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What Node.js version do I need?**

Node.js 18 or higher. Node.js 20 LTS is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Voice API Overview](https://developers.telnyx.com/docs/voice)
- [Voice API Commands](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-commands-and-resources)
- [AI Assistant Start](https://developers.telnyx.com/docs/voice/programmable-voice/ai-assistant-start)
- [Call Control API Reference](https://developers.telnyx.com/api-reference/call-commands/dial)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx Voice API](https://telnyx.com/products/voice-api)
- [Voice AI Agents](https://telnyx.com/products/voice-ai-agents)

## Related Examples

- [Handle Inbound Calls with Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/nodejs/inbound-call-webhook).
- [Record Calls](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/nodejs/call-recording).
- [Transfer Calls Between Numbers](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/nodejs/call-transfer).
