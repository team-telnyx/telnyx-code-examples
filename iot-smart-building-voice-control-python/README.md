# IoT Smart Building Voice Control

## What Does This Example Do?

Call a phone number to control building systems — HVAC, lights, security, elevators. AI understands natural language commands like 'turn off the lights on floor 3' or 'set the temperature to 68.'

## Who Is This For?

- Building managers controlling IoT systems remotely.
- Facility teams needing phone-based building access.
- IoT developers building voice interfaces for hardware.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. Voice control + AI command interpretation + IoT management on one platform. Control your building from any phone, anywhere — no app required.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/iot-smart-building-voice-control-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| Voice API | Phone-based command interface |
| Inference | Natural language command parsing |
| IoT SIM | Building device connectivity |
| SMS | Command confirmation |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: Can it actually control real devices?**
This demo simulates building state. Add MQTT, Modbus, or BACnet calls to control real building systems.

**Q: Is it secure?**
Add caller ID verification or PIN entry before accepting commands. Production deployments need access control.


## Related Examples

- [IoT Fleet Alert Escalation](../iot-fleet-alert-escalation-python/)
- [Sim Fleet Data Usage Anomaly Detector](../sim-fleet-data-usage-anomaly-detector-python/)
