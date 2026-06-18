# AI Medical Appointment Prep Caller

## What Does This Example Do?

AI calls patients before appointments to collect pre-visit intake: verify identity, medication changes, current symptoms, allergies, and insurance updates. Extracts structured data for the provider's chart prep.

## Who Is This For?

- Medical practices reducing check-in time.
- Urgent care clinics collecting info before arrival.
- Telehealth providers gathering intake data remotely.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. Outbound calling + AI intake collection + structured data extraction on one platform. Patients answer a phone call instead of filling out a clipboard form.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-medical-appointment-prep-caller-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| Voice API | Outbound prep calls |
| Inference | Conversational intake + data extraction |
| SMS | Appointment confirmations |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: Is this HIPAA compliant?**
This is a demo. Production use requires BAA, encryption, and PHI handling review.

**Q: Can it handle non-English patients?**
Yes. Add language detection and multilingual prompts using Telnyx's 20+ supported languages.


## Related Examples

- [AI Appointment Reminder SMS Voice](../ai-appointment-reminder-sms-voice-python/)
- [SMS Appointment No Show Predictor](../sms-appointment-no-show-predictor-python/)
- [AI Insurance Claims Intake Voice](../ai-insurance-claims-intake-voice-python/)
