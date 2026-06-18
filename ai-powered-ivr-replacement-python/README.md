# AI-Powered IVR Replacement

## What Does This Example Do?

Replace a 12-option IVR tree with a single AI Assistant that routes callers through natural conversation. "I need to change my address" just works. Built-in A/B testing splits traffic between different AI personalities to measure which performs better. Structured insights track resolution rates, satisfaction, and department distribution.

## Who Is This For?

- Contact center operators replacing legacy IVR with conversational AI.
- CX teams that want to measure AI performance with A/B testing.
- Developers building intelligent call routing.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. AI Assistants handle the entire call flow.

- **No code after setup** — Configure the assistant in the Telnyx Portal. It handles call answering, routing, and resolution automatically.
- **Built-in A/B testing** — Version testing with traffic distribution. Test prompt changes, voice changes, or routing logic without deploying code.
- **Structured Insights** — Extract intent, satisfaction, and resolution data from every call automatically.

## Prerequisites

- Python 3.8+
- Telnyx account with API key
- AI Assistant configured in Telnyx Portal
- Telnyx phone number pointed at the assistant

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-powered-ivr-replacement-python
cp .env.example .env
make setup && make run
```

One-time setup: `curl -X POST http://localhost:5000/setup`

View analytics: `http://localhost:5000/analytics`

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| AI Assistants | Conversational call handling, routing |
| Version Testing | A/B test different prompts and voices |
| Structured Insights | Intent classification, satisfaction scoring |
| Voice API | Telephony foundation |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: Can the AI resolve issues without transferring?**
Yes. Configure the assistant with knowledge about FAQs, hours, policies, and it resolves common questions directly.

**Q: How does A/B testing work?**
Create assistant versions with different prompts or voices. Set traffic distribution rules (e.g., 50/50 split). Structured insights automatically track performance per version.

**Q: What if the AI cannot understand the caller?**
After 2-3 failed attempts, the assistant transfers to a human agent. You configure the fallback behavior.

## Resources

- [AI Assistants](https://developers.telnyx.com/docs/ai/assistants)
- [Version Testing](https://developers.telnyx.com/docs/ai/assistants/version-testing)
- [Structured Insights](https://developers.telnyx.com/docs/ai/assistants/structured-insights)

## Related Examples

- [Build a Voice AI Agent](../build-voice-ai-agent-python/)
- [Omnichannel AI Receptionist](../omnichannel-ai-receptionist-python/)
- [Global Lead Response Engine](../global-lead-response-engine-python/)
