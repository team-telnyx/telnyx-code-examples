# AI Billing Warm Transfer with Python

This example keeps the warm-transfer flow intentionally small:

1. A billing AI prompt gathers the caller's billing issue and asks whether they
   want a specialist.
2. One transfer helper dials `HUMAN_TRANSFER_NUMBER`.
3. When the specialist leg answers, the app bridges the two call legs and starts
   the specialist AI prompt with the billing context.

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
