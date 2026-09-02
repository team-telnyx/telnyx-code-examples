---
name: voicemail-to-sms-agent
title: "Voicemail-to-SMS Agent"
description: "An Edge-based agent that transcribes, summarizes, and texts voicemail summaries to the mailbox owner."
language: typescript
framework: edge
telnyx_products: ["Call Control", "Agent SDK", "Inference API", "Messaging", "Cloud Storage"]
---

# Voicemail-to-SMS Agent

The "never check voicemail again" solution. When a voicemail is left, this Edge-based agent automatically transcribes the audio, generates a concise summary using an LLM, and sends the summary via SMS to the mailbox owner.

## Why Telnyx

Telnyx provides a unified AI Communications Infrastructure that allows you to seamlessly bridge telephony, messaging, and artificial intelligence. By leveraging the Telnyx Edge SDK and Call Control primitives, you can build event-driven agents that react to call events in real-time. This sample demonstrates how to combine voicemail webhooks, AI inference, and SMS delivery into a single, cohesive agent workflow without managing separate third-party services.

## Telnyx API Endpoints Used

- **Call Control** — Voicemail webhook detection (`call.status = voicemail`)
- **Call Control** — Audio download (retrieving voicemail recording)
- **Inference API** — Speech-to-Text (STT) and LLM summarization via `this.env.TELNYX.ai.openai.chat.createCompletion()`
- **Messaging API** — SMS summary delivery via `this.env.TELNYX.messages.send()`
- **Cloud Storage** — Voicemail audio archiving

## Architecture

```text
[Voicemail Left]
      |
      v
[Call Control Webhook (call.status = voicemail)]
      |
      v
[VoicemailAgent.onTask()]
      |
      +---> 1. Download Audio from Call Control
      |            |
      |            v
      |     2. Speech-to-Text (STT)
      |            |
      |            v
      |     3. LLM Summarize (this.env.TELNYX.ai.openai.chat.createCompletion)
      |            |
      |            v
      +---> 4. SMS Summary (this.env.TELNYX.messages.send)
      |            |
      |            v
      +---> 5. Archive Audio to Cloud Storage
                   |
                   v
              [Process Complete]
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |

## Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/team-telnyx/telnyx-code-examples.git
   cd telnyx-code-examples/voicemail-to-sms-agent
   ```

2. **Create a `.env` file:**
   Copy the example environment file and update it with your Telnyx API key.
   ```bash
   cp .env.example .env
   ```
   Edit `.env` to include your actual `TELNYX_API_KEY`.

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Run the application:**
   ```bash
   npm run dev
   ```

## API Reference

For a detailed breakdown of the webhook endpoints, request parameters, and response schemas, please refer to the [API.md](./API.md) file.

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Webhook not receiving events | Webhook URL not configured in Telnyx Call Control Dashboard | Ensure your Edge deployment URL is registered as the webhook for `voicemail` events in your Telnyx profile. |
| `TELNYX_API_KEY` error | Missing or invalid environment variable | Verify your `.env` file is loaded correctly and contains a valid API key from the Telnyx Mission Control Portal. |
| SMS not received | Destination number restrictions or demo mode active | Check if the agent is running in safe demo mode (see [GUIDE.md](./GUIDE.md)). Ensure the destination number is SMS-enabled. |
| STT transcription fails | Audio download failed or unsupported format | Verify Call Control recording settings and ensure the audio file is accessible to the Edge environment. |

## Agent Discovery

- Join the Telnyx Agent community and sign up for updates: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md)
- Explore Telnyx AI repositories: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- Read the Telnyx `llms.txt` for AI-assisted documentation: [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [Call-Forwarding Agent](../call-forwarding-agent)
- [SMS Auto-Responder Agent](../sms-auto-responder-agent)
- [Call Transcription Summarizer](../call-transcription-summarizer)

## Resources

- [Developer Documentation](https://developers.telnyx.com/)
- [Call Control API Reference](https://developers.telnyx.com/docs/api/v2/call-control)
- [Messaging API Reference](https://developers.telnyx.com/docs/api/v2/messages)
- [Telnyx Edge SDK on GitHub](https://github.com/team-telnyx/edge-sdk)
- [AI & Inference Product Page](https://telnyx.com/products/ai)
- [Telnyx Pricing](https://telnyx.com/pricing)
