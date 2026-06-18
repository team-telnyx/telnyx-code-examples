# Multi-Language Customer Survey

## What Does This Example Do?

Outbound voice surveys in the caller's language. The AI translates questions on the fly, conducts the survey conversationally, and generates structured analysis with NPS scores and sentiment.

## Who Is This For?

- Customer success teams measuring satisfaction globally.
- Market research firms conducting multilingual surveys.
- Product teams gathering user feedback at scale.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. Outbound calling + real-time translation + AI analysis on one platform. No survey tool + translation service + voice provider stack.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/multi-language-customer-survey-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| Voice API | Outbound survey calls |
| Inference | Question translation and response analysis |
| Number Lookup | Country detection for language selection |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: How many languages?**
Any language supported by Telnyx TTS/STT — 20+ languages including CJK, Arabic, and European languages.

**Q: Can I customize the questions?**
Yes. Edit the SURVEY_QUESTIONS list in app.py.


## Related Examples

- [AI Voice Survey Sentiment Tracker](../ai-voice-survey-sentiment-tracker-python/)
- [Global Lead Response Engine](../global-lead-response-engine-python/)
