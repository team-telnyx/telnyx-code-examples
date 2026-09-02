# Guide: Voicemail-to-SMS Agent

This guide walks through the `voicemail-to-sms-agent` sample. The application implements the "never check voicemail again" solution: when a caller leaves a voicemail, a Telnyx Edge Agent automatically transcribes the audio, summarizes the transcript using an LLM, and sends the summary via SMS to the mailbox owner. The original audio is then archived in Cloud Storage.

## Prerequisites

- Node.js 18+ and npm
- A Telnyx account with:
  - A Call Control application configured to receive `call.status = voicemail` webhooks
  - A Telnyx number capable of sending SMS
  - An AI/Inference binding configured for OpenAI chat completions
  - A Cloud Storage bucket for audio archiving
- The Telnyx CLI (optional, for tunneling webhooks locally)

## Environment Setup

Copy the `.env.example` file to `.env` and fill in your details:

```bash
cp .env.example .env
```

Required environment variables:

| Variable | Description |
|----------|-------------|
| `TELNYX_API_KEY` | Your Telnyx API key |
| `TELNYX_APP_ID` | Your Call Control application ID |
| `TELNYX_PUBLIC_URL` | The public URL where Telnyx can reach this Edge app (e.g., your tunnel URL) |
| `MAILBOX_OWNER_NUMBER` | The phone number to receive SMS summaries (e.g., `+15551234567`) |
| `TELNYX_FROM_NUMBER` | The Telnyx number sending the SMS (e.g., `+15559876543`) |
| `STORAGE_BUCKET` | Your Telnyx Cloud Storage bucket name |

## Running the Sample

Install dependencies:

```bash
npm install
```

Run in development mode (with hot reloading):

```bash
npm run dev
```

Deploy to the Telnyx Edge network:

```bash
npm run deploy
```

## How It Works

The application is a single Telnyx Edge app built with the Agent SDK. The architecture follows the data flow specified in the ticket:

```
Voicemail webhook → VoicemailAgent.onTask() → download audio → STT → LLM summarize → SMS summary → archive audio
```

### 1. Voicemail Webhook Detection

The main entry point in `src/index.ts` exports the default app handler. It listens for incoming POST requests to the webhook endpoint. The handler verifies the Telnyx Ed25519 signature to ensure the request is authentic. It then parses the webhook payload, reading fields from `data.payload`. If the event type is `call.status` and the payload indicates `voicemail`, the handler triggers the Agent.

### 2. The VoicemailAgent Class

The core logic lives in the `VoicemailAgent` class, which extends the `Agent` base class from the Telnyx Edge SDK. The `onTask()` method is the entry point for the agent's work. It receives the voicemail metadata (call control ID, recording URL, etc.) and orchestrates the following steps.

### 3. Audio Download and Speech-to-Text (STT)

Inside `onTask()`, the agent downloads the voicemail audio file from the Call Control recording URL. The audio is passed to the Inference binding for speech-to-text. The Telnyx Edge environment provides access to AI models via `this.env.TELNYX.ai`. The STT service transcribes the audio and returns the text transcript.

### 4. LLM Summarization

Once the transcript is available, the agent uses the Inference binding to generate a concise summary. This is done via `this.env.TELNYX.ai.openai.chat.createCompletion()`. The agent constructs a prompt asking the LLM to summarize the voicemail transcript into a brief, actionable message suitable for SMS.

### 5. SMS Summary Delivery

After generating the summary, the agent sends it via SMS to the mailbox owner. This uses the `[telnyx]` binding for messaging. The code calls `this.env.TELNYX.messages.send()` with the summary text, the recipient number (from env vars), and the sender number (from env vars).

### 6. Cloud Storage Audio Archive

Finally, the agent archives the original voicemail audio file to Telnyx Cloud Storage. This ensures the audio is preserved for future reference. The agent uploads the audio blob to the specified storage bucket using the Cloud Storage primitive.

## Demo Mode vs Live Mode

This sample runs in **safe demo mode** by default. In demo mode:

- No real SMS is sent to the mailbox owner. The SMS payload is logged to the console instead.
- No real audio is uploaded to Cloud Storage. The upload is simulated and logged.
- The LLM summarization still runs if the Inference binding is configured, but you can also mock it.

To switch to **live mode**, set the following environment variable in your `.env` file:

```
DEMO_MODE=false
```

In live mode:
- `this.env.TELNYX.messages.send()` will send a real SMS to the number specified in `MAILBOX_OWNER_NUMBER`.
- The audio file will be uploaded to the Cloud Storage bucket specified in `STORAGE_BUCKET`.

**Warning:** Live mode may incur charges on your Telnyx account. Ensure your phone numbers and storage bucket are correctly configured before enabling live mode.

## Next Steps

- [Telnyx Call Control Documentation](https://developers.telnyx.com/docs/voice/call-control)
- [Telnyx SMS Documentation](https://developers.telnyx.com/docs/messaging)
- [Telnyx AI/Inference Bindings](https://developers.telnyx.com/docs/edge/ai-bindings)
- [Telnyx Cloud Storage](https://developers.telnyx.com/docs/edge/cloud-storage)
- [Telnyx Edge SDK](https://developers.telnyx.com/docs/edge)
