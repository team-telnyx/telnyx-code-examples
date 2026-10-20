"""Smoke tests for the AI Avatar Conversation Desk sample.

Run with: python -m pytest smoke_test.py -v

Session tests assert on STRUCTURED frame data (frame type, ordering, close
code) produced by the real handshake code path — not substring matches on log
lines. The demo-mode transport is a local protocol-faithful WebSocket server,
so the same `_drive_session` code that runs live is what these tests exercise.
"""

import asyncio
import io
import json
import os
import struct
from unittest import mock

os.environ.setdefault("TELNYX_API_KEY", "test_key_placeholder")
os.environ.setdefault("DEMO_MODE", "true")

import app as avatar_app  # noqa: E402


def _png(width: int, height: int) -> bytes:
    header = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + struct.pack(">II", width, height)
    return header + b"\x00" * 32


def _frame_types(result: dict) -> list[str]:
    return [f.get("type") for f in result["frames"]]


# --------------------------------------------------------------------------
# Module / routes
# --------------------------------------------------------------------------
def test_module_loads():
    assert avatar_app.app is not None


def test_expected_routes_registered():
    rules = {r.rule for r in avatar_app.app.url_map.iter_rules()}
    assert {"/health", "/avatars", "/assistants", "/session"} <= rules


# --------------------------------------------------------------------------
# Validators
# --------------------------------------------------------------------------
def test_validator_accepts_valid_png():
    meta = avatar_app.validate_avatar_image("portrait.png", "image/png", _png(512, 512))
    assert meta["width"] == 512 and meta["height"] == 512
    assert meta["mime"] == "image/png"


def test_validator_rejects_oversize_side():
    try:
        avatar_app.validate_avatar_image("p.png", "image/png", _png(128, 512))
    except ValueError as exc:
        assert "width" in str(exc)
    else:
        raise AssertionError("expected ValueError for undersized width")


def test_validator_rejects_bad_mime():
    try:
        avatar_app.validate_avatar_image("portrait.gif", "image/gif", b"GIF89a")
    except ValueError as exc:
        assert "JPEG" in str(exc)
    else:
        raise AssertionError("expected ValueError for unsupported mime")


def test_validator_rejects_oversize_bytes():
    try:
        avatar_app.validate_avatar_image("p.png", "image/png", b"\x00" * (11 * 1024 * 1024))
    except ValueError as exc:
        assert "MiB" in str(exc)
    else:
        raise AssertionError("expected ValueError for oversize file")


def test_validator_rejects_mismatched_extension():
    try:
        avatar_app.validate_avatar_image("portrait.jpg", "image/jpeg", _png(512, 512))
    except ValueError as exc:
        assert "extension" in str(exc)
    else:
        raise AssertionError("expected ValueError for mismatched extension/format")


def test_avatar_name_bounds():
    assert avatar_app.validate_avatar_name("Desk Portrait") == "Desk Portrait"
    for bad in ("", "x" * 256):
        try:
            avatar_app.validate_avatar_name(bad)
        except ValueError:
            continue
        raise AssertionError("expected ValueError for invalid name")


# --------------------------------------------------------------------------
# create_avatar — real multipart request construction + id-vs-image_url assert
# --------------------------------------------------------------------------
def test_create_avatar_live_multipart_and_id_propagation(tmp_path):
    """Live path: multipart/form-data with image_file field; data.id propagated."""
    img = tmp_path / "portrait.png"
    img.write_bytes(_png(512, 512))

    captured = {}

    class FakeResp:
        status_code = 200

        def json(self):
            return {"data": {"id": "avatar_live_42", "name": "Desk Portrait",
                             "image_url": "https://cdn.telnyx.com/avatar_live_42.png"}}

    def fake_post(url, headers=None, files=None, data=None, timeout=None):
        captured["url"] = url
        captured["files"] = files
        captured["data"] = data
        return FakeResp()

    with mock.patch.dict(os.environ, {"DEMO_MODE": "false"}), \
         mock.patch.object(avatar_app.requests, "post", side_effect=fake_post):
        result = avatar_app.create_avatar(str(img), "Desk Portrait")

    assert captured["url"] == f"{avatar_app.TELNYX_API_BASE}/ai/avatars"
    assert "image_file" in captured["files"]
    filename, payload, mime = captured["files"]["image_file"]
    assert filename == "portrait.png"
    assert mime == "image/png"
    assert isinstance(payload, bytes) and payload[:8] == b"\x89PNG\r\n\x1a\n"
    assert captured["data"] == {"name": "Desk Portrait"}
    assert result["id"] == "avatar_live_42"


def test_create_avatar_rejects_id_equal_to_image_url(tmp_path):
    """A response where id == image_url must raise — the acceptance criterion."""
    img = tmp_path / "portrait.png"
    img.write_bytes(_png(512, 512))

    class FakeResp:
        status_code = 200

        def json(self):
            url = "https://cdn.telnyx.com/portrait.png"
            return {"data": {"id": url, "image_url": url}}

    with mock.patch.dict(os.environ, {"DEMO_MODE": "false"}), \
         mock.patch.object(avatar_app.requests, "post", return_value=FakeResp()):
        try:
            avatar_app.create_avatar(str(img), "Desk Portrait")
        except AssertionError as exc:
            assert "image_url" in str(exc)
        else:
            raise AssertionError("expected AssertionError when id == image_url")


def test_create_avatar_demo_mode(tmp_path):
    img = tmp_path / "portrait.png"
    img.write_bytes(_png(512, 512))
    result = avatar_app.create_avatar(str(img), "Desk Portrait")
    assert result["id"] == "avatar_demo_0001"
    assert result["demo"] is True


# --------------------------------------------------------------------------
# wire_assistant — POST body + read-back GET
# --------------------------------------------------------------------------
def test_wire_assistant_rejects_image_url():
    try:
        avatar_app.wire_assistant("https://example.com/portrait.png")
    except ValueError as exc:
        assert "data.id" in str(exc)
    else:
        raise AssertionError("expected ValueError when avatar_id is an image URL")


def test_wire_assistant_live_posts_avatar_settings_and_reads_back():
    """Live path: POST body carries exact avatar_settings; GET reads it back."""
    posted = {}
    read_back_url = {}

    class FakePost:
        status_code = 200

        def json(self):
            return {"data": {"id": "assistant_live_7"}}

    class FakeGet:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {"data": {"id": "assistant_live_7",
                             "avatar_settings": posted["body"]["avatar_settings"]}}

    def fake_post(url, headers=None, json=None, timeout=None):
        posted["url"] = url
        posted["body"] = json
        return FakePost()

    def fake_get(url, headers=None, timeout=None):
        read_back_url["url"] = url
        return FakeGet()

    with mock.patch.dict(os.environ, {"DEMO_MODE": "false"}), \
         mock.patch.object(avatar_app.requests, "post", side_effect=fake_post), \
         mock.patch.object(avatar_app.requests, "get", side_effect=fake_get):
        result = avatar_app.wire_assistant("avatar_live_42")

    assert posted["url"] == f"{avatar_app.TELNYX_API_BASE}/ai/assistants"
    assert posted["body"]["avatar_settings"] == {
        "provider": "telnyx", "model": "foxtrot-1", "avatar_id": "avatar_live_42",
    }
    assert read_back_url["url"] == f"{avatar_app.TELNYX_API_BASE}/ai/assistants/assistant_live_7"
    assert result["avatar_settings"]["avatar_id"] == "avatar_live_42"


def test_wire_assistant_live_update_targets_existing_assistant():
    posted = {}

    class FakePost:
        status_code = 200

        def json(self):
            return {"data": {"id": "assistant_live_7"}}

    class FakeGet:
        def raise_for_status(self):
            return None

        def json(self):
            return {"data": {"id": "assistant_live_7"}}

    def fake_post(url, headers=None, json=None, timeout=None):
        posted["url"] = url
        return FakePost()

    with mock.patch.dict(os.environ, {"DEMO_MODE": "false"}), \
         mock.patch.object(avatar_app.requests, "post", side_effect=fake_post), \
         mock.patch.object(avatar_app.requests, "get",
                           return_value=FakeGet()):
        avatar_app.wire_assistant("avatar_live_42", "assistant_live_7")

    assert posted["url"] == f"{avatar_app.TELNYX_API_BASE}/ai/assistants/assistant_live_7"


def test_wire_assistant_demo_mode_uses_avatar_id():
    result = avatar_app.wire_assistant("avatar_demo_0001")
    assert result["avatar_settings"]["avatar_id"] == "avatar_demo_0001"
    assert result["avatar_settings"]["provider"] == "telnyx"
    assert result["avatar_settings"]["model"] == "foxtrot-1"


# --------------------------------------------------------------------------
# Session — structured frame assertions against the real handshake code path
# --------------------------------------------------------------------------
def test_session_normal_ordering():
    """session.update is frame[0]; avatar.media.ready precedes session.created."""
    result = asyn
