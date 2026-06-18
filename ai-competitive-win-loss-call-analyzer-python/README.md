# AI Competitive Win/Loss Call Analyzer

## What Does This Example Do?

Feed sales call transcripts and the AI extracts competitive intelligence: which competitors were mentioned, what strengths/weaknesses were cited, pricing discussions, decision factors, and win/loss reasons. Aggregates insights across multiple calls.

## Who Is This For?

- Sales leadership tracking competitive dynamics.
- Product teams gathering competitive feedback.
- Competitive intelligence teams building battle cards.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. Call analysis + AI competitive intelligence + trend aggregation on one platform. No separate conversation intelligence tool for competitive analysis.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-competitive-win-loss-call-analyzer-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| Inference | Competitive signal extraction and trend analysis |
| Cloud Storage | Call transcript archival |
| Voice API | Source call recordings |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: Can I analyze calls from other platforms?**
Yes. POST any transcript to /analyze — it doesn't have to be a Telnyx call.

**Q: How many calls do I need for useful insights?**
Insights emerge after 5-10 calls. The /insights endpoint synthesizes patterns across all analyzed calls.


## Related Examples

- [Real Time Call Intelligence Dashboard](../real-time-call-intelligence-dashboard-python/)
- [Compliance Call Recorder AI Auditor](../compliance-call-recorder-ai-auditor-python/)
- [AI Cold Caller Objection Trainer](../ai-cold-caller-objection-trainer-python/)
