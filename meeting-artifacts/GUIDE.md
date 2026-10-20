# Meeting-Bot Artifact Desk — Developer Guide

A step-by-step walkthrough of `meeting-artifacts/app.py`: how the sample creates a
Telnyx meeting session, attaches an AI assistant by ID, watches the session move
through its lifecycle, requests the four structured artifacts asynchronously, and
merges them into a meeting record.

By the end of this guide you will understand the async artifact contract
(`202 Accepted` → webhook or poll → `completed` / `failed`) and how to wire it
into your own product.

---

## 1. What you are building

A meeting bot that joins a Google Meet (or any supported meeting URL), listens,
and produces a **meeting record**:

- `summary` — what happened
- `action_items` — who owes what
- `decisions` — what was decided
- `open_questions` — what is still unresolved

Plus the full transcript. All of it lands in `meeting_record.md` and
`transcript.txt`.

The interesting part is not the bot — it is the **artifact pipeline**. Every
artifact is created asynchronously. You POST, you get a `202`, and the content
arrives later via webhook or polling. Builders routinely get this wrong by
assuming a synchronous return. This sample shows both observation paths.

---

## 2. Prerequisites

- Python 3.10+ (the code uses `dict[str, str] | None` union syntax)
- A Telnyx account with API access
- A Telnyx AI Assistant created with a facilitator persona — you only need its
  **ID**, not its config
- A meeting URL you are allowed to send a bot into
- Optional: a publicly reachable URL for webhooks (ngrok, Cloudflare Tunnel, or
  a deployed instance)

Install dependencies:

```bash
pip install -r requirements.txt
```

---

## 3. Environment setup

Copy the example env file and fill it in:

```bash
cp .env.example .env
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `TELNYX_API_KEY` | yes (live mode) | Authenticates every Meeting Sessions API call |
| `TELNYX_ASSISTANT_ID` | yes | The AI assistant attached to the session by ID |
| `TELNYX_PUBLIC_KEY` | for webhooks | Verifies Ed25519 signatures on inbound webhooks |
| `WEBHOOK_URL` | for webhooks | Where Telnyx delivers `session_status_changed` and artifact events |
| `DEMO_MODE` | no (default `true`) | When `true`, no real bot is launched and no API calls are made |
| `PORT` | no (default `5000`) | Port for the Flask webhook receiver |

`app.py` loads these with `load_dotenv()` at import time and reads them into
module-level constants. Nothing is hardcoded.

---

## 4. Demo mode vs live mode

**Demo mode is on by default.** `DEMO_MODE=true` means:

- `create_meeting_session` logs the exact payload it *would* POST and returns a
  synthetic session (`demo-session-0001`, status `joining`).
- `get_meeting_session` returns `active` immediately.
- `request_artifact` logs the request and returns a `pending` artifact.
- `list_artifacts` returns four synthetic `completed` artifacts.
- `get_transcript` returns a placeholder transcript.

You can run the entire flow — create, poll, report — with zero credentials and
zero cost. This is the mode the smoke test uses.

**To go live**, set `DEMO_MODE=false` in `.env` and provide a real
`TELNYX_API_KEY` and `TELNYX_ASSISTANT_ID`. Every `DEMO_MODE` branch in the code
is a single `if` guard, so the transition is one env var.

> The `audio_gate` cost note matters here. `half_duplex` (the default) is one
> stream. `full_duplex` opens a per-participant stream and multiplies the
> per-minute cost by the number of participants. Start with `half_duplex`.

---

## 5. The four moving parts

### 5.1 The assistant

The assistant is a Telnyx AI Assistant with a facilitator persona. The Meeting
service connects it **directly**, so the sample attaches it by ID only:

```python
payload["assistant"] = {"id": ASSISTANT_ID}
```

The older call-control / SIP fields (`connection_id`, `from`, `to`,
`call_control_id`, `sip_uri`, `sip_username`) are rejected as unknown fields by
the API. The module defines them as `LEGACY_FIELDS` so the sample can call them
out explicitly — if you are porting an older meeting-bot demo, this is the
migration note.

### 5.2 The Meeting Sessions API

Owns the bot lifecycle:

```
joining → waiting_for_admission → active → leaving → ended
```

with `failed` and `admission_denied` as unhappy terminals.

It also owns the artifact pipeline. Every artifact is created asynchronously,
accepted with a `202`, and delivered later as `pending`, `completed`, or
`failed`.

### 5.3 The webhook receiver

A Flask app exposing `POST /webhooks/telnyx`. It verifies the Ed25519 signature
with `telnyx.Webhook.construct_event`, reads the event type from
`data.event_type`, and logs `session_status_changed`, `artifact_completed`, and
`artifact_failed`. On `artifact_failed` it surfaces `failure_reason` at warning
level.

### 5.4 The report writer

Merges the four artifacts plus the transcript into `meeting_record.md` and
`transcript.txt`.

---

## 6. Walking the code

### 6.1 The API client wrapper

Near the top of `app.py`, `_client()` returns a `telnyx.Telnyx` instance. The
meeting-session helpers (`create_meeting_session`, `get_meeting_session`,
`request_artifact`, `list_artifacts`, `get_transcript`) are thin wrappers over
`client.request(...)` because the SDK may not yet expose typed meeting-session
methods. The endpoint paths and payloads match the API reference exactly.

Each wrapper has a `DEMO_MODE` guard at the top that logs and returns a
synthetic response.

### 6.2 Creating the session

`create_meeting_session` builds the payload:

- `meeting_url` — the meeting to join
- `assistant: {id}` — attached by ID only
- `audio_gate` — `half_duplex` by default
- `leave_on_end` — `true` by default, so the bot leaves when the meeting ends
- `webhook_url` — included only if `WEBHOOK_URL` is set
- `dynamic_variables` — validated against the reserved keys before sending

The reserved-key check is important:

```python
RESERVED_DYNAMIC_VARS = {"streaming_audio", "ai_assistant_streaming_audio", "meeting_session_id"}
```

If you pass any of these, the API rejects the request with
`400 invalid_request`. The sample catches it client-side with a clear message
instead of letting the API round-trip fail. `dynamic_variables` accepts up to 63
entries, keys 1–128 chars, string values only. The sample passes
`{visitor_name}` so the assistant's greeting resolves before its first
utterance.

### 6.3 Watching the lifecycle

`wait_for_active` polls `GET /meeting_sessions/{id}` every 5 seconds until the
status leaves `joining` / `waiting_for_admission`. It logs every transition.

Two details:

- When the status is `waiting_for_admission`, it prints the lobby hint — the
  host has to admit the bot from the meeting lobby.
- If the status becomes `ended`, `failed`, or `admission_denied`, it returns
  immediately. `_cmd_create` treats `admission_denied` as a hard stop and prints
  the lobby hint.

### 6.4 Requesting artifacts

Right after `active`, `_cmd_create` loops over `ARTIFACT_TYPES` and calls
`request_artifact` for each:

```python
ARTIFACT_TYPES = ["summary", "action_items", "decisions", "open_questions"]
```

Each call is a `POST /meeting_sessions/{id}/artifacts` with `{"type": ...}`. The
API returns `202 Accepted` with a `pending` artifact. **The content is not in
the response.** That is the whole point of the sample.

The valid types are `summary`, `action_items`, `decisions`, `topics`,
`open_questions`, and `custom`. `request_artifact` validates against this list
before sending.

### 6.5 Two observation paths

**Webhook path (default).** Run `python app.py serve` in one terminal. Telnyx
delivers `session_status_changed`, `artifact_completed`, and `artifact_failed`
to `POST /webhooks/telnyx`. The receiver verifies the signature and logs the
event. This is the production path.

**Poll path (`--poll`).** `poll_artifacts` reads
`GET /meeting_sessions/{id}/artifacts` every 10 seconds until every artifact is
`completed` or `failed`. This is the no-webhook fallback and produces the
identical report. Use it when you cannot expose a public URL.

Both paths converge on the same `artifacts` list, so `write_report` does not
care which one ran.

### 6.6 Writing the report

`write_report` indexes the artifacts by type, then emits one section per type in
`ARTIFACT_TYPES` order. If an artifact's status is `failed`, it writes the
`failure_reason` instead of content:

```python
if art.get("status") == "failed":
    lines.append(f"**FAILED**: {art.get('failure_reason', 'unknown')}")
```

It then writes `meeting_record.md` and `transcript.txt` (from
`GET /meeting_sessions/{id}/transcript`) to the working directory.

### 6.7 The `--break-artifact` path

`python app.py create --url ... --break-artifact` requests an artifact type the
meeting content cannot support, so the API returns `artifact_failed` with a
`failure_reason`. The report renders that reason in place of content. This is
how you verify your failure handling without waiting for a real failure.

### 6.8 The `--skip-leave` variant

`leave_on_end` defaults to `true`. `--skip-leave` sets it to `false`, so the bot
stays in the meeting after the assistant stops. Use `leave_on_end: true` for
fire-and-forget bots; use `false` when you want the bot to keep capturing after
the assistant finishes its scripted portion.

---

## 7. Running the sample

### Demo mode (no credentials, no cost)

```bash
# Create a session and mine artifacts (synthetic)
python app.py create --url "https://meet.google.com/abc-defg-hij"

# Same, but exercise the poll path
python app.py create --url "https://meet.google.com/abc-defg-hij" --poll

# Exercise the artifact_failed rendering
python app.py create --url "https://meet.google.com/abc-defg-hij" --break-artifact

# Run the webhook receiver
python app.py serve
```

Check `meeting_record.md` and `transcript.txt` in the working directory.

### Live mode

1. Set `DEMO_MODE=false` in `.env`.
2. Set `TELNYX_API_KEY` and `TELNYX_ASSISTANT_ID`.
3. If using webhooks, set `WEBHOOK_URL` and `TELNYX_PUBLIC_KEY`, and start the
   receiver first:

```bash
python app.py serve
```

4. In another terminal:

```bash
python app.py create --url "https://meet.google.com/abc-defg-hij"
```

5. Admit the bot from the meeting lobby when prompted.

### Smoke test

```bash
python smoke_test.py
```

This imports `app.py`, verifies the Flask routes are registered, and confirms
the module loads without error. It runs in demo mode.

---

## 8. Troubleshooting

**`TELNYX_ASSISTANT_ID is required`** — the assistant is attached by ID only.
Create an assistant in the Telnyx portal and put its ID in `.env`.

**`reserved dynamic_variables keys rejected`** — you passed one of
`streaming_audio`, `ai_assistant_streaming_audio`, or `meeting_session_id`.
Rename your key.

**Session stuck in `waiting_for_admission`** — the host has not admitted the
bot. The sample prints the lobby hint. Ask the host to admit it, or use a
meeting where the bot is auto-admitted.

**`admission_denied`** — the host explicitly rejected the bot. The sample exits
with code 1 and prints the lobby hint.

**Artifacts stay `pending` forever** — the meeting has not produced enough
content, or the meeting has not ended. Artifacts finalize when the meeting ends
and `leave_on_end` fires.

**Webhook signature verification fails** — check that `TELNYX_PUBLIC_KEY` is
set and matches the key Telnyx is signing with. The receiver returns `400` on
failure and logs the exception.

**`full_duplex` cost surprise** — `full_duplex` opens a per-participant stream
and multiplies the per-minute cost by participant count. Use `half_duplex`
unless you need the extra fidelity.

---

## 9. Next steps

- [Meeting bots quick start](https://developers.telnyx.com/docs/meeting/quick-start)
- [Meetings with AI assistants](https://developers.telnyx.com/docs/meeting/ai-assistants)
- [Meeting webhooks](https://developers.telnyx.com/docs/meeting/webhooks)
- [Create a meeting session](https://developers.telnyx.com/api-reference/meeting-sessions/create-a-meeting-session)
- [Create a meeting session artifact](https://developers.telnyx.com/api-reference/meeting-session-artifacts/create-a-meeting-session-artifact)
- [List meeting session artifacts](https://developers.telnyx.com/api-reference/meeting-session-artifacts/list-meeting-session-artifacts)
- [session_status_changed webhook](https://developers.telnyx.com/api-reference/meeting-session-webhooks/sessionstatus_changed)
- [artifact_completed webhook](https://developers.telnyx.com/api-reference/meeting-session-webhooks/artifactcompleted)
- [Meeting sessions list](https://developers.telnyx.com/api-reference/meeting-sessions/list-meeting-sessions)

Ideas to extend the sample:

- Persist artifacts to a database and build a searchable meeting archive.
- Chain the `summary` artifact into a follow-up email via the Messaging API.
- Use `join_at` to schedule the bot for a recurring meeting.
- Add a `custom` artifact type with your own prompt.
- Replace the poll fallback with a durable queue consumer for production.
