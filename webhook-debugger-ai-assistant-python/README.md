# Webhook Debugger AI Assistant

## What Does This Example Do?

A universal webhook catcher that logs every incoming webhook, then uses AI to explain what the event means, what you should do in response, and common mistakes. Point any Telnyx webhook URL here during development.

## Who Is This For?

- Developers integrating Telnyx APIs for the first time.
- Teams debugging webhook delivery issues.
- Anyone who wants a smarter RequestBin with AI explanations.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. Webhook inspection + AI-powered documentation on one endpoint. Faster debugging than reading docs — the AI explains each event in context.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/webhook-debugger-ai-assistant-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| All APIs | Webhook event capture |
| Inference | Event analysis and explanation |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: Can I use this in production?**
It's designed for development. For production, build proper webhook handlers.

**Q: Does it validate webhook signatures?**
This demo captures all payloads. Add signature verification for security.


## Related Examples

- [Click To Call WebRTC With AI Assist](../click-to-call-webrtc-with-ai-assist-python/)
- [SIP Trunking Failover Monitor](../sip-trunking-failover-monitor-python/)
