# Conference Call with Node.js and Express

## What Does This Example Do?

Build a production-ready Express application that creates and manages conference calls using the Telnyx Voice API. This tutorial demonstrates how to initiate outbound calls, add participants to a conference, handle webhook events, and manage call state in real time. You'll learn the command-event model that powers Telnyx Call Control, including proper error handling and secure credential management.

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
- A Call Control Application configured in the Telnyx Portal with its Connection ID.
- npm (Node package manager).
- A publicly accessible URL for webhook delivery (ngrok or similar for local development).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-conference-calling-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-conference-calling-nodejs
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` and initialize the Telnyx client using the new pattern. Define helper functions to manage conference participants and handle call state:

```javascript
const express = require("express");
const bodyParser = require("body-parser");
const Telnyx = require("telnyx");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Initialize Telnyx client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

// In-memory store for active conferences and calls
// In production, use a database like PostgreSQL or Redis
const conferences = new Map();

/**
 * Initiate an outbound call to a participant.
 * Returns the call_control_id for subsequent control actions.
 */
async function initiateCall(toNumber) {
  const fromNumber = process.env.TELNYX_PHONE_NUMBER;
  const connectionId = process.env.TELNYX_CONNECTION_ID;

  if (!fromNumber) {
    throw new Error("TELNYX_PHONE_NUMBER environment variable not set");
  }
  if (!connectionId) {
    throw new Error("TELNYX_CONNECTION_ID environment variable not set");
  }

  // Validate E.164 format to prevent API errors
  if (!toNumber.startsWith("+")) {
    throw new Error(
      "Phone number must be in E.164 format (e.g., +15551234567)"
    );
  }

  // Call the Telnyx API to initiate the call
  const response = await client.calls.dial({
    from_: fromNumber,
    to: toNumber,
    connection_id: connectionId,
  });

  // Extract and return the call_control_id for subsequent actions
  return {
    call_control_id: response.data.call_control_id,
    to: toNumber,
    from: fromNumber,
  };
}

/**
 * Create a new conference and store its metadata.
 */
function createConference(conferenceId, participants) {
  const conference = {
    id: conferenceId,
    participants: participants || [],
    created_at: new Date().toISOString(),
    status: "pending",
  };
  conferences.set(conferenceId, conference);
  return conference;
}

/**
 * Add a participant to an existing conference.
 */
function addParticipantToConference(conferenceId, callControlId, phoneNumber) {
  const conference = conferences.get(conferenceId);
  if (!conference) {
    throw new Error(`Conference ${conferenceId} not found`);
  }

  conference.participants.push({
    call_control_id: callControlId,
    phone_number: phoneNumber,
    joined_at: new Date().toISOString(),
    status: "pending",
  });

  return conference;
}

/**
 * Update participant status when webhook events arrive.
 */
function updateParticipantStatus(conferenceId, callControlId, status) {
  const conference = conferences.get(conferenceId);
  if (!conference) {
    return null;
  }

  const participant = conference.participants.find(
    (p) => p.call_control_id === callControlId
  );
  if (participant) {
    participant.status = status;
  }

  return conference;
}

module.exports = {
  initiateCall,
  createConference,
  addParticipantToConference,
  updateParticipantStatus,
  conferences,
};
```

## Complete Code

See [`server.js`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-conference-calling-nodejs/server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Express server. |
| Connection ID Not Found | The application raises `Error: TELNYX_CONNECTION_ID environment variable not set` on the first call creation. | Confirm your `.env` file contains the `TELNYX_CONNECTION_ID` variable with your Call Control Application ID from the Telnyx Portal. The Connection ID links your phone number to your Call Control application. Verify the ID is correct and restart the server. |
| Webhooks Not Received | Conference status remains "pending" and participant statuses never update to "answered" or "hangup". | Ensure your `WEBHOOK_URL` in the `.env` file is publicly accessible and matches the webhook URL configured in your Call Control Application settings in the Telnyx Portal. Use ngrok (`ngrok http 3000`) for local development and update the Portal with the ngrok URL. Verify your firewall allows inbound HTTPS traffic on port 443. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your request body to use properly formatted numbers. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | Telnyx enforces rate limits on API calls. Reduce the frequency of conference creation requests or implement exponential backoff retry logic. For production systems, queue conference requests and process them at a controlled rate. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this Voice example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

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

- [Initiate an Outbound Call](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/nodejs/outbound-call).
- [Handle Inbound Call Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/nodejs/inbound-call-webhook).
- [Record and Retrieve Call Recordings](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/nodejs/call-recording).
