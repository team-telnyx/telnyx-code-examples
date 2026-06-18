# SIM Fleet Data Usage Anomaly Detector

## What Does This Example Do?

Monitor your IoT SIM fleet for data usage anomalies. AI analyzes usage patterns across all SIMs, detects spikes, offline devices, and unusual behavior, then sends SMS alerts for medium/high severity issues.

## Who Is This For?

- IoT fleet managers monitoring connected devices.
- Telecom teams managing SIM deployments.
- DevOps teams monitoring cellular-connected infrastructure.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. SIM management + AI anomaly detection + SMS alerting on one platform. Your IoT connectivity and intelligence layer from a single provider.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sim-fleet-data-usage-anomaly-detector-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| IoT SIM | Fleet connectivity and usage data |
| Inference | Anomaly detection and classification |
| SMS | Alert notifications |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: How often should I scan?**
Run /scan on a schedule (hourly or daily) via cron. The AI compares current usage against historical patterns.

**Q: Can it auto-suspend rogue SIMs?**
Add a SIM suspend API call when severity is 'high' for automated response.


## Related Examples

- [IoT Fleet Alert Escalation](../iot-fleet-alert-escalation-python/)
- [IoT Smart Building Voice Control](../iot-smart-building-voice-control-python/)
- [Number Reputation Monitor Auto Rotate](../number-reputation-monitor-auto-rotate-python/)
