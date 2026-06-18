# Video Room AI Meeting Moderator

## What Does This Example Do?

Create Telnyx Video rooms with AI-powered agenda tracking. Set an agenda with time allocations, and the AI moderator tracks progress, warns when topics run over, and provides status updates on demand.

## Who Is This For?

- Teams that want structured, time-boxed meetings.
- Facilitators running workshops or standups.
- Developers building video conferencing features.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. Video rooms + AI moderation on one platform. No Zoom + separate meeting management tool.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/video-room-ai-meeting-moderator-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| Video API | Video room creation and management |
| Inference | Agenda tracking and time management |
| SMS | Post-meeting action item delivery |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: Does the AI speak in the video room?**
In this version, the AI provides text-based status via API. Add TTS for spoken moderator announcements.

**Q: Can it record the meeting?**
Yes. Enable recording in the room creation call.


## Related Examples

- [AI Conference Note Taker](../ai-conference-note-taker-python/)
- [AI Podcast Call In Show](../ai-podcast-call-in-show-python/)
