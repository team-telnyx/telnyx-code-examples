# Messaging Campaign A/B Test Optimizer

## What Does This Example Do?

Create SMS campaigns with multiple copy variants, randomly distribute to contacts, track reply rates per variant, and use AI to analyze which copy performs best and suggest the next test.

## Who Is This For?

- Marketing teams optimizing SMS campaign copy.
- Growth hackers running rapid message testing.
- Developers building campaign management tools.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. SMS sending + A/B distribution + AI analysis on one platform. No separate campaign tool or analytics provider.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/messaging-campaign-ab-test-optimizer-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| SMS | Campaign delivery with variant tracking |
| Inference | Performance analysis and copy suggestions |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: How many variants can I test?**
Unlimited. The AI analyzes any number of variants.

**Q: Does it auto-select the winner?**
The /analyze endpoint identifies the winner and provides confidence levels. Add auto-scaling logic to promote the winner automatically.


## Related Examples

- [RCS Rich Card Product Catalog](../rcs-rich-card-product-catalog-python/)
- [Number Reputation Monitor Auto Rotate](../number-reputation-monitor-auto-rotate-python/)
- [SMS Chatbot With Conversation Memory](../sms-chatbot-with-conversation-memory-python/)
