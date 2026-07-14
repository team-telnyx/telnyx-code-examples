---
name: hotel-guest-services
title: "Hotel Guest Services Line"
description: "Inbound voice and SMS concierge for hotels. Looks up the room by caller phone, captures the room number when unknown, routes room service, housekeeping, concierge, and maintenance requests, escalates urgent ones to staff, and texts the guest on completion."
language: python
framework: flask
telnyx_products: [Voice, AI Inference, Messaging]
integrations: [Slack]
channel: [voice, sms]
---

# Hotel Guest Services Line

A Flask app that turns one Telnyx phone number into a 24/7 hotel concierge.
Guests call or text for room service, housekeeping, concierge help, or
maintenance. The agent routes each request to the right department,
escalates urgent issues to staff via Slack, and sends the guest an SMS when
the request is fulfilled.

## What It Does

- Answers inbound voice calls and greets the guest by name when the caller ID matches a checked-in room
- Asks for the room number when the caller is unknown, then continues the conversation
- Accepts inbound SMS from any guest phone
- Uses Telnyx AI Inference to classify each request into room service, housekeeping, concierge, or maintenance
- Detects urgent phrases (fire, flood, leak, locked out, gas, medical) and routes them with priority
- Posts a Slack alert to staff for every new request, with department-specific emoji
- Sends the guest an SMS confirmation on receipt and another SMS when staff mark the request complete

## Telnyx API Endpoints Used

- Call Control: Answer — `POST /v2/calls/{id}/actions/answer` — [reference](https://developers.telnyx.com/api/call-control/answer-call)
- Call Control: Speak — `POST /v2/calls/{id}/actions/speak` — [reference](https://developers.telnyx.com/api/call-control/speak)
- Call Control: Gather — `POST /v2/calls/{id}/actions/gather` — [reference](https://developers.telnyx.com/api/call-control/gather)
- Messaging: Send — `POST /v2/messages` — [reference](https://developers.telnyx.com/api/messaging/send-message)
- AI Inference: Chat Completions — `POST /v2/ai/chat/completions` — [reference](https://developers.telnyx.com/api/inference/chat-completions)

## Telnyx Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):

- `call.initiated` — New inbound call — answer it
- `call.answered` — Call connected — speak a greeting (with guest name when caller ID matches)
- `call.speak.ended` — TTS playback finished — start speech gather
- `call.gather.ended` — Caller speech transcribed — process the request
- `call.hangup` — Call ended — drop the session

It also handles `message.received` for inbound SMS.

## Architecture

```
  Inbound Phone Call or SMS
            │
            ▼
  ┌────────────────────────┐
  │ Telnyx Voice / SMS     │
  │ webhook → Flask        │
  └──────────┬─────────────┘
             │
   ┌─────────┴─────────┐
   │ Caller known?     │
   │ (caller ID match) │
   └─────────┬─────────┘
             │ no
             ▼
   ┌─────────────────┐         ┌──────────────┐
   │ Ask for room #  │ ──────► │ Extract room │
   └─────────┬───────┘         │ from speech  │
             │                 └──────┬───────┘
             │                        │
             ▼                        ▼
   ┌────────────────────────────────────────┐
   │ AI Inference — categorize request     │
   │ department, urgency, summary, details │
   └────────────────┬───────────────────────┘
                    │
        ┌───────────┼────────────┬───────────┐
        ▼           ▼            ▼           ▼
   Room svc   Housekeeping  Concierge   Maintenance
        │           │            │           │
        └───────────┴─────┬──────┴───────────┘
                          │
                ┌─────────┴──────────┐
                ▼                    ▼
        Slack staff alert     SMS confirmation
                ▼
        Staff marks complete via API
                ▼
        Guest receives SMS

  State: In-memory dict (ROOMS, service_requests, calls)
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | string | `KEY0123456789ABCDEF` | yes | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `TELNYX_PUBLIC_KEY` | string | `-----BEGIN PUBLIC KEY-----...` | yes | Public key used to verify inbound webhook signatures | [Portal](https://portal.telnyx.com/api-keys) |
| `MAIN_NUMBER` | string | `+18005551234` | yes | Telnyx phone number (E.164) | [Portal](https://portal.telnyx.com/numbers/my-numbers) |
| `CONNECTION_ID` | string | `1494404757140276705` | yes | Call Control application ID | [Portal](https://portal.telnyx.com/call-control/applications) |
| `AI_MODEL` | string | `moonshotai/Kimi-K2.6` | no | Telnyx AI Inference model name | [Docs](https://developers.telnyx.com/docs/inference/models) |
| `TTS_VOICE` | string | `AWS.Polly.Joanna-Neural` | no | Telnyx Call Control voice for TTS | [Docs](https://developers.telnyx.com/docs/voice/call-control/commands/speak) |
| `TTS_LANGUAGE` | string | `en-US` | no | BCP-47 language tag for TTS | — |
| `STAFF_SLACK_WEBHOOK` | string | `https://hooks.slack.com/services/...` | no | Slack incoming webhook for staff alerts | [Slack docs](https://api.slack.com/messaging/webhooks) |
| `HOST` | string | `127.0.0.1` | no | Bind host | — |
| `PORT` | int | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/hotel-guest-services-python
cp .env.example .env
# Edit .env with your Telnyx credentials
pip install -r requirements.txt
python app.py
```

Server starts on `http://localhost:5000`.

### Webhook Configuration

1. Expose your local server so Telnyx can deliver webhooks:

   ```bash
   ngrok http 5000
   ```

2. Copy the HTTPS URL and configure it in the [Telnyx Portal](https://portal.telnyx.com):

   - **Call Control Application** → Webhook URL → `https://<id>.ngrok.io/webhooks/voice`
   - **Messaging Profile** → Inbound Webhook URL → `https://<id>.ngrok.io/webhooks/sms`

3. Verify inbound webhooks are signed — the app validates the Ed25519 signature against `TELNYX_PUBLIC_KEY` on every request. Set the public key in the Portal under API Keys.

## Demo Flow

1. Start the app and expose it with ngrok.
2. Call the Telnyx number from a phone whose caller ID matches a known room (rooms 101 and 205 are seeded by default).
3. Say: "Can I order a club sandwich and sparkling water?"
4. The app records the request, posts to Slack, and confirms by voice.
5. List the open requests:

   ```bash
   curl http://localhost:5000/requests
   ```

6. Mark the request complete:

   ```bash
   curl -X POST http://localhost:5000/requests/0/complete
   ```

7. The guest receives an SMS saying the request is fulfilled.

To test from an unknown number, call the Telnyx number from any other phone, say "Room 205 please", then make your request.

## API Reference

### `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Handles `call.initiated`, `call.answered`, `call.speak.ended`, `call.gather.ended`, `call.hangup`. See the [Telnyx Call Control docs](https://developers.telnyx.com/docs/voice/call-control) for the full payload shape.

### `POST /webhooks/sms`

Receives Telnyx Messaging webhook events. Handles `message.received`.

### `GET /requests`

List service requests. Optional query params: `department` (`room_service|housekeeping|concierge|maintenance`), `status` (`open|completed`).

```bash
curl http://localhost:5000/requests
curl "http://localhost:5000/requests?department=room_service&status=open"
```

```json
{
  "requests": [
    {
      "id": 0,
      "room": "205",
      "guest": "Chen",
      "phone": "+15559005678",
      "channel": "voice",
      "department": "room_service",
      "urgency": "normal",
      "summary": "Club sandwich and sparkling water",
      "details": "One club sandwich and one bottle of sparkling water",
      "original": "Can I order a club sandwich and sparkling water?",
      "status": "open",
      "created_at": "2026-07-14T18:42:00Z"
    }
  ],
  "total": 1
}
```

### `POST /requests/<int:idx>/complete`

Mark a request complete and send the guest an SMS.

```bash
curl -X POST http://localhost:5000/requests/0/complete
```

```json
{
  "request": {
    "id": 0,
    "status": "completed",
    "completed_at": "2026-07-14T18:55:12Z"
  }
}
```

### `GET /health`

```bash
curl http://localhost:5000/health
```

```json
{
  "status": "ok",
  "open_requests": 1,
  "active_calls": 0
}
```

## Edge Cases Handled

- No speech detected on a gather — reprompt the caller.
- Unknown caller — ask for the room number, extract it from the next utterance.
- AI Inference returns malformed JSON — fall back to a `concierge / normal` category with the raw text as the summary.
- Slack webhook down — log and continue (SMS confirmation still goes out).
- SMS send fails — log and continue (Slack alert still goes out).
- Duplicate webhook delivery — event IDs are tracked for one hour and deduplicated.
- Urgent phrases ("fire", "flooding", "locked out", "gas leak") — overridden to `urgency: urgent` and posted to Slack with a `:rotating_light:` prefix even if the LLM classifies them otherwise.

## Going to Production

This example uses in-memory storage and a hardcoded room list for clarity. For production:

- Replace the `ROOMS` dict and `service_requests` list with your PMS database (Opera, Mews, Cloudbeds).
- Persist calls and processed-event IDs to Redis with a TTL.
- Use a queue (Celery, RQ) for Slack and SMS side effects so webhook responses stay under Telnyx's timeout.
- Add call recording for quality assurance (set `record_channels: "dual"` on the answer action).
- Map urgency to real paging (PagerDuty, Opsgenie) instead of Slack for true emergencies.
- Localize the system prompt and TTS voice per property language.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 invalid signature` on webhook | `TELNYX_PUBLIC_KEY` does not match the public key in the Portal | Copy the public key exactly from [Portal → API Keys](https://portal.telnyx.com/api-keys) |
| Call goes to voicemail without greeting | Webhook URL is unreachable or wrong path | Verify ngrok is running and the Call Control app points at `/webhooks/voice` |
| Caller is asked for a room number they already gave | Telnyx did not deliver `caller_id` for that leg (rare on inbound) | Add a fallback that asks for room number on the second gather if the lookup fails |
| Slack messages do not appear | `STAFF_SLACK_WEBHOOK` is missing or invalid | Test the webhook URL with `curl -X POST -d '{"text":"hi"}' "$STAFF_SLACK_WEBHOOK"` |
| AI classification always returns `concierge` | `AI_MODEL` is unavailable on your account | List models: `curl -H "Authorization: Bearer $TELNYX_API_KEY" https://api.telnyx.com/v2/ai/models`. Common fallbacks: `openai/gpt-4o`, `Qwen/Qwen3-235B-A22B` |
| SMS confirmation not delivered | `MAIN_NUMBER` is not messaging-enabled | Enable SMS on the number in the [Portal](https://portal.telnyx.com/numbers/my-numbers) and link it to a Messaging Profile |

## Related Examples

- [AI Restaurant Reservation Voice Agent](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-restaurant-reservation-voice-agent-python/README.md)
- [AI Receptionist with Booking Tools](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-receptionist-with-booking-tools-python/README.md)
- [AI Tech Support Voice Agent](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-tech-support-voice-agent-python/README.md)
- [AI Insurance Claims Intake](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-insurance-claims-intake-voice-python/README.md)

## Resources

- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI inference, and IoT on one private, global network. Co-located voice and inference means the agent's TTS, STT, and LLM calls stay on the same private backbone for sub-second round trips even when the guest is halfway around the world.
