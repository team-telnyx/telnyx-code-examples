# AI Billing Warm Transfer with Python and Flask

This example builds a focused, inbound billing-dispute warm transfer with
Telnyx Call Control. A fictional Cedar Harbor Bank billing agent collects the
caller's issue, asks for consent to open a dispute with a specialist, calls the
specialist leg, and bridges the original caller after the specialist
introduction.

This is a real two-leg transfer. The sample does not fake the handoff by merely
changing the voice on one call. For a production-style demo, use a second phone
or softphone as `HUMAN_TRANSFER_NUMBER`. A single phone can work only when the
carrier supports call waiting and the second leg can be answered.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Set the API key, Call Control Application ID, Telnyx number, and specialist
destination in `.env`. Configure the Call Control Application webhook as:

```text
https://your-public-host.example/webhooks/voice
```

For local testing:

```bash
python app.py
ngrok http 5000
```

## Demo

Call the Telnyx number and say:

```text
i was charged twice with an invoice
```

When the agent asks whether to connect you to a billing specialist, say:

```text
yes, please connect me
```

The specialist leg receives a different Telnyx Ultra voice before the calls are
bridged.

See [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) for the complete call script and
technical walkthrough.

## Production notes

This sample intentionally uses in-memory call state for readability. A
production service should add webhook signature verification, persistent state,
timeouts and fallback behavior, authentication, structured logging, and a real
specialist queue or agent endpoint.
