# Audio Transcribe → Summarize → SMS

An end-to-end voicemail pipeline on Telnyx Edge Compute + Agent SDK: upload audio → STT → LLM summary → SMS delivery.

## How It Works

```
  Upload audio file (POST /upload)
        │
        ▼
  ┌──────────────────────────────────────────┐
  │ Upload to Cloud Storage (S3 PUT, SigV4)    │
  └────────┬─────────────────────────────────┘
           │
           ▼
  VoicemailAgent.start()
    → this.queue("transcribe")
    → this.queue("summarize")
    → this.queue("notify")
           │
           ▼
  Stage 1: transcribe()
    → S3 GET from Cloud Storage
    → POST /v2/ai/audio/transcriptions (STT)
    → Store transcript in state
           │
           ▼
  Stage 2: summarize()
    → this.env.TELNYX.ai.openai.chat.createCompletion()
    → Store summary in state
           │
           ▼
  Stage 3: notify()
    → this.env.TELNYX.messages.send()
    → SMS summary delivered
```

## Telnyx Products Used

- **Edge Compute (Agent SDK)** — `Agent` base class from `@telnyx/edge-runtime` with `queue()` pipeline, durable state, and the `[telnyx]` binding
- **AI Inference** — STT via `POST /v2/ai/audio/transcriptions` + LLM via `this.env.TELNYX.ai.openai.chat.createCompletion()` (zero-credential binding)
- **Messaging** — SMS via `this.env.TELNYX.messages.send()` (zero-credential binding)
- **Cloud Storage** — S3-compatible API for audio file upload/download, signed with AWS SigV4 using the Telnyx API key as both access key and secret key

## Prerequisites

- [Telnyx Edge CLI](https://github.com/team-telnyx/edge-compute/releases) v0.2.2+
- Node.js 18+
- A Telnyx Cloud Storage bucket (create in [Portal](https://portal.telnyx.com/storage))
- A Telnyx phone number with SMS capability

## Step 1: Understand the Code

### `src/voicemailAgent.ts` — The Agent

```typescript
export class VoicemailAgent extends Agent<VoicemailEnv, VoicemailState> {
  async start({ audioKey, bucket, recipientPhone, senderPhone }) {
    await this.setState({ audioKey, bucket, recipientPhone, senderPhone, status: "transcribing" });
    await this.queue("transcribe");
  }

  async transcribe() {
    const audioBytes = await this.downloadFromStorage(state.audioKey, state.bucket);
    // POST /v2/ai/audio/transcriptions with audio
    await this.setState({ transcript, status: "summarizing" });
    await this.queue("summarize");
  }

  async summarize() {
    const completion = await this.env.TELNYX.ai.openai.chat.createCompletion({
      model: "zai-org/GLM-5.2",
      messages: [{ role: "system", content: SUMMARIZE_SYSTEM_PROMPT }, { role: "user", content: state.transcript }],
    });
    await this.setState({ summary, status: "sending" });
    await this.queue("notify");
  }

  async notify() {
    await this.env.TELNYX.messages.send({ from: state.senderPhone, to: state.recipientPhone, text: state.summary });
    await this.setState({ status: "done" });
  }
}
```

### `src/index.ts` — The Front Door

Receives audio uploads, uploads to Cloud Storage, and starts the agent pipeline:

```typescript
if (req.method === "POST" && url.pathname === "/upload") {
  const file = formData.get("file");
  await VoicemailAgent.uploadToStorage(apiKey, bucket, audioKey, audioBytes, contentType, region);
  await env.VOICEMAIL.idFromName(actorId).start({ audioKey, bucket, recipientPhone, senderPhone });
  return Response.json({ action: "queued", statusUrl: `/status/${agentId}` });
}
```

## Step 2: Deploy

```bash
npm install
telnyx-edge secret set TELNYX_API_KEY KEY0123456789ABCDEF
telnyx-edge secret set STORAGE_BUCKET my-voicemail-bucket
telnyx-edge secret set SENDER_PHONE +18005551234
telnyx-edge ship
```

## Step 3: Test

```bash
# Upload a voicemail audio file
curl -X POST https://audio-transcribe-summarize-sms-<id>.telnyxcompute.com/upload \
  -F "file=@voicemail.wav" \
  -F "recipient_phone=+17177247292"

# Poll for status
curl https://audio-transcribe-summarize-sms-<id>.telnyxcompute.com/status/<agentId>
```

The SMS summary arrives on the recipient's phone within seconds of upload.
