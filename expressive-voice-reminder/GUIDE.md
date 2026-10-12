# Guide

Use this sample when you want to demonstrate Telnyx Text-to-Speech quality as the hero, with stateful actor durability as the operational backbone.

## Recording Plan

1. Show `npm run demo` passing.
2. Zoom in on the pronunciation dictionary payload.
3. Show `voice_settings.expressive_mode: true` and the dynamic pronunciation dictionary variable.
4. Show the warm and concerned SSML scripts.
5. Show `repeatAddress()` using the same dictionary id.
6. Trigger `no-answer`, rehydrate the model from `snapshot()`, and run `retryDue()`.
7. Finish on the terminal line `expressive-voice-reminder smoke test passed`.

## What To Say

"this is not a custom voice bot loop. telnyx ai assistants own the conversation, telnyx tts owns how the words sound, and the edge actor owns the clinic workflow so retries and outcomes survive restarts."

## Configuration

Set these before deploying:

- `TELNYX_API_KEY`
- `OUTBOUND_TEXML_APP_ID`
- `OUTBOUND_CALLER_ID`
- `CLINIC_TIMEZONE`
- `RETRY_MAX`
- `RETRY_BACKOFF_BASE_MS`
- `MAX_CALL_MINUTES`
