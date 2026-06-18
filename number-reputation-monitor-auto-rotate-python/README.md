# Number Reputation Monitor & Auto-Rotate

## What Does This Example Do?

Monitor the health and reputation of your outbound phone numbers. AI analyzes answer rates, complaint patterns, and usage metrics. Flags numbers at risk of being marked spam and logs rotation recommendations.

## Who Is This For?

- Outbound sales teams protecting caller ID reputation.
- Contact centers managing large number pools.
- Growth teams monitoring SMS deliverability.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. Number management + AI health analysis + alerting on one platform. No separate reputation monitoring service.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/number-reputation-monitor-auto-rotate-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| Numbers API | Phone number inventory management |
| Inference | Health analysis and rotation recommendations |
| SMS | Reputation alerts |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: Does it auto-buy replacement numbers?**
The /scan endpoint recommends rotations. Add a number purchase API call for fully automated rotation.

**Q: How does it detect spam risk?**
AI analyzes answer rates, call patterns, and complaint signals to predict reputation issues before they impact deliverability.


## Related Examples

- [Messaging Campaign Ab Test Optimizer](../messaging-campaign-ab-test-optimizer-python/)
- [SIP Trunking Failover Monitor](../sip-trunking-failover-monitor-python/)
