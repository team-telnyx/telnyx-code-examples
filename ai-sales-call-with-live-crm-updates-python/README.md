# AI Sales Call with Live CRM Updates

## What Does This Example Do?

An AI agent joins multi-participant sales calls, listens to the conversation in real time, extracts deal signals (budget, timeline, competitors mentioned, pain points) using Telnyx Inference, pushes structured data to your CRM, and sends an SMS follow-up to the prospect after the call ends. Five Telnyx products working together in a single workflow.

## Who Is This For?

- Sales teams that want AI-assisted deal intelligence without switching tools.
- Revenue operations engineers building automated post-call workflows.
- CRM administrators who want real-time call data without manual entry.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. Voice, inference, messaging, and telephony run on the same private network.

- **Single platform** — Call control, transcription, LLM inference, and SMS in one API. No stitching together Twilio + OpenAI + Deepgram + Salesforce middleware.
- **Real-time transcription + inference** — Transcription feeds directly to inference on the same network. No extra hops.
- **Built-in integrations** — AI Assistants connect natively to Salesforce, HubSpot, Jira, and more.
- **One bill** — When it breaks at 2 AM, one vendor owns the fix.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- Telnyx phone number with voice enabled
- Call Control Application with webhook URL configured
- CRM webhook endpoint (Salesforce, HubSpot, or custom)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-sales-call-with-live-crm-updates-python
cp .env.example .env
# Edit .env with your API key and CRM webhook
make setup
make run
```

## Implementation Details

### Architecture

```
AE + Prospect on call
        |
  Telnyx Call Control (webhook)
        |
  Real-time Transcription
        |
  Telnyx Inference (deal signal extraction)
        |
   +----+----+
   |         |
CRM Update  SMS Follow-up
(webhook)   (Telnyx Messaging)
```

### Products used

| Product | Role |
|---------|------|
| Voice API | Call control, answer, transcription |
| Inference | Deal signal extraction via LLM |
| SMS | Post-call follow-up to prospect |
| Structured Insights | Extracted deal data schema |
| Number Lookup | Caller identification |

## Complete Code

See [app.py](./app.py) for the full implementation.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No transcription data | Verify transcription_start is called after call.answered |
| CRM webhook not receiving | Check CRM_WEBHOOK_URL is accessible and returns 200 |
| SMS not sending | Verify FOLLOW_UP_NUMBER is a valid Telnyx number with messaging enabled |

## FAQ

**Q: Can the AI coach the rep during the call?**
Yes. Add a WebRTC whisper channel so inference results are spoken only to the AE, not the prospect.

**Q: Which CRMs are supported?**
Any CRM with a webhook or API. The example uses a generic webhook. Telnyx AI Assistants have built-in Salesforce and HubSpot integrations.

**Q: How is this different from Gong or Chorus?**
Gong records and analyzes after the call. This runs inference in real-time during the call and pushes to CRM before the rep opens their laptop.

## Resources

- [Voice API](https://developers.telnyx.com/docs/voice)
- [Inference API](https://developers.telnyx.com/docs/inference)
- [Messaging API](https://developers.telnyx.com/docs/messaging)
- [AI Assistants](https://developers.telnyx.com/docs/ai/assistants)

## Related Examples

- [Build a Voice AI Agent](../build-voice-ai-agent-python/)
- [Real-Time Call Intelligence Dashboard](../real-time-call-intelligence-dashboard-python/)
- [AI Conference Note-Taker](../ai-conference-note-taker-python/)
