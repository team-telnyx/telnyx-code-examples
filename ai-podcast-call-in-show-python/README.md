# AI Podcast Call-In Show

## What Does This Example Do?

Listeners call a number, AI screens them (name, topic, topic quality), approved callers enter a queue, and the host manages who goes live. Real-time caller management for live shows.

## Who Is This For?

- Podcast hosts wanting live call-in segments.
- Radio stations modernizing their call-in systems.
- Event organizers running live Q&A sessions.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. PSTN call handling + AI screening + queue management on one platform. No studio phone system or producer needed for screening.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-podcast-call-in-show-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| Voice API | Inbound call handling and queue |
| Inference | Caller screening and topic evaluation |
| SMS | Queue position updates |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: Can it bridge callers to a live stream?**
Yes. Use Telnyx conference or multi-participant calls to bridge screened callers to the host line.

**Q: How does the host manage the queue?**
The /queue endpoint shows all approved callers. Build a simple dashboard or use the API directly.


## Related Examples

- [AI Conference Note Taker](../ai-conference-note-taker-python/)
- [Video Room AI Meeting Moderator](../video-room-ai-meeting-moderator-python/)
