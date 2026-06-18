# IoT Fleet Alert Escalation

## What Does This Example Do?

IoT sensors detect anomalies and send alerts via webhook. AI classifies severity using Telnyx Inference. Low severity: SMS to the on-call engineer. Medium: SMS plus an auto-call with AI briefing. Critical: SMS to everyone plus a multi-party conference bridging the on-call engineer, dispatcher, and an AI providing real-time diagnostics.

## Who Is This For?

- Fleet management teams with connected vehicles and IoT sensors.
- Industrial operations teams monitoring equipment via telemetry.
- DevOps/SRE teams building intelligent alert escalation.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. IoT SIMs, voice, SMS, and inference on one network.

- **IoT to voice in one platform** — SIM connectivity, alert processing, SMS, and multi-party calls without stitching together PagerDuty + Twilio + OpenAI.
- **AI-classified routing** — Inference decides severity. No static alert rules that miss edge cases.
- **Multi-party conferencing** — Critical alerts automatically bridge the right people with AI context.

## Prerequisites

- Python 3.8+
- Telnyx account with API key
- Telnyx phone numbers for alerts and on-call
- Connection ID for outbound calling
- IoT sensors configured to POST alert data

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/iot-fleet-alert-escalation-python
cp .env.example .env
make setup && make run
```

Simulate an alert:

```bash
curl -X POST http://localhost:5000/alert -H "Content-Type: application/json" \
  -d '{"sensor_id": "truck-42", "type": "engine_temp", "value": 280, "unit": "F", "threshold": 230}'
```

## Implementation Details

### Escalation routing

```
IoT Sensor Alert (webhook)
        |
  AI Severity Classification (Telnyx Inference)
        |
   +----+----+----+
   |         |         |
  LOW     MEDIUM    CRITICAL
   |         |         |
  SMS     SMS+Call   SMS+SMS+Conference
  (on-call) (on-call)  (on-call+dispatcher+AI)
```

### Products used

| Product | Role |
|---------|------|
| IoT SIM | Sensor connectivity |
| Inference | Severity classification |
| SMS | Alert notifications |
| Voice API | Auto-calls, multi-party conference |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: Can I integrate with PagerDuty?**
Yes. Replace the multi-party conference with a PagerDuty API call, or use both — PagerDuty for tracking, Telnyx for the actual communication.

**Q: How fast is the classification?**
Inference typically responds in under 1 second. Total alert-to-notification time is under 5 seconds for SMS, under 15 seconds for voice.

## Resources

- [IoT / Wireless](https://developers.telnyx.com/docs/wireless)
- [Voice API](https://developers.telnyx.com/docs/voice)
- [Messaging](https://developers.telnyx.com/docs/messaging)
- [Inference](https://developers.telnyx.com/docs/inference)

## Related Examples

- [Build a Voice AI Agent](../build-voice-ai-agent-python/)
- [Real-Time Call Intelligence Dashboard](../real-time-call-intelligence-dashboard-python/)
