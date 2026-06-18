# AI Restaurant Reservation Voice Agent

## What Does This Example Do?

Customers call the restaurant and an AI host answers. It checks availability, books tables, answers menu questions, handles dietary requests, and sends SMS confirmation. The restaurant never misses a reservation call.

## Who Is This For?

- Restaurants without a dedicated host for phone reservations.
- Restaurant groups managing multiple locations.
- Developers building hospitality voice solutions.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. Voice + AI + SMS on one platform. No OpenTable fees, no missed calls, no separate answering service.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-restaurant-reservation-voice-agent-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| Voice API | Inbound call handling |
| Inference | Conversational reservation booking |
| SMS | Confirmation messages |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: Can it connect to my POS or reservation system?**
Yes. Add API calls to your reservation system (OpenTable, Resy, etc.) in the booking flow.

**Q: What about special requests?**
The AI handles dietary restrictions, high chairs, birthday celebrations — anything you include in the system prompt.


## Related Examples

- [AI Appointment Reminder SMS Voice](../ai-appointment-reminder-sms-voice-python/)
- [Omnichannel AI Receptionist](../omnichannel-ai-receptionist-python/)
- [AI Real Estate Showing Scheduler](../ai-real-estate-showing-scheduler-python/)
