# AI Insurance Claims Intake (Voice)

## What Does This Example Do?

AI voice agent handles first notice of loss calls. Collects policy number, claim type, incident details, and injury information. Extracts structured claim data after the call. Urgent claims (injuries reported) trigger immediate SMS alerts to adjusters.

## Who Is This For?

- Insurance companies automating claims intake.
- Insurtech startups building digital-first claims.
- Claims processing teams reducing wait times.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. Voice intake + AI data extraction + urgency routing + SMS alerting on one platform. No IVR maze before reaching a human — the AI handles the full intake conversation.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-insurance-claims-intake-voice-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| Voice API | Inbound claims calls |
| Inference | Conversational intake + data extraction |
| SMS | Urgent claim alerts to adjusters |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: Can it handle auto, home, health, and life claims?**
Yes. The AI adapts its questions based on the claim type the caller describes.

**Q: Does it replace human adjusters?**
No. It handles intake and data collection. Complex claims are routed to human adjusters with complete structured data.


## Related Examples

- [Compliance Call Recorder AI Auditor](../compliance-call-recorder-ai-auditor-python/)
- [Fax To AI Document Processor](../fax-to-ai-document-processor-python/)
- [Voice Verified Identity 2FA](../voice-verified-identity-2fa-python/)
