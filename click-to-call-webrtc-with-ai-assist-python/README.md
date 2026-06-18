# Click-to-Call WebRTC with AI Assist

## What Does This Example Do?

A browser-based click-to-call widget with an AI coaching sidebar. Sales reps click to call from their browser via WebRTC. During the call, AI analyzes the conversation and provides real-time coaching tips.

## Who Is This For?

- Sales teams wanting browser-based calling with AI coaching.
- Support teams needing integrated phone + knowledge base.
- Developers building WebRTC calling into web apps.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. WebRTC calling + AI coaching on one platform. No separate softphone app, coaching tool, or conversation intelligence subscription.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/click-to-call-webrtc-with-ai-assist-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| WebRTC | Browser-based calling |
| Inference | Real-time coaching suggestions |
| Voice API | Call control and transcription |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: Does it work on mobile browsers?**
WebRTC is supported on modern mobile browsers. The UI adapts to smaller screens.

**Q: Can the prospect hear the AI coaching?**
No. Coaching appears as text in the sidebar — only the rep sees it.


## Related Examples

- [Real Time Call Intelligence Dashboard](../real-time-call-intelligence-dashboard-python/)
- [AI Sales Call With Live Crm Updates](../ai-sales-call-with-live-crm-updates-python/)
- [AI Cold Caller Objection Trainer](../ai-cold-caller-objection-trainer-python/)
