# AI Appointment Reminder (SMS + Voice)

## What Does This Example Do?

Sends SMS reminders for upcoming appointments. If no reply within a configurable window, escalates to an AI voice call that can confirm, reschedule, or cancel. Handles all responses via AI conversation.

## Who Is This For?

- Healthcare practices reducing no-show rates.
- Service businesses (salons, auto shops, dental) automating reminders.
- Developers building appointment management systems.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. SMS reminder → voice escalation → AI rescheduling in a single platform. No Twilio for SMS + Calendly for scheduling + a separate voice vendor.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-appointment-reminder-sms-voice-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| SMS | Reminder delivery and reply handling |
| Voice API | Escalation calls for non-responders |
| Inference | Natural conversation for rescheduling |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: Can it integrate with my calendar?**
Yes. Add a calendar API call in the /appointments endpoint to check availability before offering times.

**Q: What about HIPAA?**
This is a demo. Production healthcare deployments need BAA and PHI handling review.


## Related Examples

- [SMS Appointment No Show Predictor](../sms-appointment-no-show-predictor-python/)
- [AI Medical Appointment Prep Caller](../ai-medical-appointment-prep-caller-python/)
- [Omnichannel AI Receptionist](../omnichannel-ai-receptionist-python/)
