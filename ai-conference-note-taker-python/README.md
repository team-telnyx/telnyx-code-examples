# AI Conference Note-Taker

## What Does This Example Do?

Dial a conference bridge number and the AI joins as a participant. It transcribes the entire meeting in real time, identifies key decisions and action items using Telnyx Inference, and sends SMS summaries to all participants when the call ends. "Add this number to your next meeting and it handles the rest."

## Who Is This For?

- Teams that want automatic meeting notes without a separate tool.
- Developers building AI meeting assistants.
- Anyone tired of manually writing action items after every call.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. The note-taker joins via real telephony, not a browser bot.

- **Real phone participant** — Joins any conference bridge via PSTN. Works with Zoom dial-in, Teams dial-in, any bridge.
- **On-network processing** — Transcription and inference run on Telnyx infrastructure. Meeting audio stays on-network.
- **SMS delivery** — Summaries sent via Telnyx Messaging to all participants immediately after the call.

## Prerequisites

- Python 3.8+
- Telnyx account with API key
- Telnyx phone number for the note-taker identity
- Connection ID for outbound calling
- [ngrok](https://ngrok.com) for webhooks

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-conference-note-taker-python
cp .env.example .env
make setup && make run
```

Join a meeting:

```bash
curl -X POST http://localhost:5000/join -H "Content-Type: application/json" \
  -d '{"dial_number": "+18005551234", "participants": [{"name": "Alice", "number": "+14155551234"}]}'
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| Voice API | Join conference as participant, transcription |
| Inference | Action item extraction, meeting summarization |
| SMS | Post-meeting summary delivery |
| Cloud Storage | Recording archival |

## Complete Code

See [app.py](./app.py) for the full implementation.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Cannot join conference | Check CONNECTION_ID and ensure the bridge number accepts PSTN dial-in |
| No transcript | Verify transcription_start is called after call.answered |
| SMS not received | Ensure participant numbers are in E.164 format |

## FAQ

**Q: Can it identify who said what?**
Speaker diarization is based on channel separation. For multi-party calls, timestamps help attribute statements.

**Q: Does it work with Zoom/Teams/Google Meet?**
Yes. Any service that provides a dial-in phone number works. The AI joins as a regular phone participant.

**Q: What about recording consent?**
The AI announces itself when it joins. You should verify compliance with your local recording consent laws.

## Resources

- [Voice API](https://developers.telnyx.com/docs/voice)
- [Inference](https://developers.telnyx.com/docs/inference)
- [Messaging](https://developers.telnyx.com/docs/messaging)

## Related Examples

- [AI Sales Call with Live CRM Updates](../ai-sales-call-with-live-crm-updates-python/)
- [Real-Time Call Intelligence Dashboard](../real-time-call-intelligence-dashboard-python/)
- [Build a Voice AI Agent](../build-voice-ai-agent-python/)
