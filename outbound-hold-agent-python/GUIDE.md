# Build an Outbound Hold-Aware AI Agent

This example turns the outbound hold-agent pattern into a runnable FastAPI app. It is intentionally more than a dial-and-start-assistant snippet: it owns the call state machine, assistant tool endpoints, DTMF actions, hold monitoring, transcription-based pickup detection, and representative handoff.

## Runtime Flow

1. Start the app and expose it with HTTPS.
2. Create two Telnyx AI Assistants: one for IVR navigation and one for representative conversations.
3. Configure the IVR assistant tools:
   - `POST https://YOUR_PUBLIC_BASE_URL/tools/send-dtmf`
   - `POST https://YOUR_PUBLIC_BASE_URL/tools/hold-detected`
4. Optionally configure the representative assistant tool:
   - `POST https://YOUR_PUBLIC_BASE_URL/tools/end-call`
5. Start an outbound call with `POST /calls/outbound`.
6. On `call.answered`, the app starts the IVR assistant.
7. The IVR assistant calls `/tools/send-dtmf` when a phone menu requires keypad input.
8. Hold is detected through Telnyx events, assistant tool calls, or transcription phrases.
9. The app stops the active assistant and starts transcription-only hold monitoring.
10. Representative pickup is detected from `call.unhold` or transcript phrases.
11. The app starts the representative assistant with the original objective, context, hold duration, and recent transcript.
12. The representative assistant completes the task and may call `/tools/end-call`.

## Assistant Prompt Guidance

IVR assistant:

```txt
You navigate automated phone menus. When a menu requires keypad input, call the send_dtmf tool with the digit and a short reason. If you hear hold or queue language, call the hold_detected tool silently and then stop speaking.
```

Representative assistant:

```txt
You are continuing a call after a human representative answered. Use the supplied objective, approved user context, and recent transcript. Do not repeat the IVR path unless asked. Complete the task and call end_call when finished.
```

## Built-In Fake Company

Use `/fake-company/texml` as a predictable target when testing with a Telnyx TeXML number. It presents a reservations menu, accepts digit `1`, plays hold language, then emits a representative pickup phrase.

This gives you a repeatable end-to-end test before calling a real business.

## State Machine

```txt
dialing
-> ivr_navigation
-> hold_monitoring
-> representative_detected
-> live_conversation
-> call_ended
```

## Production Notes

- Keep DTMF backend-owned so assistant menu actions remain constrained and auditable.
- Set `TELNYX_PUBLIC_KEY` and verify webhook signatures before trusting live webhooks.
- Add authentication to `/calls/outbound` and assistant tool endpoints.
- Replace in-memory sessions with Redis or Postgres.
- Add destination allowlists, rate limits, retries, and stuck-call alerts.
- Review outbound calling, AI disclosure, recording, transcription, and retention requirements.
