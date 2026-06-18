# WebRTC AI Interpreter for Live Calls

## What Does This Example Do?

Real-time language translation during phone calls. One caller speaks English, the other hears Spanish (or any supported language pair). AI translates each utterance and speaks it via TTS.

## Who Is This For?

- International businesses with multilingual customers.
- Healthcare providers serving non-English speakers.
- Government agencies providing multilingual services.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. Real-time transcription + AI translation + TTS on one network. No interpreter service or translation API stitched together with a separate voice provider.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/webrtc-ai-interpreter-live-calls-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| Voice API | Call handling and transcription |
| Inference | Real-time translation |
| TTS | Translated speech delivery |
| WebRTC | Browser-based calling option |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: How much latency does translation add?**
Inference typically responds in under 1 second. Total turnaround is 1-3 seconds per utterance.

**Q: Which language pairs?**
Any pair supported by Telnyx STT and TTS — 20+ languages.


## Related Examples

- [Global Lead Response Engine](../global-lead-response-engine-python/)
- [Multi Language Customer Survey](../multi-language-customer-survey-python/)
- [Click To Call WebRTC With AI Assist](../click-to-call-webrtc-with-ai-assist-python/)
