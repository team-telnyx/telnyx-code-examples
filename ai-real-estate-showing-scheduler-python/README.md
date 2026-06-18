# AI Real Estate Showing Scheduler

## What Does This Example Do?

Buyers call or text about property listings. AI describes available homes, checks showing availability, books appointments, and sends SMS confirmations. Handles both voice and SMS with the same listing data.

## Who Is This For?

- Real estate agents managing showing requests.
- Property management companies handling inquiries.
- Real estate tech companies building listing tools.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. Voice + SMS + AI with shared listing data on one platform. No separate answering service, scheduling tool, and text messaging vendor.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-real-estate-showing-scheduler-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| Voice API | Inbound property inquiry calls |
| SMS | Text inquiries and confirmations |
| Inference | Listing recommendations and scheduling |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: Can it connect to MLS?**
Yes. Replace the static listings with MLS API calls for live inventory.

**Q: Does it handle multiple properties per call?**
Yes. The AI can discuss and compare multiple listings in a single conversation.


## Related Examples

- [AI Restaurant Reservation Voice Agent](../ai-restaurant-reservation-voice-agent-python/)
- [AI Appointment Reminder SMS Voice](../ai-appointment-reminder-sms-voice-python/)
- [Omnichannel AI Receptionist](../omnichannel-ai-receptionist-python/)
