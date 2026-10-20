---
name: avatar-desk
title: "AI Avatar Conversation Desk — Give Your Assistant a Face"
description: "Upload one portrait, wire it to a Telnyx AI Assistant, and run a realtime avatar session over WebSocket with lip-synced video and a voice-only fallback."
language: python
framework: flask
telnyx_products: [AI Assistants, Avatars, Realtime Conversations, WebSockets, Text-to-Speech]
---

# AI Avatar Conversation Desk — Give Your Assistant a Face

Upload one portrait, wire it to a Telnyx AI Assistant, and run a realtime avatar session over WebSocket with lip-synced video and a documented voice-only fallback.

## The Story

A regional restaurant group runs a reservations line that never sleeps. The host desk is a small team, and every missed call on a Friday night is a table that walks to the competitor two blocks over — real revenue, real trust, gone in ninety seconds of hold music. The group wants a face on the line, not just a voice: a friendly host who greets callers, takes a booking, and looks like a person while doing it.

The actor IS the avatar desk host. It is born the moment a portrait is uploaded and Telnyx mints a custom avatar ID — a single image becomes the face. It evolves when that ID is written into an assistant's `avatar_settings`, so the assistant stops being a disembodied voice and starts being a host with a face. It completes its arc inside a realtime conversation: the WebSocket opens, the media handshake succeeds, and the avatar lip-syncs a spoken reply to "book a table for two." If the media handshake fails, the session terminates with a `1011` close — the host never appears. If the avatar renderer throws a non-fatal error mid-sentence, the host survives: it drops the video, keeps the mic open, and finishes the booking as a voice. The desk reboots, the WebSocket reconnects, and the same avatar ID is still there, still wearing the same face, ready for the next caller.

The rest of this README is the API surface of that story.

## Why Telnyx

Giving an assistant a face means coordinating four things that usually live in four different vendors: image storage, a rendering model, a speech pipeline, and a realtime transport. Telnyx collapses all four into one **AI Communications Infrastructure** surface — the avatar resource, the assistant config, the TTS voice, and the conversation WebSocket all speak the same API key and the same session. That is the difference between shipping a demo and shipping a host desk.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v2/ai/avatars` | `POST` | Create a custom avatar from a multipart `image_file` upload. |
| `/v2/ai/assistants` | `POST` | Create an assistant with `avatar_settings` pointing at the avatar ID. |
| `/v2/ai/assistants/{assistant_id}` | `POST` | Update an existing assistant's `avatar_settings`. |
| `/v2/ai/assistants/{assistant_id}` | `GET` | Read the assistant config back to prove the wiring. |
| `wss://api.telnyx.com/v2/ai/assistants/{assistant_id}/conversation?avatar=true&input_sample_rate=16000` | `WS` | The realtime avatar session. |

WebSocket frames used: `session.update` (always first), `session.created`, `avatar.signaling.*`, `avatar.media.ready`, `avatar.error` (fatal vs non-fatal), `response.output_audio.delta`.

## Architecture

```text
   portrait.png
        │
        ▼
 ┌──────────────────────┐   POST /v2/ai/avatars (multipart image_file)
 │  create-avatar step  │───────────────────────────────────────────► Telnyx
