# Emergency Mass Notification System

## What Does This Example Do?

Send emergency alerts to hundreds of contacts via SMS simultaneously, with voice call escalation for critical alerts. Track delivery and acknowledgment per contact. Press 1 to acknowledge.

## Who Is This For?

- Schools, hospitals, and municipalities with emergency notification requirements.
- Enterprise safety teams managing crisis communications.
- Event organizers needing mass notification capability.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. SMS blast + voice escalation + delivery tracking on one platform. No Everbridge or AlertMedia subscription needed for basic mass notification.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/emergency-mass-notification-system-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| SMS | Mass alert delivery |
| Voice API | Critical alert voice calls |
| Number Lookup | Contact validation |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: How many contacts can it handle?**
Telnyx SMS supports high-throughput sending. Add rate limiting for very large lists.

**Q: Can I track who acknowledged?**
Yes. The /notifications endpoint shows delivery and acknowledgment status per contact.


## Related Examples

- [IoT Fleet Alert Escalation](../iot-fleet-alert-escalation-python/)
- [SIP Trunking Failover Monitor](../sip-trunking-failover-monitor-python/)
