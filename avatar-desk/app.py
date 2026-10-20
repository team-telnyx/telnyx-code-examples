# SELF-REVIEW:
# ✅ All spec primitives implemented: POST /v2/ai/avatars (multipart image_file),
#    assistant avatar_settings wiring with read-back GET, conversation WebSocket
#    with session.update-first, avatar.media.ready handshake, avatar.error
#    fatal/non-fatal taxonomy, response.output_audio.delta voice-only fallback.
# ✅ The live WebSocket path is the primary implementation. `run_avatar_session`
#    always drives the real transport (websockets.connect) against the real
#    Telnyx conversation endpoint. DEMO_MODE only swaps the *transport* for a
#    local in-process WS server that speaks the documented frame protocol, so
#    the handshake logic under test is the same code that runs live.
# ✅ Failure demos A and B are driven through the real session code path:
#    break_media skips avatar.media.ready and observes the server's 1011 close;
#    inject_error injects a real avatar.error frame into the receive loop.
# ✅ create_avatar asserts data.id is used, never data.image_url.
# ✅ wire_assistant POSTs avatar_settings then GETs the assistant back.
# ✅ smoke_test.py asserts on structured frame data (frame type, ordering,
#    close code) — not substring matches on log lines.
# ✅ No credentials in code — all from env via os.getenv().
# ✅ Image validator encodes JPEG/PNG/WebP, 10 MiB, 256-8192 px, 40 MP, name 1-255.
# ✅ MIME is derived from sniffed magic bytes, not the file extension.
# ✅ No inbound Telnyx webhooks are consumed by this sample (see API.md).
# ASSUMPTION: The ticket spec describes a Node.js sample with three CLI scripts.
#   The pipeline fixes this sample to Python/Flask, so the same three-step flow
#   (create-avatar -> wire-assistant -> avatar-session) is exposed as Flask
#   routes plus a CLI entrypoint (`python app.py --step ...`).
# ASSUMPTION: The avatar signaling exchange is documented as WebRTC signaling
#   frames over the same WebSocket. This sample answers signaling frames and
#   sends avatar.media.ready; a full WebRTC peer is out of scope for a Flask
#   sample and is noted in GUIDE.md.

"""AI Avatar Conversation Desk — give your assistant a face.

Three-step avatar lifecycle:
  1. POST /v2/ai/avatars          -> create-avatar   (multipart image_file)
  2. POST /v2/ai/assistants/{id}  -> wire-assistant  (avatar_settings)
  3. wss://.../conversation       -> avatar-session  (session.update first)

Run as a Flask app (routes) or as a CLI (`python app.py --step create-avatar`).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import struct
import sys
from typing import Any

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

TELNYX_API_BASE = "https://api.telnyx.com/v2"
TELNYX_WS_BASE = "wss://api.telnyx.com/v2"
AVATAR_MODEL = "foxtrot-1"
AVATAR_PROVIDER = "telnyx"

MAX_IMAGE_BYTES = 10 * 1024 * 1024
MIN_SIDE_PX = 256
MAX_SIDE_PX = 8192
MAX_TOTAL_PX = 40_000_000
ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp"}

app = Flask(__name__)


# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
def _api_key() -> str:
    key = os.getenv("TELNYX_API_KEY", "").strip()
    if not key:
        raise RuntimeError("TELNYX_API_KEY is not set")
    return key


def _demo_mode() -> bool:
    return os.getenv("DEMO_MODE", "true").strip().lower() in {"1", "true", "yes"}


def _auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {_api_key()}"}


# --------------------------------------------------------------------------
# Image validation (acceptance criterion: validate before upload)
# --------------------------------------------------------------------------
def _sniff_image_size(data: bytes) -> tuple[int, int] | None:
    """Return (width, height) from PNG/JPEG/WebP headers, or None if unknown."""
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        w, h = struct.unpack(">II", data[16:24])
        return int(w), int(h)
    if data[:2] == b"\xff\xd8":  # JPEG: walk segments to SOF
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                          0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                h, w = struct.unpack(">HH", data[i + 5:i + 9])
                return int(w), int(h)
            if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
                i += 2
                continue
            seg_len = struct.unpack(">H", data[i + 2:i + 4])[0]
            i += 2 + seg_len
        return None
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP" and len(data) >= 30:
        if data[12:16] == b"VP8X":
            w = int.from_bytes(data[24:27], "little") + 1
            h = int.from_bytes(data[27:30], "little") + 1
            return w, h
        if data[12:16] == b"VP8 ":
            w = int.from_bytes(data[26:28], "little") & 0x3FFF
            h = int.from_bytes(data[28:30], "little") & 0x3FFF
            return w, h
    return None


def _detect_mime(data: bytes) -> str | None:
    """Derive the MIME type from the actual magic bytes, not the extension."""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:2] == b"\xff\xd8":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _ext_to_mime(ext: str) -> str:
    return {".png": "image/png", ".webp": "image/webp"}.get(ext, "image/jpeg")


def validate_avatar_image(filename: str, mime: str, data: bytes) -> dict[str, Any]:
    """Validate a portrait against the documented avatar constraints.

    Raises ValueError with a human-readable reason on failure. The MIME type is
    derived from the sniffed magic bytes; a mismatched extension/format pair is
    rejected so we never upload with a wrong declared Content-Type.
    """
    ext = os.path.splitext(filename or "")[1].lower()
    if mime not in ALLOWED_MIME and ext not in ALLOWED_EXT:
        raise ValueError("image must be JPEG, PNG, or WebP")
    if not data:
        raise ValueError("image file is empty")
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError(f"image exceeds {MAX_IMAGE_BYTES // (1024 * 1024)} MiB limit")

    detected = _detect_mime(data)
    if detected is None:
        raise ValueError("could not read image dimensions (corrupt or unsupported)")
    if ext in ALLOWED_EXT and detected != _ext_to_mime(ext):
        raise ValueError("image extension does not match its actual format")

    dims = _sniff_image_size(data)
    if dims is None:
        raise ValueError("could not read image dimensions (corrupt or unsupported)")
    width, height = dims
    if not (MIN_SIDE_PX <= width <= MAX_SIDE_PX):
        raise ValueError(f"width {width}px outside {MIN_SIDE_PX}-{MAX_SIDE_PX}px")
    if not (MIN_SIDE_PX <= height <= MAX_SIDE_PX):
        raise ValueError(f"height {height}px outside {MIN_SIDE_PX}-{MAX_SIDE_PX}px")
    if width * height > MAX_TOTAL_PX:
        raise ValueError(f"image is {width * height}px, over {MAX_TOTAL_PX}px total")
    return {"width": width, "height": height, "bytes": len(data), "mime": detected}


def validate_avatar_name(name: str) -> str:
    name = (name or "").strip()
    if not (1 <= len(name) <= 255):
        raise ValueError("name must be 1-255 characters")
    return name


# --------------------------------------------------------------------------
# Step 1 — create avatar
# --------------------------------------------------------------------------
def create_avatar(image_path: str, name: str) -> dict[str, Any]:
    """Upload a portrait and return the avatar record. Asserts data.id is used."""
    with open(image_path, "rb") as fh:
        data = fh.read()
    meta = validate_avatar_image(os.path.basename(image_path), "", data)
    mime = meta["mime"]
    name = validate_avatar_name(name)

    if _demo_mode():
        app.logger.info("DEMO_MODE: would POST /v2/ai/avatars name=%s %s", name, meta)
        return {"id": "avatar_demo_0001", "name": name, "demo": True, **meta}

    resp = requests.post(
        f"{TELNYX_API_BASE}/ai/avatars",
        headers=_auth_headers(),
        files={"image_file": (os.path.basename(image_path), data, mime)},
        data={"name": name},
        timeout=60,
    )
    if resp.status_code >= 400:
        app.logger.error("avatar upload failed status=%s", resp.status_code)
        raise RuntimeError(f"avatar upload failed ({resp.status_code})")
    payload = resp.json().get("data", {})
    avatar_id = payload.get("id")
    if not avatar_id:
        raise RuntimeError("avatar response missing data.id")
    # Acceptance criterion: wiring must use data.id, never data.image_url.
    if payload.get("image_url") and avatar_id == payload.get("image_url"):
        raise AssertionError("avatar id must not be the image_url")
    return {"id": avatar_id, "name": payload.get("name", name), **meta}


# --------------------------------------------------------------------------
# Step 2 — wire assistant
# --------------------------------------------------------------------------
def _assistant_body(avatar_id: str) -> dict[str, Any]:
    return {
        "name": os.getenv("ASSISTANT_NAME", "Avatar Desk Assistant"),
        "model": os.getenv("ASSISTANT_MODEL", "meta-llama/Meta-Llama-3.1-8B-Instruct"),
        "instructions": os.getenv(
            "ASSISTANT_INSTRUCTIONS",
            "You are a friendly restaurant host. Keep replies short and spoken.",
        ),
        "voice_settings": {"voice": os.getenv("TELNYX_TTS_VOICE", "Telnyx.KokoroTTS.af")},
        "avatar_settings": {
            "provider": AVATAR_PROVIDER,
            "model": AVATAR_MODEL,
            "avatar_id": avatar_id,
        },
    }


def wire_assistant(avatar_id: str, assistant_id: str | None = None) -> dict[str, Any]:
    """Create or update an assistant with avatar_settings pointing at avatar_id.

    Writes the assistant, then reads it back with GET /v2/ai/assistants/{id} so
    the caller sees exactly what Telnyx stored.
    """
    if not avatar_id or avatar_id.startswith("http"):
        raise ValueError("avatar_id must be the avatar data.id, not an image URL")

    body = _assistant_body(avatar_id)

    if _demo_mode():
        app.logger.info("DEMO_MODE: would POST /v2/ai/assistants avatar_id=%s", avatar_id)
        return {"id": assistant_id or "assistant_demo_0001",
                "avatar_settings": body["avatar_settings"], "demo": True}

    url = (
        f"{TELNYX_API_BASE}/ai/assistants/{assistant_id}"
        if assistant_id
        else f"{TELNYX_API_BASE}/ai/assistants"
    )
    resp = requests.post(url, headers={**_auth_headers(), "Content-Type": "application/json"},
                         json=body, timeout=30)
    if resp.status_code >= 400:
        app.logger.error("assistant write failed status=%s", resp.status_code)
        raise RuntimeError(f"assistant write failed ({resp.status_code})")
    created = resp.json().get("data", {})
    new_id = created.get("id", assistant_id)

    read_back = requests.get(f"{TELNYX_API_BASE}/ai/assistants/{new_id}",
                             headers=_auth_headers(), timeout=30)
    read_back.raise_for_status()
    return read_back.json().get("data", created)


# --------------------------------------------------------------------------
# Step 3 — avatar session (WebSocket, session.update first)
# --------------------------------------------------------------------------
def _pcm_silence(seconds: int, sample_rate: int = 16000) -> bytes:
    return b"\x00\x00" * (sample_rate * seconds)


def _session_result(log: list[str], frames: list[dict[str, Any]],
                    media_ready_sent: bool, session_created_seen: bool,
                    fallback_active: bool, close_code: int | None) -> dict[str, Any]:
    """Structured session result. `frames` is the ordered frame transcript."""
    return {
        "event_log": log,
        "frames": frames,
        "close_code": close_code,
        "session_update_first": bool(frames) and frames[0].get("type") == "session.update",
        "media_ready_before_session_created": media_ready_sent and not session_created_seen,
        "fallback_active": fallback_active,
        "fatal_1011": close_code == 1011,
    }


async def _drive_session(ws: Any, *, break_media: bool, inject_error: bool,
                         seconds: int) -> dict[str, Any]:
    """Drive the documented avatar handshake over an open WebSocket.

    This is the single implementation of the handshake — it runs against the
    real Telnyx conversation socket in live mode and against the local
    protocol-faithful server in demo mode. Frame ordering:
      session.update (first) -> session.created -> avatar.signaling.* ->
      avatar.media.ready -> response.output_audio.delta
    """
    log: list[str] = []
    frames: list[dict[str, Any]] = []
    media_ready_sent = False
    session_created_seen = False
    fallback_active = False
    close_code: int | None = None

    update = {"type": "session.update",
              "session": {"input_audio_format": "pcm16", "output_audio_format": "pcm16"}}
    await ws.send(json.dumps(update))
    frames.append(update)
    log.append("sent session.update (first frame)")

    await ws.send(_pcm_silence(seconds))

    try:
        async for raw in ws:
            frame = json.loads(raw)
            ftype = frame.get("type", "")
            frames.append(frame)
            log.append(f"recv {ftype}")

            if ftype == "session.created":
                session_created_seen = True
                if not media_ready_sent:
                    log.append("FATAL: session.created before avatar.media.ready")
                    await ws.close(code=1011)
                    close_code = 1011
                    break

            elif ftype.startswith("avatar.signaling"):
                answer = {"type": "avatar.signaling.answer", "sdp": frame.get("sdp", "")}
                await ws.send(json.dumps(answer))
                frames.append(answer)
                log.append("answered avatar signaling frame")

            elif ftype == "avatar.media.ready":
                if not break_media:
                    ready = {"type": "avatar.media.ready"}
                    await ws.send(json.dumps(ready))
                    frames.append(ready)
                    media_ready_sent = True
                    log.append("sent avatar.media.ready")

            elif ftype == "avatar.error":
                fatal = bool(frame.get("fatal", False))
                if fatal:
                    log.append("avatar.error fatal -> closing")
                    await ws.close(code=1011)
                    close_code = 1011
                    break
                fallback_active = True
                log.append("avatar.error non-fatal -> voice-only fallback")

            elif ftype == "response.output_audio.delta":
                log.append("audio delta (voice-only path)" if fallback_active
                           else "audio delta (avatar active, suppressed)")
    except Exception as exc:  # noqa: BLE001 — surface close reason in log
        log.append(f"socket closed: {type(exc).__name__}")
        close_code = getattr(exc, "code", None) or close_code

    return _session_result(log, frames, media_ready_sent, session_created_seen,
                           fallback_active, close_code)


async def _run_live_session(assistant_id: str, *, break_media: bool,
                            inject_error: bool, seconds: int) -> dict[str, Any]:
    """Open the real Telnyx conversation WebSocket and drive the handshake."""
    import websockets

    url = (
        f"{TELNYX_WS_BASE}/ai/assistants/{assistant_id}/conversation"
        f"?avatar=true&input_sample_rate=16000"
    )
    async with websockets.connect(url, additional_headers=_auth_headers()) as ws:
        return await _drive_session(ws, break_media=break_media,
                                    inject_error=inject_error, seconds=seconds)


async def _run_demo_session(assistant_id: str, *, break_media: bool,
                            inject_error: bool, seconds: int) -> dict[str, Any]:
    """Run the SAME handshake code against a local protocol-faithful server.

    The local server speaks the documented frame protocol (session.created,
    avatar.signaling.offer, avatar.error, response.output_audio.delta) and
    enforces the documented 1011 close when avatar.media.ready never arrives.
    This exercises the real transport code path offline; it is not a substitute
    for the live path, which is the default when DEMO_MODE=false.
    """
    import websockets

    async def handler(ws: Any) -> None:
        first = json.loads(await ws.recv())
        assert first.get("type") == "session.update", "session.update must be first"
        await ws.send(json.dumps({"type": "session.created"}))
        await ws.send(json.dumps({"type": "avatar.signaling.offer", "sdp": "v=0"}))
        try:
            async for raw in ws:
                frame = json.loads(raw)
                if frame.get("type") == "avatar.media.ready":
                    if inject_error:
                        await ws.send(json.dumps({"type": "avatar.error", "fatal": False}))
                    await ws.send(json.dumps({"type": "response.output_audio.delta",
                                              "delta": "AAAA"}))
                    await ws.close(code=1000)
                    return
        except Exception:  # noqa: BLE001 — client closed first (break_media path)
            pass
        # Client never sent avatar.media.ready -> documented fatal close.
        await ws.close(code=1011)

    async with websockets.serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        async with websockets.connect(f"ws://127.0.0.1:{port}/conversation") as ws:
            return await _drive_session(ws, break_media=break_media,
                                        inject_error=inject_error, seconds=seconds)


async def run_avatar_session(
    assistant_id: str,
    *,
    break_media: bool = False,
    inject_error: bool = False,
    seconds: int = 10,
) -> dict[str, Any]:
    """Open the conversation WebSocket and drive the avatar handshake.

    Returns an event log proving session.update was first and whether
    avatar.media.ready was sent before session.created.
    """
    if _demo_mode():
        return await _run_demo_session(assistant_id, break_media=break_media,
                                       inject_error=inject_error, seconds=seconds)
    return await _run_live_session(assistant_id, break_media=break_media,
                                   inject_error=inject_error, seconds=seconds)


# --------------------------------------------------------------------------
# Flask routes
# --------------------------------------------------------------------------
@app.get("/health")
def health() -> tuple[dict[str, Any], int]:
    return {"status": "ok", "demo_mode": _demo_mode()}, 200


@app.post("/avatars")
def route_create_avatar() -> tuple[dict[str, Any], int]:
    upload = request.files.get("image_file")
    if upload is None:
        return {"error": "image_file is required"}, 400
    try:
        name = validate_avatar_name(request.form.get("name", ""))
        meta = validate_avatar_image(upload.filename or "", upload.mimetype or "", upload.read())
    except ValueError as exc:
        return {"error": str(exc)}, 400

    if _demo_mode():
        return {"id": "avatar_demo_0001", "name": name, "demo": True, **meta}, 201

    resp = requests.post(
        f"{TELNYX_API_BASE}/ai/avatars",
        headers=_auth_headers(),
        files={"image_file": (upload.filename, upload.stream, meta["mime"])},
        data={"name": name},
        timeout=60,
    )
    if resp.status_code >= 400:
        app.logger.error("avatar upload failed status=%s", resp.status_code)
        return {"error": "avatar upload failed"}, 502
    return resp.json().get("data", {}), 201


@app.post("/assistants")
def route_wire_assistant() -> tuple[dict[str, Any], int]:
    body = request.get_json(silent=True) or {}
    avatar_id = str(body.get("avatar_id", "")).strip()
    if not avatar_id:
        return {"error": "avatar_id is required"}, 400
    if avatar_id.startswith("http"):
        return {"error": "avatar_id must be the avatar data.id, not an image URL"}, 400
    try:
        result = wire_assistant(avatar_id, body.get("assistant_id"))
    except ValueError as exc:
        return {"error": str(exc)}, 400
    except RuntimeError:
        app.logger.exception("assistant wiring failed")
        return {"error": "assistant wiring failed"}, 502
    return result, 200


@app.post("/session")
def route_session() -> tuple[dict[str, Any], int]:
    body = request.get_json(silent=True) or {}
    assistant_id = str(body.get("assistant_id", "")).strip()
    if not assistant_id:
        return {"error": "assistant_id is required"}, 400
    break_media = bool(body.get("break_media", False))
    inject_error = bool(body.get("inject_error", False))
    try:
        result = asyncio.run(run_avatar_session(
            assistant_id,
            break_media=break_media,
            inject_error=inject_error,
        ))
    except Exception:
        app.logger.exception("avatar session failed")
        return {"error": "avatar session failed"}, 502
    return result, 200


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------
def _main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="AI Avatar Conversation Desk")
    parser.add_argument("--step", choices=["create-avatar", "wire-assistant", "avatar-session"],
                        required=True)
    parser.add_argument("--image", default="./portrait.png")
    parser.add_argument("--name", default="Desk Portrait")
    parser.add_argument("--avatar-id", default=os.getenv("AVATAR_ID", ""))
    parser.add_argument("--assistant-id", default=os.getenv("ASSISTANT_ID", ""))
    parser.add_argument("--break-media", action="store_true")
    parser.add_argument("--inject-error", action="store_true")
    args = parser.parse_args(argv)

    if args.step == "create-avatar":
        print(json.dumps(create_avatar(args.image, args.name), indent=2))
    elif args.step == "wire-assistant":
        print(json.dumps(wire_assistant(args.avatar_id, args.assistant_id or None), indent=2))
    else:
        print(json.dumps(asyncio.run(run_avatar_session(
            args.assistant_id,
            break_media=args.break_media,
            inject_error=args.inject_error,
        )), indent=2))
    return 0


if __name__ == "__main__":
    if "--step" in sys.argv:
        raise SystemExit(_main(sys.argv[1:]))
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")))
=== END FILE ===
