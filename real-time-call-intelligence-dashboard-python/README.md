# Real-Time Call Intelligence Dashboard

## What Does This Example Do?

Fork live call audio for real-time transcription, sentiment analysis, and competitor mention detection. A manager dashboard shows all active calls with sentiment heatmaps, coaching alerts, and buying signals. When sentiment drops, the AI suggests responses for the rep. All recordings stored in Telnyx Cloud Storage with searchable transcripts.

## Who Is This For?

- Sales managers who want live visibility into rep calls.
- Revenue operations teams building real-time coaching tools.
- Contact center operators monitoring quality in real time.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. Transcription, inference, and storage run on the same network as the call.

- **Real-time pipeline** — Transcription events feed directly to inference. No third-party STT provider adding latency.
- **Cloud Storage** — Recordings stored on Telnyx infrastructure. No S3 configuration needed.
- **Single network** — Audio never leaves the Telnyx network for processing. Lower latency, better security.

## Prerequisites

- Python 3.8+
- Telnyx account with API key
- Telnyx phone number with voice enabled
- [ngrok](https://ngrok.com) for webhooks

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/real-time-call-intelligence-dashboard-python
cp .env.example .env
make setup && make run
```

Open `http://localhost:5000/dashboard` to see the live manager view.

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| Voice API | Call control, real-time transcription |
| Inference | Sentiment analysis, competitor detection, coaching suggestions |
| Cloud Storage | Recording archival |

## Complete Code

See [app.py](./app.py) for the full implementation with embedded HTML dashboard.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Dashboard empty | Make a test call to your Telnyx number while the server is running |
| No sentiment data | Sentiment analysis runs every 3 transcript segments to avoid API overload |
| Dashboard not refreshing | The page auto-refreshes every 5 seconds via meta refresh |

## FAQ

**Q: Can I add WebRTC for live audio monitoring?**
Yes. Add a WebRTC client that subscribes to the media fork stream for real-time audio in the browser.

**Q: How is this different from CallRail or Gong?**
Those analyze after the call. This shows live sentiment and coaching suggestions during the call.

## Resources

- [Voice API](https://developers.telnyx.com/docs/voice)
- [Inference](https://developers.telnyx.com/docs/inference)
- [Cloud Storage](https://developers.telnyx.com/docs/storage)

## Related Examples

- [AI Sales Call with Live CRM Updates](../ai-sales-call-with-live-crm-updates-python/)
- [Compliance Call Recorder + AI Auditor](../compliance-call-recorder-ai-auditor-python/)
- [AI Conference Note-Taker](../ai-conference-note-taker-python/)
