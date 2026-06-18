# AI Voicemail Transcription & Forwarding

## What Does This Example Do?

Answers calls, records voicemails, transcribes them in real time, uses AI to classify priority (urgent/normal/spam), summarizes the message, and forwards the summary via SMS. Urgent voicemails get instant alerts.

## Who Is This For?

- Professionals who miss calls and need fast voicemail triage.
- Small businesses without a receptionist.
- On-call teams that need priority-based voicemail routing.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. Recording, transcription, AI classification, and SMS forwarding on one platform. No third-party transcription service or voicemail provider.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-voicemail-transcription-forwarding-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| Voice API | Call answering and recording |
| Transcription | Real-time voicemail-to-text |
| Inference | Priority classification and summarization |
| SMS | Forwarding summaries to your phone |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: Can it forward to email instead?**
Yes. Replace the SMS call with an email API or webhook to your email service.

**Q: Does it filter spam calls?**
The AI classifies voicemails as spam. You can auto-delete or archive spam-classified messages.


## Related Examples

- [AI Appointment Reminder SMS Voice](../ai-appointment-reminder-sms-voice-python/)
- [Omnichannel AI Receptionist](../omnichannel-ai-receptionist-python/)
- [Compliance Call Recorder AI Auditor](../compliance-call-recorder-ai-auditor-python/)
