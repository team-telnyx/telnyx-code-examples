# AI Phone Tree Builder from Description

## What Does This Example Do?

Describe your business in plain English and the AI generates a complete phone system: AI Assistant configuration, TeXML IVR fallback, department routing, and greeting scripts. Optionally deploys it live.

## Who Is This For?

- Small businesses setting up their first phone system.
- IT teams automating phone tree provisioning.
- Developers building no-code telephony tools.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. AI generates the configuration, Telnyx API deploys it. One API call from description to working phone system. No manual PBX configuration.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-phone-tree-builder-from-description-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| AI Assistants | Generated conversational phone handler |
| Inference | Phone tree generation from natural language |
| TeXML | IVR fallback configuration |
| Voice API | Call routing foundation |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: Can it handle complex multi-level menus?**
Yes. The AI generates nested routing based on your description complexity.

**Q: Is the generated TeXML production-ready?**
It's a solid starting point. Review and customize before production deployment.


## Related Examples

- [AI Powered Ivr Replacement](../ai-powered-ivr-replacement-python/)
- [Omnichannel AI Receptionist](../omnichannel-ai-receptionist-python/)
- [AI Restaurant Reservation Voice Agent](../ai-restaurant-reservation-voice-agent-python/)
