# Voicemail with Node.js and Express

## What Does This Example Do?

Build a production-ready Express application that handles inbound calls, records voicemail messages, and stores them for later retrieval using the Telnyx Voice API. This tutorial demonstrates the command-event model of Call Control, webhook handling for call lifecycle events, and secure credential management via environment variables.

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

- Node.js 14 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for inbound calls.
- A Call Control Application configured in the Telnyx Portal with a webhook URL pointing to your server.
- npm (Node package manager).
- A publicly accessible URL for webhook callbacks (use ngrok for local development).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/voicemail-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` and initialize the Telnyx client using the new pattern. Define helper functions to handle call control actions with proper error handling:

```javascript
const express = require("express");
const bodyParser = require("body-parser");
const Telnyx = require("telnyx");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Initialize client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

// In-memory store for active calls and voicemail recordings
// In production, use a database like PostgreSQL or MongoDB
const callStore = new Map();
const voicemailStore = new Map();

/**
 * Answer an inbound call and start recording voicemail.
 * @param {string} callControlId - The call control ID from the webhook event.
 * @returns {Promise<object>} - Response data from the API.
 */
async function answerAndRecord(callControlId) {
  // Answer the call
  const answerResponse = await client.calls.actions.answer(callControlId);

  // Start recording the voicemail
  const recordResponse = await client.calls.actions.startRecording(
    callControlId,
    {
      format: "wav",
    }
  );

  return {
    answered: answerResponse.data,
    recording: recordResponse.data,
  };
}

/**
 * Hangup a call and clean up resources.
 * @param {string} callControlId - The call control ID.
 * @returns {Promise<object>} - Response data from the API.
 */
async function hangupCall(callControlId) {
  const response = await client.calls.actions.hangup(callControlId);
  callStore.delete(callControlId);
  return {"call_control_id": response.data.call_control_id};
}

/**
 * Retrieve voicemail recording details.
 * @param {string} recordingId - The recording ID.
 * @returns {Promise<object>} - Recording metadata.
 */
async function getRecordingDetails(recordingId) {
  // In production, fetch from your database or Telnyx recordings API
  return voicemailStore.get(recordingId) || null;
}
```

Add webhook handlers to process call lifecycle events:

```javascript
/**
 * Webhook endpoint for Telnyx call events.
 * Handles call.initiated, call.answered, call.hangup, and call.recording.saved events.
 */
app.post("/webhooks/call", async (req, res) => {
  const event = req.body.data;
  const eventType = req.body.type;

  console.log(`Received event: ${eventType}`, event);

  try {
    if (eventType === "call.initiated") {
      // Store call metadata for tracking
      callStore.set(event.call_control_id, {
        from: event.from.phone_number,
        to: event.to.phone_number,
        initiatedAt: new Date(),
      });

      // Answer the call and start recording
      await answerAndRecord(event.call_control_id);

      res.json({ status: "call answered and recording started" });
    } else if (eventType === "call.answered") {
      // Call is now connected; recording is active
      res.json({ status: "call connected" });
    } else if (eventType === "call.recording.saved") {
      // Recording is complete and available for download
      const callData = callStore.get(event.call_control_id);

      voicemailStore.set(event.recording_id, {
        recordingId: event.recording_id,
        callControlId: event.call_control_id,
        from: callData?.from,
        to: callData?.to,
        duration: event.duration_millis,
        downloadUrl: event.download_urls?.wav,
        savedAt: new Date(),
      });

      console.log(`Voicemail saved: ${event.recording_id}`);
      res.json({ status: "recording saved" });
    } else if (eventType === "call.hangup") {
      // Call ended; clean up resources
      await hangupCall(event.call_control_id);
      res.json({ status: "call ended" });
    } else {
      res.json({ status: "event processed" });
    }
  } catch (error) {
    console.error(`Error processing webhook: ${error.message}`);
    // Always return 200 to acknowledge receipt; log errors for debugging
    res.status(200).json({ error: error.message });
  }
});
```

Add a REST endpoint to retrieve voicemail messages:

```javascript
/**
 * GET endpoint to retrieve all voicemail messages.
 */
app.get("/voicemail", (req, res) => {
  try {
    const voicemails = Array.from(voicemailStore.values()).map((vm) => ({
      recordingId: vm.recordingId,
      from: vm.from,
      to: vm.to,
      duration: vm.duration,
      downloadUrl: vm.downloadUrl,
      savedAt: vm.savedAt,
    }));

    res.json({ voicemails, count: voicemails.length });
  } catch (error) {
    console.error(`Error retrieving voicemail: ${error.message}`);
    res.status(500).json({ error: "Failed to retrieve voicemail messages" });
  }
});

/**
 * GET endpoint to retrieve a specific voicemail message.
 */
app.get("/voicemail/:recordingId", (req, res) => {
  try {
    const voicemail = getRecordingDetails(req.params.recordingId);

    if (!voicemail) {
      return res.status(404).json({ error: "Voicemail not found" });
    }

    res.json(voicemail);
  } catch (error) {
    console.error(`Error retrieving voicemail: ${error.message}`);
    res.status(500).json({ error: "Failed to retrieve voicemail" });
  }
});
```

## Complete Code

See [`server.js`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voicemail-nodejs/server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not receiving events | The application starts but no call events arrive at the webhook endpoint. | Verify that your Call Control Application webhook URL in the Telnyx Portal matches your public URL (e.g., `https://your-domain.com/webhooks/call`). For local development, use ngrok to expose your server: `ngrok http 3000`, then update the webhook URL to your ngrok URL. Ensure your firewall allows inbound HTTPS traffic on port 443. |
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Express server. |
| Recording not saved | Voicemail recordings are not appearing in the `/voicemail` endpoint after calls complete. | Confirm that your Call Control Application is configured with the correct webhook URL and that the `call.recording.saved` event is being received. Check the server logs for webhook events. Ensure the call duration is long enough for the recording to be processed (minimum 1 second). Verify that the `startRecording` action is being called after the call is answered. |
| Connection ID not found | The application fails to initiate calls with an error about missing or invalid connection ID. | Verify that `TELNYX_CONNECTION_ID` in your `.env` file matches your Call Control Application ID from the Telnyx Portal. The connection ID links your phone number to the Call Control application and must be configured before calls can be controlled. |
| Port already in use | The server fails to start with error `EADDRINUSE: address already in use :::3000`. | Change the port in your `.env` file to an available port (e.g., `PORT=3001`), or kill the process using port 3000. On macOS/Linux, run `lsof -i :3000` to find the process ID, then `kill -9 <PID>`. On Windows, run `netstat -ano | findstr :3000` and `taskkill /PID <PID> /F`. |

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
- [Record and Retrieve Call Recordings](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/nodejs/call-recording).
- [Build an IVR Menu System](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/nodejs/ivr-menu).
