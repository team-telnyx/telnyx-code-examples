# SIP Trunking Failover Monitor

## What Does This Example Do?

Health-check primary and backup SIP trunk connections. If the primary goes down, automatically failover to backup and send an SMS alert. When primary recovers, failback and notify.

## Who Is This For?

- Telecom teams managing SIP infrastructure.
- IT teams ensuring voice continuity.
- Enterprises with high-availability voice requirements.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. SIP health monitoring + auto-failover + SMS alerting on the same platform that provides the trunks. No separate monitoring tool for your voice infrastructure.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-trunking-failover-monitor-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| SIP Trunking | Primary and backup voice connections |
| SMS | Failover/recovery alerts |
| API | Connection health checking |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: How fast is the failover?**
Detection runs on your configured schedule (e.g., every 30 seconds). Failover is the time between detection and alert.

**Q: Can I add more than 2 trunks?**
Yes. Add additional connection IDs for multi-tier failover.


## Related Examples

- [Emergency Mass Notification System](../emergency-mass-notification-system-python/)
- [Number Reputation Monitor Auto Rotate](../number-reputation-monitor-auto-rotate-python/)
