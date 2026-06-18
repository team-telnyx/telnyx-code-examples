# AI Debt Collection Compliance Agent

## What Does This Example Do?

FDCPA-compliant outbound collection calls with real-time compliance guardrails. AI makes the required disclosures, handles objections professionally, respects cease-and-desist requests immediately, and every response is compliance-checked before delivery.

## Who Is This For?

- Collection agencies automating compliant outbound.
- FinTech companies building debt recovery workflows.
- Compliance teams ensuring regulatory adherence.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. Voice + AI + real-time compliance checking on one platform. Every call recorded, every response audited. No separate compliance monitoring tool.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-debt-collection-compliance-agent-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| Voice API | Outbound calls with recording |
| Inference | Conversational AI + compliance checking |
| SMS | Follow-up payment plan details |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: Is this actually FDCPA compliant?**
The AI follows FDCPA rules by design (disclosure, cease-and-desist, no harassment). Production use requires legal review.

**Q: Can it process payments?**
Add a payment API integration in the conversation flow for phone payments.


## Related Examples

- [Compliance Call Recorder AI Auditor](../compliance-call-recorder-ai-auditor-python/)
- [Autonomous Outbound Sales Agent](../autonomous-outbound-sales-agent-python/)
