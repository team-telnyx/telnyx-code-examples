# AI Avatar Conversation Desk — A Developer's Walkthrough

This guide walks you through `avatar-desk`, a Flask sample that gives a Telnyx AI Assistant a face. You upload one portrait, Telnyx turns it into a **custom avatar**, the assistant picks it up through `avatar_settings`, and a server-side conversation WebSocket opens with `avatar=true` so the assistant speaks while its avatar lip-syncs.

By the end you will have run the full BETA avatar lifecycle — create, wire, session — and exercised both documented failure paths: the fatal missing-media handshake (`1011`) and the recoverable rendering error that falls back to voice-only.

---

## 1. What you're building

Three pieces make up the desk, and each has a single job.

**The avatar service** (`POST /v2/ai/avatars`) is Telnyx's storage for the portrait. You upload an image, you get back an avatar ID, and the rendering model `foxtrot-1` (selected via `avatar_settings.model`) turns that portrait into the animated face.

**The assistant** is one Telnyx AI Assistant whose `avatar_settings` points at that avatar ID. The provider stays `telnyx` no matter which TTS vendor you use — and this sample pairs a Telnyx TTS voice, because third-party TTS (ElevenLabs, etc.) is **not supported with avatars**.

**The session process** is the Flask app (or its CLI twin): it opens the server-side WebSocket with your Telnyx API v2 key in the `Authorization` header, sends `session.update` first, drives the signaling handshake, streams PCM in, and receives the assistant's reply audio — plus, once media is ready, the avatar's video feed — out.

The demo flow, end to end:

```text
1.  create-avatar   validates the image, uploads it as multipart/form-data
                    to POST /v2/ai/avatars with the image_file field, and
                    prints data.id. The script asserts the ID is used —
                    not data.image_url — so wiring cannot misconfigure.
2.  wire-assistant  creates (or updates) an assistant with
                    avatar_settings: {provider: "telnyx", model: "foxtrot-1",
                    avatar_id: <id>}, then reads the config back with
                    GET /v2/ai/assistants/{id} and prints it.
3.  avatar-session  opens the conversation WebSocket
                    (wss://api.telnyx.com/v2/ai/assistants/{assistant_id}/conversation
                    ?avatar=true&input_sample_rate=16000), sends session.update
                    as the FIRST frame, waits for session.created, and feeds a
                    10-second PCM clip as input.
4.  The script runs the avatar signaling exchange: it answers the WebRTC
    signaling frames and sends avatar.media.ready once its media receiver is
    ready. From then on it prints synchronized audio+video state events.
5.  Failure demo A: --break-media skips avatar.media.ready, so the WebSocket
    closes with 1011 before session.created and the script prints the
    post-mortem.
6.  Failure demo B: --inject-error simulates a NON-fatal avatar.error. The
    script stops WebRTC playback, keeps the mic open, and switches to the
    WebSocket response.output_audio.delta frames — the documented voice-only
    fallback — printing which path is live at each step.
```

---

## 2. Prerequisites

- **Python 3.10+** (the code uses `X | Y` union syntax and `from __future__ import annotations`).
- A **Telnyx account** with an API v2 key. Create one in the [Telnyx Portal](https://portal.telnyx.com).
- A **portrait image** that satisfies the avatar constraints (see §4).
- Optional: a Telnyx AI Assistant already created, if you want to update rather than create one.

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

| Variable | Purpose | Default |
| --- | --- | --- |
| `TELNYX_API_KEY` | Your Telnyx API v2 key. Required in live mode. | *(none)* |
| `DEMO_MODE` | `true` runs the whole lifecycle against an in-process simulator — no uploads, no WebSocket, no charges. | `true` |
| `PORT` | Flask bind port. | `5000` |
| `AVATAR_ID` | Avatar ID to reuse in `wire-assistant` / `avatar-session` CLI steps. | *(none)* |
| `ASSISTANT_ID` | Assistant ID to update instead of create. | *(none)* |
| `ASSISTANT_NAME` | Name for the assistant. | `Avatar Desk Assistant` |
| `ASSISTANT_MODEL` | LLM backing the assistant. | `meta-llama/Meta-Llama-3.1-8B-Instruct` |
| `TELNYX_TTS_VOICE` | Telnyx TTS voice. **Must be a Telnyx voice** — third-party TTS is unsupported with avatars. | `Telnyx.KokoroTTS.af` |

### Demo mode vs live mode

`DEMO_MODE` defaults to `true`, and that is deliberate: the sample must be safe to run without spending money or uploading anything.

- **Demo mode (`DEMO_MODE=true`)** — `create_avatar` logs the multipart request it *would* send and returns a synthetic `avatar_demo_0001`. `wire_assistant` returns a synthetic assistant record. `run_avatar_session` still drives the real frame-handshake logic, but you can exercise the fatal and fallback paths without a live avatar. Nothing leaves your machine.
- **Live mode (`DEMO_MODE=false`)** — every step hits the real Telnyx API. `create_avatar` performs the multipart upload, `wire_assistant` writes the assistant and reads it back, and `run_avatar_session` opens the real `wss://api.telnyx.com/v2/...` socket with your key in the `Authorization` header.

Flip the switch by editing `.env`:

```bash
DEMO_MODE=false
```

---

## 4. Step 1 — Create the avatar

The first job is turning a portrait into an avatar ID. Everything about this step lives in the image-validation helpers and `create_avatar` in `app.py`.

### The validator

Before a single byte is uploaded, `validate_avatar_image` checks the portrait against the documented constraints:

- **Format** — JPEG, PNG, or WebP. The check accepts either a matching MIME type or a matching file extension.
- **Size** — max **10 MiB**.
- **Dimensions** — **256–8192 px** per side, and no more than **40 MP** total.

The dimensions come from `_sniff_image_size`, which reads the header bytes directly rather than trusting the client: PNG via the IHDR chunk, JPEG by walking segments to the SOF marker, WebP via the VP8X/VP8 chunk. If the header can't be parsed, the validator rejects the file as corrupt or unsupported.

`validate_avatar_name` enforces the **1–255 character** name constraint.

### The upload

`create_avatar` reads the file, infers the MIME type from the extension, validates, then POSTs to `/v2/ai/avatars` as `multipart/form-data` with the `image_file` field and the `name` field.

The important part is what happens to the response:

```python
avatar_id = payload.get("id")
if not avatar_id:
    raise RuntimeError("avatar response missing data.id")
# Acceptance criterion: wiring must use data.id, never data.image_url.
if payload.get("image_url") and avatar_id == payload.get("image_url"):
    raise AssertionError("avatar id must not be the image_url")
```

The script asserts that `data.id` is what you carry forward. `data.image_url` is a display URL — wiring it into `avatar_settings.avatar_id` will silently misconfigure the assistant, so the sample fails loudly instead.

### Running it

CLI:

```bash
python app.py --step create-avatar --image ./portrait.png --name "Desk Portrait"
```

HTTP:

```bash
curl -F "image_file=@./portrait.png" -F "name=Desk Portrait" \
  http://localhost:5000/avatars
```

Either way you get back the avatar record with its `id`. Keep that ID — it is the only thing the next step needs.

---

## 5. Step 2 — Wire the assistant

`wire_assistant` in `app.py` is where the avatar meets the assistant. It builds the assistant body and, crucially, the `avatar_settings` block:

```python
"avatar_settings": {
    "provider": AVATAR_PROVIDER,   # "telnyx"
    "model": AVATAR_MODEL,         # "foxtrot-1"
    "avatar_id": avatar_id,
}
```

Two rules are enforced here:

1. **`avatar_id` must be the avatar's `data.id`.** The function rejects anything that looks like a URL (`avatar_id.startswith("http")`) with a clear `ValueError`. This is the same guardrail as step 1, applied at the point of use.
2. **The voice must be a Telnyx TTS voice.** `voice_settings.voice` is read from `TELNYX_TTS_VOICE` and defaults to `Telnyx.KokoroTTS.af`. Third-party TTS providers are not supported with avatars — the provider field stays `telnyx` regardless.

If you pass an `assistant_id`, the function POSTs to `/v2/ai/assistants/{assistant_id}` to update; otherwise it POSTs to `/v2/ai/assistants` to create. Then it **reads the config back** with `GET /v2/ai/assistants/{id}` and returns that — so you see exactly what Telnyx stored, not what you hoped it stored.

### Running it

CLI:

```bash
python app.py --step wire-assistant --avatar-id avatar_demo_0001
```

HTTP:

```bash
curl -X POST http://localhost:5000/assistants \
  -H "Content-Type: application/json" \
  -d '{"avatar_id": "avatar_demo_0001"}'
```

The response includes the assistant `id` and the `avatar_settings` block. Note the assistant ID — the session step needs it.

---

## 6. Step 3 — Run the avatar session

This is the hard part, and the reason the sample exists. `run_avatar_session` in `app.py` drives the conversation WebSocket.

### The connection

```python
url = (
    f"{TELNYX_WS_BASE}/ai/assistants/{assistant_id}/conversation"
    f"?avatar=true&input_sample_rate=16000"
)
```

The `avatar=true` query parameter is what turns a normal realtime conversation into an avatar session. `input_sample_rate=16000` matches the PCM you stream in.

### The frame order — `session.update` first

The very first frame on the socket is always `session.update`:

```python
await ws.send(json.dumps({
    "type": "session.update",
    "session": {"input_audio_format": "pcm16", "output_audio_format": "pcm16"},
}))
log.append("sent session.update (first frame)")
```

The event log records this, and the returned `session_update_first` flag proves it — the acceptance criterion is that `session.update` is the first frame, and the log is the evidence.

### The signaling handshake

Once the socket is open, the server sends WebRTC signaling frames. The script answers each one:

```python
elif ftype.startswith("avatar.signaling"):
    await ws.send(json.dumps({"type": "avatar.signaling.answer",
                              "sdp": frame.get("sdp", "")}))
    log.append("answered avatar signaling frame")
```

When the local media receiver is ready, the script sends `avatar.media.ready`. That is the signal the server waits for before it will emit `session.created`.

> **Scope note:** a full WebRTC peer (the thing that actually renders the video) is out of scope for a Flask sample. This sample answers the signaling frames and sends `avatar.media.ready`; the browser tab or headless peer that consumes the avatar video is the piece you'd add on the client side.

### The audio path

While the avatar is active, the WebSocket's `response.output_audio.delta` frames are **suppressed** — the avatar's own audio track is what you hear, so you never get double audio. The log distinguishes the two:

```python
elif ftype == "response.output_audio.delta":
    log.append("audio delta (voice-only path)" if fallback_active
               else "audio delta (avatar active, suppressed)")
```

### Running it

CLI:

```bash
python app.py --step avatar-session --assistant-id assistant_demo_0001
```

HTTP:

```bash
curl -X POST http://localhost:5000/session \
  -H "Content-Type: application/json" \
  -d '{"assistant_id": "assistant_demo_0001"}'
```

The response is the event log plus four booleans: `session_update_first`, `media_ready_before_session_created`, `fallback_active`, and `fatal_1011`.

---

## 7. Failure demo A — the fatal missing-media handshake

Skip `avatar.media.ready` and the server has no media receiver to talk to. The documented behavior is a WebSocket close with code **`1011`** *before* `session.created` ever arrives.

```bash
python app.py --step avatar-session --assistant-id assistant_demo_0001 --break-media
```

In the code, `break_media=True` means the `avatar.media.ready` branch never sets `media_ready_sent`. When `session.created` then arrives, the script detects the violation and closes:

```python
if ftype == "session.created":
    session_created_seen = True
    if not media_ready_sent:
        log.append("FATAL: session.created before avatar.media.ready")
        await ws.close(code=1011)
        break
```

The returned log ends with the post-mortem, and `fatal_1011` is `true`. This is the taxonomy you want to encode in your own client: **a `1011` close before `session.created` means the media handshake never completed** — check that you sent `avatar.media.ready` after answering the signaling frames.

---

## 8. Failure demo B — the recoverable rendering error

Not every avatar failure is fatal. A non-fatal `avatar.error` means the rendering pipeline hiccuped but the conversation can continue — you just lose the face.

```bash
python app.py --step avatar-session --assistant-id assistant_demo_0001 --inject-error
```

The handler branches on the `fatal` flag:

```python
elif ftype == "avatar.error":
    fatal = bool(frame.get("fatal", False))
    if fatal:
        log.append("avatar.error fatal -> closing")
        await ws.close(code=1011)
        break
    fallback_active = True
    log.append("avatar.error non-fatal -> voice-only fallback")
```

On a **non-fatal** error the socket stays open, `fallback_active` flips to `true`, and the script switches to consuming `response.output_audio.delta` frames — the documented voice-only fallback. The mic stays open, the conversation continues, and the log tells you which path is live at each step.

On a **fatal** error the socket closes with `1011`, same as the missing-media case.

The distinction matters for your client: a non-fatal `avatar.error` should degrade gracefully to audio; a fatal one (or a `1011` before `session.created`) should tear down and reconnect.

---

## 9. The 30-second scripted turn

For a one-take recording, the demo turn is *"book a table for two."* The assistant's default instructions in `wire_assistant` set it up as a friendly restaurant host with short, spoken replies — so the loop is:

1. You speak (or the 10-second PCM clip plays): *"Hi, I'd like to book a table for two."*
2. The assistant replies in a Telnyx TTS voice while the avatar lip-syncs.
3. You hear the reply once — the WebSocket audio deltas are suppressed while the avatar is active.

That's the full loop: portrait → avatar → assistant → synchronized speech and face.

---

## 10. Pricing — read this before November

Avatars are **included during October 2026**. From **November 1, 2026**, avatar rendering is **$0.08/minute**, on top of standard AI Assistant call pricing. Budget for it if you're shipping anything that runs long sessions.

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `TELNYX_API_KEY is not set` | Missing key in `.env` | Set `TELNYX_API_KEY`, or leave `DEMO_MODE=true`. |
| `image must be JPEG, PNG, or WebP` | Wrong format | Convert the portrait; check the extension *and* the MIME type. |
| `image exceeds 10 MiB limit` | File too large | Downscale before upload. |
| `width ... outside 256-8192px` | Bad dimensions | Resize so both sides are in range. |
| `could not read image dimensions` | Corrupt or unsupported file | Re-export the image. |
| `avatar_id must be the avatar data.id, not an image URL` | You wired `data.image_url` | Use `data.id` from the create step. |
| Socket closes `1011` before `session.created` | `avatar.media.ready` never sent | Answer the signaling frames, then send `avatar.media.ready`. |
| You hear the reply twice | Avatar active *and* audio deltas playing | Suppress `response.output_audio.delta` while the avatar is live. |
| Avatar never appears | No WebRTC peer consuming the video | Add a browser tab or headless peer as the media receiver. |

---

## 12. Next steps

- [AI Assistant avatars](https://developers.telnyx.com/docs/inference/ai-assistants/avatars) — the reference page for the whole avatar surface, including the signaling handshake.
- [Create a custom avatar](https://developers.telnyx.com/api-reference/avatars/create-a-custom-avatar) — the `POST /v2/ai/avatars` endpoint in detail.
- [List avatars](https://developers.telnyx.com/api-reference/avatars/list-avatars) and [Get an avatar](https://developers.telnyx.com/api-reference/avatars/get-an-avatar) — manage the portraits you've uploaded.
- [Update an assistant](https://developers.telnyx.com/api-reference/assistants/update-an-assistant) — the `avatar_settings` write path.
- [Talk to an AI assistant over WebSocket](https://developers.telnyx.com/api-reference/websockets/talk-to-an-ai-assistant-over-websocket) — the frame protocol, including `session.update`, `avatar.media.ready`, and `avatar.error`.
- [Realtime conversations guide](https://developers.telnyx.com/docs/inference/ai-assistants/realtime-conversations) — the broader realtime conversation model this session builds on.

Once you've run the loop, the natural next step is building the WebRTC peer that renders the avatar video — the one piece this Flask sample deliberately leaves to the client.
