---
name: meeting-artifacts
title: "Meeting-Bot Artifact Desk — Join, Capture, and Mine the Meeting Record"
description: "Run a Telnyx meeting bot end-to-end: join a Google Meet, watch the session lifecycle, request async artifacts, and assemble a structured meeting record."
language: python
framework: flask
telnyx_products: [AI Assistants, Meeting Sessions, Meeting Session Artifacts, Webhooks]
---

# Meeting-Bot Artifact Desk — Join, Capture, and Mine the Meeting Record

A Python (Flask) sample that sends a Telnyx AI assistant into a Google Meet, follows the session from `waiting_for_admission` to `ended`, requests four structured artifacts asynchronously, and writes `meeting_record.md` plus `transcript.txt`.

## The Story

A regional hospital network runs a weekly clinical-ops review where nurse managers, pharmacy, and the on-call physician decide bed allocations, escalate supply shortages, and log safety concerns. Nobody takes minutes reliably, so decisions get re-litigated the following week and a missed action item can mean a delayed medication restock. The network needs a meeting record that is generated, not remembered — a summary, a list of action items with owners, the decisions that were actually made, and the questions left open. The actor IS the meeting bot. It is born when the assistant is created with a facilitator prompt and attached by ID to a session; it evolves as the session moves from `joining` to `waiting_for_admission` (where a host must admit it from the lobby) to `active`; it survives the awkward middle — the host is late, the lobby sits unapproved, the webhook receiver restarts mid-meeting — because the artifact pipeline is asynchronous and the poll fallback can reconstruct the same record from scratch. It completes when the meeting ends and `leave_on_end` fires, leaving behind four structured artifacts and a full transcript; or it terminates early with `admission_denied` or `failed`, and the report says so instead of pretending the meeting happened. The rest of this README is the API surface of that story.

## Why Telnyx

Meetings are where decisions happen, but the record of those decisions usually lives in someone's memory or a half-filled doc. Telnyx treats the meeting itself as **AI Communications Infrastructure**: the assistant is attached to a live session by ID, the session lifecycle is observable, and the artifact pipeline turns raw conversation into structured, queryable output. You get the bot, the transcript, and the record from one platform instead of stitching together a meeting SDK, a transcription vendor, and an LLM pipeline.

## Telnyx API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/v2/meeting_sessions` | Create a meeting session; attach the assistant by `id` only |
| `GET` | `/v2/meeting_sessions/{id}` | Observe lifecycle status (`joining` → `waiting_for_admission` → `active` → `leaving` → `ended`) |
| `POST` | `/v2/meeting_sessions/{id}/artifacts` | Request an artifact asynchronously (`202 Accepted`) |
| `GET` | `/v2/meeting_sessions/{id}/artifacts` | List artifacts and poll for `pending` / `completed` / `failed` |
| `GET` | `/v2/meeting_sessions/{id}/artifacts/{artifact_id}` | Fetch a single artifact's `content` or `failure_reason` |
| `GET` | `/v2/meeting_sessions/{id}/transcript` | Retrieve the full meeting transcript |
| Webhook | `session_status_changed` | Session lifecycle transitions pushed to your receiver |
| Webhook | `artifact_completed` | An artifact finished generating |
| Webhook | `artifact_failed` | An artifact could not be generated; carries `failure_reason` |

## Architecture

```text
                    ┌──────────────────────────────┐
                    │  Telnyx AI Assistant         │
                    │  (facilitator persona)       │
                    │  attached by id only         │
                    └──────────────┬───────────────┘
                                   │ assistant: {id}
                                   ▼
   ┌───────────────────────────────────────────────────────────┐
   │              Meeting Sessions API                         │
   │  POST /meeting_sessions        → session_id               │
   │  GET  /meeting_sessions/{id}   → lifecycle status         │
   │  POST /meeting_sessions/{id}/artifacts  → 202 Accepted    │
   │  GET  /meeting_sessions/{id}/artifacts  → pending/done    │
   │  GET  /meeting_sessions/{id}/transcript → full transcript │
   └───────┬───────────────────────────────────────┬───────────┘
           │                                       │
   webhook push                              poll fallback
           │                                       │
           ▼                                       ▼
   ┌───────────────────────┐            ┌──────────────────────┐
   │  Flask receiver       │            │  poll_artifacts()    │
   │  POST /webhooks/telnyx│            │  every 10s           │
   │  session_status_changed│           │  (--poll flag)       │
   │  artifact_completed   │            └──────────┬───────────┘
   │  artifact_failed      │                       │
   └───────────┬───────────┘                       │
               └───────────────┬───────────────────┘
                               ▼
                    ┌──────────────────────────┐
                    │  report writer           │
                    │  meeting_record.md       │
                    │  transcript.txt          │
                    └──────────────────────────┘
```

Four moving parts: the **assistant** (persona, attached by ID), the **Meeting Sessions API** (lifecycle + artifact pipeline), the **webhook receiver** (Flask, push path) with a **poll fallback** (identical output, no webhook), and the **report writer** (merges artifacts + transcript).

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `DEMO_MODE` | `string` | `true` | no (default `true`) | When `true`, no real bot is launched and no API calls are made | — |
| `PORT` | `string` | `5000` | no (default `5000`) | Port for the Flask webhook receiver | — |
| `TELNYX_API_KEY` | `string` | `KEY0123456789` | yes (live mode) | Authenticates every Meeting Sessions API call | Telnyx portal → API Keys |
| `TELNYX_ASSISTANT_ID` | `string` | `assistant_abc123` | yes | The AI assistant attached to the session by ID | Telnyx portal → AI Assistants |
| `TELNYX_PUBLIC_KEY` | `string` | `+1a2b3c...` | only for webhooks | Verifies Ed25519 signatures on inbound webhooks | Telnyx portal → Webhooks |
| `WEBHOOK_URL` | `string` | `https://example.com/webhooks/telnyx` | only for webhooks | Where Telnyx delivers `session_status_changed` and artifact events | Your deployment |

`DEMO_MODE=true` (the default) logs every API call it *would* make and returns synthetic session/artifact objects — no real bot joins a real meeting. Set `DEMO_MODE=false` to run live.

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/meeting-artifacts

python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# edit .env: set TELNYX_API_KEY, TELNYX_ASSISTANT_ID, TELNYX_PUBLIC_KEY, WEBHOOK_URL
```

Run the webhook receiver (terminal 1):

```bash
python app.py serve
```

Create a session and mine the artifacts (terminal 2):

```bash
python create_session.py --url "https://meet.google.com/abc-defg-hij"
```

Poll instead of using webhooks:

```bash
python create_session.py --url "https://meet.google.com/abc-defg-hij" --poll
```

Keep the bot in the meeting after the assistant stops (`leave_on_end=false`):

```bash
python create_session.py --url "https://meet.google.com/abc-defg-hij" --skip-leave
```

Demonstrate the `artifact_failed` path:

```bash
python create_session.py --url "https://meet.google.com/abc-defg-hij" --break-artifact
```

Verify the module loads and routes are wired:

```bash
python -m pytest smoke_test.py -v
```

## API Reference

See [API.md](./API.md) for the full typed endpoint reference — request/response shapes, status codes, and the artifact lifecycle. See [GUIDE.md](./GUIDE.md) for a walkthrough of the demo flow and the demo-mode/live-mode switch.

Quick summary:

- `POST /v2/meeting_sessions` — body includes `meeting_url`, `assistant: {id}`, `audio_gate` (`half_duplex` | `full_duplex`), `leave_on_end`, optional `webhook_url`, `metadata`, `dynamic_variables`, `join_at`, beta `avatar`. Legacy call-control/SIP fields (`connection_id`, `from`, `to`, `call_control_id`, `sip_uri`, `sip_username`) are rejected.
- `GET /v2/meeting_sessions/{id}` — statuses: `joining`, `waiting_for_admission`, `active`, `leaving`, `ended`, `failed`, `admission_denied`.
- `POST /
