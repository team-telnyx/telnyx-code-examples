# Build a Hotel Guest Services Line

This guide shows how to run a hotel guest services line with Telnyx Voice, AI Assistants, Messaging, and AI Inference.

The voice path uses a Telnyx AI Assistant. The Flask app answers inbound calls and starts the assistant you configure in `.env`. This avoids hand-rolling real-time speech recognition and turn-taking in the webhook server.

The SMS path stays in the Flask app. It categorizes inbound guest messages and tracks those requests in memory.

## How It Works

```text
  Voice call -> Telnyx Call Control -> Flask webhook -> configured AI Assistant
                                                        |
                                                        v
                                              Telnyx AI Assistant

  SMS -> Telnyx Messaging webhook -> Flask app -> AI Inference categorization
                                             |
                                             v
                              request log, SMS confirmation, Slack alert
```

## Telnyx Products Used

- Voice Call Control for answering calls and starting the assistant
- AI Assistants for the live voice conversation
- Messaging for inbound guest SMS and outbound confirmations
- AI Inference for SMS request categorization

## Prerequisites

- Python 3.8+
- Telnyx API key
- Telnyx phone number with voice enabled
- Telnyx Call Control Application
- Telnyx AI Assistant with telephony enabled
- Messaging Profile for SMS
- ngrok or another public HTTPS tunnel for local webhook testing
- Slack incoming webhook, optional

## Step 1: Create the AI Assistant

Create an assistant in the Telnyx Portal under AI Assistants. Enable telephony and copy the assistant ID into `.env` as `TELNYX_ASSISTANT_ID`.

Suggested assistant instructions:

```text
you are the phone concierge for the grand hotel.

you help hotel guests with room service, housekeeping, concierge requests, and maintenance issues.

ask for the room number if the caller has not given it. collect one clear request at a time. if the guest reports fire, smoke, flooding, gas, medical issues, injury, being locked out, or an active leak, treat it as urgent and say staff will be notified immediately.

for normal requests, confirm the room, repeat the request briefly, and say the hotel team has logged it and will follow up by text.

keep responses short and natural. ask one question at a time. do not claim to access a real hotel pms, room inventory, payment system, or staff dispatch system.
```

Suggested greeting:

```text
thank you for calling the grand hotel guest services line. what room are you calling from?
```

## Step 2: Configure the Project

```bash
cd telnyx-code-examples/hotel-guest-services-python
cp .env.example .env
pip install -r requirements.txt
```

Fill in `.env`:

```bash
TELNYX_API_KEY=KEY...
MAIN_NUMBER=+18005551234
TELNYX_ASSISTANT_ID=assistant-...
TELNYX_PUBLIC_KEY=...
```

For a local demo, the first three values are the important ones. `TELNYX_PUBLIC_KEY` is strongly recommended outside local testing because it lets the app verify inbound webhook signatures.

## Step 3: Run the App

```bash
python app.py
```

Open the dashboard:

```text
http://localhost:5000
```

Expose the app:

```bash
ngrok http 5000
```

## Step 4: Configure Telnyx Webhooks

In the Telnyx Portal:

- Set the Call Control Application webhook URL to `https://<id>.ngrok.io/webhooks/voice`
- Assign the hotel phone number to that Call Control Application
- Set the Messaging Profile inbound webhook URL to `https://<id>.ngrok.io/webhooks/sms`
- Assign the SMS-capable number to that Messaging Profile

## Step 5: Test Voice

Call the number assigned to the Call Control Application.

Expected flow:

1. Telnyx sends `call.initiated`.
2. The app answers the call.
3. Telnyx sends `call.answered`.
4. The app starts the configured AI Assistant.
5. The Telnyx AI Assistant runs the rest of the conversation.

The local dashboard shows high-level call activity. Full conversation history is available in Telnyx AI Assistants conversation history.

## Step 6: Test SMS

Text the number with a request:

```text
room 205 needs extra towels
```

List requests:

```bash
curl http://localhost:5000/requests | python3 -m json.tool
```

Mark the first request complete:

```bash
curl -X POST http://localhost:5000/requests/0/complete
```

## Endpoint Summary

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Local dashboard |
| `POST` | `/webhooks/voice` | Telnyx voice webhook |
| `POST` | `/webhooks/sms` | Telnyx SMS webhook |
| `GET` | `/requests` | List SMS requests |
| `POST` | `/requests/<idx>/complete` | Complete an SMS request |
| `GET` | `/events` | List sanitized voice assistant events |
| `GET` | `/health` | Health check |

## Production Notes

- Replace in-memory state with persistent storage.
- Keep `TELNYX_PUBLIC_KEY` configured to verify webhook signatures.
- Use a stable public URL instead of a local tunnel.
- Add authentication to local administrative endpoints such as `/requests`.
- Use Telnyx AI Assistant tools or post-conversation insights if you need structured voice-call request extraction.

## Resources

- [Telnyx AI Assistant quickstart](https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant)
- [Start AI Assistant command](https://developers.telnyx.com/api-reference/call-commands/start-ai-assistant)
- [Telnyx Messaging docs](https://developers.telnyx.com/docs/messaging)
