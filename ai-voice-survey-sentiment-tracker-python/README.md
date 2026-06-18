# AI Voice Survey Sentiment Tracker

## What Does This Example Do?

Inbound voice surveys where AI analyzes not just what people say but how they say it. Real-time sentiment scoring per response, emotion detection, and aggregate CSAT tracking across all survey calls.

## Who Is This For?

- CX teams measuring customer satisfaction via voice.
- Market researchers conducting qualitative voice surveys.
- Product teams gathering emotional feedback on features.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. Voice survey + real-time AI sentiment analysis on one platform. Sentiment analyzed during the call, not from a transcript hours later.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-voice-survey-sentiment-tracker-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| Voice API | Survey call handling |
| Inference | Sentiment analysis and emotion detection |
| SMS | Follow-up or thank-you messages |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: Can it detect sarcasm?**
The AI identifies sentiment patterns including mixed signals. Sarcasm detection improves with model quality.

**Q: How is this different from a post-call survey?**
This captures sentiment in real-time during an open conversation, not just a 1-5 rating after the fact.


## Related Examples

- [Multi Language Customer Survey](../multi-language-customer-survey-python/)
- [Real Time Call Intelligence Dashboard](../real-time-call-intelligence-dashboard-python/)
