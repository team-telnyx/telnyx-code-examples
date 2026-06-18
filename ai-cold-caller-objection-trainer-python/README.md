# AI Cold Caller Objection Trainer

## What Does This Example Do?

Sales reps call a training number and practice cold calling against 5 AI personas: Busy VP, Happy Incumbent, Budget Blocker, Technical Skeptic, and Gatekeeper. After the call, AI scores performance across 6 dimensions.

## Who Is This For?

- Sales managers training new BDRs and AEs.
- Sales enablement teams building rep skills.
- Individual reps wanting to practice objection handling.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. Real phone practice (not chat simulation) with AI personas and scoring. Reps practice on actual calls with real latency and speech dynamics. One platform for the call, the AI persona, and the scoring.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-cold-caller-objection-trainer-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| Voice API | Outbound training calls |
| Inference | AI persona roleplay + performance scoring |
| SMS | Score delivery after calls |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: Can I add custom personas?**
Yes. Add entries to the PERSONAS list with name and style description.

**Q: How realistic are the personas?**
Very. The AI stays in character for 5-8 exchanges, then breaks to give coaching feedback. Reps report it feeling like a real cold call.


## Related Examples

- [Autonomous Outbound Sales Agent](../autonomous-outbound-sales-agent-python/)
- [AI Competitive Win Loss Call Analyzer](../ai-competitive-win-loss-call-analyzer-python/)
- [AI Sales Call With Live Crm Updates](../ai-sales-call-with-live-crm-updates-python/)
