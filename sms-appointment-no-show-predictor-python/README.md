# SMS Appointment No-Show Predictor

## What Does This Example Do?

AI predicts which patients are likely to no-show based on SMS response patterns, confirmation history, and behavioral signals. High-risk patients get proactive interventions (extra reminders, rescheduling offers).

## Who Is This For?

- Healthcare practices losing revenue to no-shows.
- Service businesses optimizing appointment utilization.
- Developers building predictive scheduling systems.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. SMS engagement data + AI prediction + automated intervention on one platform. The same system that sends reminders also predicts who won't show up.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-appointment-no-show-predictor-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| SMS | Reminder delivery and response tracking |
| Inference | No-show risk prediction |
| Number Lookup | Contact validation |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: How accurate are the predictions?**
Accuracy improves with data. Track actual outcomes to refine the model over time.

**Q: Can it overbook to compensate?**
Yes. Use risk scores to inform overbooking strategy for high no-show slots.


## Related Examples

- [AI Appointment Reminder SMS Voice](../ai-appointment-reminder-sms-voice-python/)
- [AI Medical Appointment Prep Caller](../ai-medical-appointment-prep-caller-python/)
