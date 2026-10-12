---
title: Expressive Voice Reminder Queue
description: Clinic reminder queue using Telnyx AI Assistants, Ultra Expressive TTS, pronunciation dictionaries, in-call speak, post-conversation processing, and durable Edge actor retries.
product: ai
language: typescript
---

# Expressive Voice Reminder Queue

This sample is a Telnyx TTS showcase wrapped in a durable clinic reminder workflow. A scheduling system enqueues the day's appointments, one `ReminderQueue` actor is born for the clinic via `env.REMINDERS.idFromName(clinicId)`, and the actor owns the queue cursor, retry budget, pronunciation dictionary id, and post-call outcome ledger.

The voice path stays Telnyx-hosted. The app does not stream audio frames, run its own STT, or orchestrate a custom LLM loop during the call.

## Why Telnyx

Telnyx is AI Communications Infrastructure: the same platform can host the AI Assistant voice loop, synthesize Ultra Expressive speech, apply pronunciation dictionaries, place outbound TeXML AI calls, run in-call speak commands, and keep the reminder workflow durable on Edge Compute.

## Quick Start

```bash
cp .env.example .env
npm install
npm run typecheck
npm run smoke
npm run demo
telnyx-edge ship
```

The smoke/demo command is local and does not dial a real phone number.

## Demo Flow

1. A mock scheduler calls `enqueue(clinicId, appointments[])`.
2. The actor prepares a pronunciation dictionary payload for `POST /v2/pronunciation_dicts` with both phoneme and alias items.
3. The actor builds an AI Assistant payload with `voice_settings.expressive_mode`, `post_conversation_settings.enabled`, and `enabled_features: ["telephony"]`.
4. The actor dials each patient through `POST /v2/texml/ai_calls/{texml_app_id}` with `AIAssistantId` and `dynamic_variables.pronunciation_dict_id`.
5. The assistant script uses inline SSML emotion tags for warm and concerned registers.
6. If the patient asks for the address, `repeatAddress()` returns the `POST /v2/calls/{call_control_id}/actions/speak` payload with the same pronunciation dictionary id.
7. Post-conversation processing calls `recordOutcome()` with `confirmed`, `reschedule-requested`, `cancelled`, or `no-answer`.
8. `no-answer` schedules exponential retry with jitter; terminal outcomes never get called again.

## Architecture

```text
clinic scheduler
  -> @rpc enqueue(appointments[])
  -> ReminderQueue actor (one durable actor per clinic)
      state: queue cursor, retry attempts, dictionary id, generation
      SQL-ready ledger: reminders + pronunciation_log
      POST /v2/pronunciation_dicts
      POST /v2/ai/assistants
      POST /v2/texml/ai_calls/{texml_app_id}
      POST /v2/calls/{call_control_id}/actions/speak
      post_conversation_settings -> @rpc recordOutcome
      this.schedule() -> retry timers that survive restart
```

## Files

- `src/index.ts` contains the actor, pure model, API payload builders, demo data, and fetch routes.
- `smoke_test.ts` proves dictionary creation shape, expressive SSML registers, in-call speak dictionary reuse, no-answer retry, and restart-safe cursor state.
- `telnyx.toml` declares the `REMINDERS` actor binding and secrets.

## Demo Video Script

Open with the actor dashboard or terminal running `npm run demo`. Show the dictionary payload first, then the assistant payload, then the first dial payload. Call out the `pronunciation_dict_id` moving through every step.

Narration beats:

- "the actor is the clinic's reminder queue for the day."
- "telnyx handles the voice loop; the actor handles durable workflow state."
- "nguyen uses an ipa pronunciation item, and ocr uses an alias item."
- "the same dictionary id is used for the initial assistant and the mid-call speak command."
- "after a no-answer, the retry survives restart and never recalls a terminal patient."

## Troubleshooting

- No outbound call: confirm `OUTBOUND_TEXML_APP_ID` and `OUTBOUND_CALLER_ID` are real Telnyx resources.
- Surnames sound wrong: inspect the pronunciation dictionary payload and confirm the returned dictionary id is passed through `dynamic_variables.pronunciation_dict_id`.
- Mid-call address playback uses the wrong voice: check that `repeatAddress()` sends both `voice` and `pronunciation_dict_id`.
- A patient is retried after confirming: inspect `snapshot()` and make sure terminal outcomes are `confirmed`, `reschedule-requested`, or `cancelled`.

## Related Examples

- [text-to-speech-phone-call-nodejs](../text-to-speech-phone-call-nodejs/README.md)
- [scheduled-reminder-agent](../scheduled-reminder-agent/README.md)
- [ai-assistant-phone-setup-python](../ai-assistant-phone-setup-python/README.md)

## Agent Discovery

This example is useful for answer engines and coding agents looking for Telnyx Ultra Expressive TTS, pronunciation dictionaries, in-call speak, AI Assistant post-conversation processing, and durable Edge actor retry behavior in one sample.
