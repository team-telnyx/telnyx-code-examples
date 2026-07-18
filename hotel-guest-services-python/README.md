---
name: hotel-guest-services
title: "Hotel Guest Services Line"
description: "Inbound voice and SMS guest services for hotels. Voice calls are handled by a Telnyx AI Assistant, while SMS requests are categorized and tracked by the Flask app."
language: python
framework: flask
telnyx_products: [Voice, AI Assistants, AI Inference, Messaging]
integrations: [Slack]
channel: [voice, sms]
---

# Hotel Guest Services Line

This Flask app turns a Telnyx number into a hotel guest services line.

Voice calls are answered with Telnyx Call Control and then handed to a configured Telnyx AI Assistant. The assistant handles the live conversation, turn-taking, transcription, and response generation. SMS messages are handled by the Flask app: it categorizes each request with Telnyx AI Inference, logs it in memory, optionally alerts staff in Slack, and sends an SMS confirmation.

## What It Does

- Answers inbound voice calls on a Telnyx Call Control Application
- Starts the Telnyx AI Assistant you configure in `.env`
- Tracks high-level assistant conversation events for a local dashboard
- Accepts inbound SMS guest requests
- Categorizes SMS requests into `room_service`, `housekeeping`, `concierge`, or `maintenance`
- Marks urgent SMS requests when guests mention fire, smoke, flooding, leaks, lockouts, gas, medical issues, injury, or 911
- Sends SMS confirmations and completion messages
- Optionally posts staff alerts to Slack

## Telnyx Webhook Events

The app handles the voice, SMS, and assistant events Telnyx sends to the webhook URLs you configure in the Portal. You do not need to manually provide call IDs; Telnyx includes those in webhook payloads during each call.

- `call.initiated` - answers inbound voice calls
- `call.answered` - starts the configured AI Assistant
- `call.conversation.ended` - records high-level conversation activity
- `call.conversation_insights.generated` - records high-level conversation activity
- `call.hangup` - removes the call from local active-call state
- `message.received` - categorizes and logs inbound SMS requests

## Architecture

```text
  Inbound voice call
        |
        v
  Telnyx Call Control webhook
        |
        v
  Flask app answers call
        |
        v
  Starts configured AI Assistant
        |
        v
  Telnyx AI Assistant handles the conversation

  Inbound SMS
        |
        v
  Flask app categorizes request with AI Inference
        |
        v
  Local request log + optional Slack alert + SMS confirmation
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Description |
| --- | --- | --- |
| `TELNYX_API_KEY` | yes | Telnyx API v2 key used to answer calls, send SMS, and call AI Inference. |
| `MAIN_NUMBER` | yes | Telnyx number used for the hotel line and outbound SMS confirmations. |
| `TELNYX_ASSISTANT_ID` | yes for voice | Telnyx AI Assistant ID copied from the Portal. |
| `TELNYX_PUBLIC_KEY` | recommended | Verifies inbound webhook signatures. If omitted, verification is skipped for local development. |
| `AI_MODEL` | no | Model used to categorize SMS requests. Defaults to `openai/gpt-4o`. |
| `STAFF_SLACK_WEBHOOK` | no | Slack incoming webhook for staff alerts. |
| `HOST` | no | Bind host. Defaults to `127.0.0.1`. |
| `PORT` | no | HTTP server port. Defaults to `5000`. |

## Set Up the AI Assistant

Create a Telnyx AI Assistant in the Portal and enable telephony. A good starting prompt is:

```text
you are the phone concierge for the grand hotel.

you help hotel guests with room service, housekeeping, concierge requests, and maintenance issues.

ask for the room number if the caller has not given it. collect one clear request at a time. if the guest reports fire, smoke, flooding, gas, medical issues, injury, being locked out, or an active leak, treat it as urgent and say staff will be notified immediately.

for normal requests, confirm the room, repeat the request briefly, and say the hotel team has logged it and will follow up by text.

keep responses short and natural. ask one question at a time. do not claim to access a real hotel pms, room inventory, payment system, or staff dispatch system.
```

Set the assistant's greeting in the Portal.

## Run Locally

```bash
cd telnyx-code-examples/hotel-guest-services-python
cp .env.example .env
pip install -r requirements.txt
python app.py
```

The server starts on `http://localhost:5000`.

Expose the local server so Telnyx can deliver webhooks:

```bash
ngrok http 5000
```

Configure webhooks in the Telnyx Portal:

- Call Control Application webhook URL: `https://<id>.ngrok.io/webhooks/voice`
- Messaging Profile inbound webhook URL: `https://<id>.ngrok.io/webhooks/sms`

Assign your Telnyx number to the Call Control Application for voice. Assign the same number, or any hotel SMS number, to the Messaging Profile for SMS.

## Demo Flow

1. Open the local dashboard at `http://localhost:5000`.
2. Call the Telnyx number assigned to your Call Control Application.
3. The Flask app answers and starts the configured Telnyx AI Assistant.
4. Talk to the assistant as a hotel guest.
5. Text the number with a request such as `room 205 needs extra towels` to test the SMS request workflow.
6. View open SMS requests:

   ```bash
   curl http://localhost:5000/requests | python3 -m json.tool
   ```

7. Mark a request complete:

   ```bash
   curl -X POST http://localhost:5000/requests/0/complete
   ```

## API Reference

### `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Telnyx calls this endpoint automatically.

### `POST /webhooks/sms`

Receives Telnyx Messaging webhook events. Telnyx calls this endpoint automatically.

### `GET /requests`

Lists locally logged SMS requests.

Optional query parameters:

- `department=room_service|housekeeping|concierge|maintenance`
- `status=open|completed`

### `POST /requests/<idx>/complete`

Marks an SMS request complete and sends a completion SMS to the guest.

### `GET /events`

Lists sanitized, high-level voice assistant events for the local dashboard.

### `GET /health`

Returns service health, assistant configuration status, active call count, and open request count.

## Notes

- Voice conversation content and full assistant history live in Telnyx AI Assistants conversation history.
- The local `/requests` endpoint tracks SMS requests only.
- This example uses in-memory state for demo simplicity. Use a database or queue for production.
- Keep `TELNYX_PUBLIC_KEY` set outside local testing so webhook signature verification is enforced.

## Why Telnyx

Telnyx provides the AI Communications Infrastructure for the full guest services flow: Voice handles the hotel phone call, AI Assistants run the live conversation, Messaging sends guest confirmations, and AI Inference classifies SMS requests.

## Troubleshooting

- If calls ring forever, confirm the phone number is assigned to the Call Control Application and the voice webhook points to `/webhooks/voice`.
- If the assistant does not speak, confirm `TELNYX_ASSISTANT_ID` is set and the assistant has telephony enabled in the Telnyx Portal.
- If SMS confirmations fail, confirm `MAIN_NUMBER` is SMS-capable and assigned to the Messaging Profile.
- If webhooks are rejected, confirm `TELNYX_PUBLIC_KEY` matches the Portal public key or omit it only for local development.
- If the dashboard looks idle, call `/health` and check that `assistant_configured` is `true`.

## Related Examples

- [AI Assistant Phone Setup](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-assistant-phone-setup-python/README.md)
- [Create AI Assistant](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/create-ai-assistant-python/README.md)
- [Receive SMS Webhook](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-python/README.md)
- [Build a Voice AI Agent](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-voice-ai-agent-python/README.md)

## Resources

- [Telnyx AI Assistant quickstart](https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant)
- [Start AI Assistant command](https://developers.telnyx.com/api-reference/call-commands/start-ai-assistant)
- [Call Control overview](https://developers.telnyx.com/docs/voice/call-control)
- [Messaging overview](https://developers.telnyx.com/docs/messaging)
- [AI Inference overview](https://developers.telnyx.com/docs/inference)
