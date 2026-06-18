# Multi-Channel AI Helpdesk with Ticketing

## What Does This Example Do?

AI support agent that handles voice calls, SMS, and WhatsApp. Tries to resolve issues directly. When it can't, auto-creates support tickets via webhook and notifies the customer. Cross-channel context so a customer who called can follow up via text.

## Who Is This For?

- SMBs needing a helpdesk without Zendesk-level costs.
- Support teams automating tier-1 issue resolution.
- Developers building multi-channel support systems.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. Voice + SMS + WhatsApp + AI + ticketing on one platform. Replace a helpdesk tool, phone system, and messaging provider with a single integration.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/multi-channel-ai-helpdesk-with-ticketing-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| Voice API | Phone support |
| SMS | Text support |
| WhatsApp | WhatsApp support |
| Inference | Issue resolution and ticket creation |
| Webhooks | Ticket system integration |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: Which ticketing systems does it support?**
Any system with a webhook or API: Jira, ServiceNow, Zendesk, Linear, or custom.

**Q: Can it escalate to a human?**
Yes. Configure transfer numbers for live agent escalation when the AI detects complex issues.


## Related Examples

- [Omnichannel AI Receptionist](../omnichannel-ai-receptionist-python/)
- [AI Insurance Claims Intake Voice](../ai-insurance-claims-intake-voice-python/)
- [SMS Chatbot With Conversation Memory](../sms-chatbot-with-conversation-memory-python/)
