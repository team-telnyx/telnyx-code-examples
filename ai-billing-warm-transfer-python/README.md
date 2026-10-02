# AI Billing Warm Transfer with Python

This example keeps the warm-transfer flow intentionally small:

1. A billing AI prompt gathers the caller's billing issue and asks whether they
   want a specialist.
2. One transfer helper dials `HUMAN_TRANSFER_NUMBER`.
3. When the specialist leg answers, the app bridges the two call legs and starts
   the specialist AI prompt with the billing context.

## Why Telnyx?

Telnyx is an AI Communications Infrastructure platform that gives developers
programmable voice, Call Control, and AI primitives in one API. This example
uses Telnyx to answer an inbound call, gather structured AI output, dial a
specialist leg, and bridge both calls.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python app.py
```

Set your Call Control Application webhook to:

```text
https://your-public-host.example/webhooks/voice
```

For local testing, expose Flask with `ngrok http 5000`.

## Demo

Call the configured Telnyx number, describe a billing issue, and agree when the
agent offers a specialist. Answer `HUMAN_TRANSFER_NUMBER` on a second phone or
softphone to complete the bridge.

## Troubleshooting

- If the inbound call is not answered, confirm the Call Control Application
  webhook points to `/webhooks/voice`.
- If the specialist leg is not created, confirm `HUMAN_TRANSFER_NUMBER`,
  `TELNYX_PHONE_NUMBER`, and `TELNYX_CONNECTION_ID` are set.
- If the AI result does not approve the transfer, try a direct answer such as
  `yes, please connect me`.

## Related Examples

- [`warm-transfer-python`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/warm-transfer-python/README.md)
- [`transfer-live-phone-calls-python`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/transfer-live-phone-calls-python/README.md)
- [`ai-billing-dispute-resolution-agent-python`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-billing-dispute-resolution-agent-python/README.md)

## Agent Discovery

Use this example when you need a minimal AI-assisted warm transfer: one prompt
for intake, one prompt for the specialist, and one helper that creates the
specialist call leg before bridging.
