---
name: ai-pci-protected-payment-collection
title: "AI PCI Protected Payment Collection"
description: "A PCI-protected inbound payment collection demo using Telnyx Voice API, AI Assistants, webhook tools, and Pay over Voice."
language: python
framework: flask
telnyx_products: [Voice API, AI Assistants, Pay over Voice]
channel: [voice]
---

# AI PCI Protected Payment Collection

This demo answers an inbound billing call, verifies the caller, negotiates a payment plan, and starts a Telnyx Pay over Voice session for secure card collection.

Use this example to build AI Communications Infrastructure for PCI-protected voice payment workflows.

The important PCI point is that the app does **not** gather card digits itself. Telnyx Pay over Voice handles the payment IVR and automatically masks recording, transcription, assistant audio, and DTMF logging while payment details are entered.

The assistant uses two webhook tools:

- `start_secure_payment` starts Telnyx Pay over Voice after the caller agrees to a payment plan.
- `record_secure_payment_complete` records a sanitized completion marker only after Telnyx sends a Pay over Voice completion event.

## Telnyx DevDocs Used

- [Voice API Commands and Resources](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-commands-and-resources)
- [Attach an AI Assistant to a Call](https://developers.telnyx.com/docs/voice/programmable-voice/ai-assistant-start)
- [Pay over Voice](https://developers.telnyx.com/docs/voice/programmable-voice/pay)

## Flow

1. Caller dials the Telnyx billing number.
2. App answers with Voice API.
3. App starts a Telnyx AI Assistant with `ai_assistant_start`.
4. The assistant verifies DOB and negotiates the payment plan naturally.
5. Caller confirms consent to secure card collection.
6. The assistant calls the `start_secure_payment` webhook tool.
7. The Flask tool starts `POST /v2/calls/{call_control_id}/pay` on the active call.
8. Telnyx Pay over Voice collects card number, expiration, zip, and security code.
9. Telnyx sends payment progress/completed webhooks to the app.
10. After Telnyx sends a payment completion event, the assistant can call `record_secure_payment_complete` to create a PCI-safe completion marker for the portal and dashboard.

## Setup

```bash
cd ai-pci-protected-payment-collection-python
cp .env.example .env
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Expose the app:

```bash
ngrok http 5000
```

Configure your Telnyx Voice API application webhook URL:

```text
https://<ngrok-id>.ngrok-free.app/webhooks/voice
```

Update `.env`:

```text
TELNYX_API_KEY=KEY...
PUBLIC_BASE_URL=https://<ngrok-id>.ngrok-free.app
PAY_CONNECTOR_NAME=pci-protected-payment-demo
TOOL_SECRET=<generate-a-random-secret>
```

Generate a local tool secret:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(24))"
```

Provision the Pay Connector and AI Assistant:

```bash
python provision_assistant.py
```

Copy the printed `TELNYX_ASSISTANT_ID` into `.env`, then start the app:

```bash
python app.py
```

Open the local dashboard:

```text
http://127.0.0.1:5000
```

Configure your Telnyx Voice API application to send inbound call webhooks to:

```text
https://<ngrok-id>.ngrok-free.app/webhooks/voice
```

Assign a Telnyx voice-capable phone number to that Voice API application, then call the number.

## Pay over Voice Setup

`provision_assistant.py` creates a test-mode generic Pay Connector that points to the local mock processor:

```text
https://<ngrok-id>.ngrok-free.app/webhooks/payment-processor
```

For test mode, use one of the Pay over Voice test card numbers from the Telnyx docs. A common Visa test card is:

```text
4111111111111111
```

Use any future expiration date in `MMYY` format, a postal code, and a 3-digit security code for local testing.

## Why Telnyx

Telnyx combines programmable voice, AI Assistants, and Pay over Voice in one workflow. The assistant can handle natural-language account verification and plan negotiation, while Pay over Voice moves sensitive card entry into a PCI-focused Telnyx-controlled flow.

## Environment Variables

| Variable | Required | Description |
|---|---:|---|
| `TELNYX_API_KEY` | yes | Telnyx API key. |
| `TELNYX_PUBLIC_KEY` | recommended | Public key for webhook signature verification. |
| `PUBLIC_BASE_URL` | yes for provisioning | Public HTTPS URL for this Flask app. |
| `PAY_CONNECTOR_NAME` | yes | Name of the Telnyx Pay Connector. |
| `PAYMENT_DESCRIPTION` | no | Description passed to Pay over Voice. |
| `TELNYX_ASSISTANT_ID` | yes | AI Assistant ID printed by `provision_assistant.py`. |
| `TOOL_SECRET` | recommended | Shared secret used by assistant webhook tools. |
| `DEMO_CUSTOMER_ID` | no | Customer id from `data/customers.json`, default `acct_1042`. |
| `PORT` | no | Flask port, default `5000`. |

## Demo Script

Use caller data from `data/customers.json`.

For Jordan Lee:

- Phone on file: `+15555550100`
- Date of birth: `1990-03-15`
- Balance: `$342.50`

Suggested call:

```text
caller: march fifteenth nineteen ninety
ai: your account is 45 days past due with a balance of $342.50...
caller: can i do forty dollars a week
ai: i can set that up as 8 weekly payments of $40.00 plus a final payment of $22.50...
caller: yes
pay over voice: enter card details on the keypad
```

Suggested keypad input:

```text
4111111111111111
0827
94111
123
```

## API Reference

### `POST /webhooks/voice`

Receives Telnyx Voice API webhooks.

Handled events include:

- `call.initiated`
- `call.answered`
- `call.conversation.ended`
- `call.conversation_insights.generated`
- `call_payment_progress`
- `call_payment_completed`
- `call.hangup`

### `POST /webhooks/payment-processor`

Mock payment processor endpoint for a Telnyx Pay Connector.

It returns a successful charge unless the card number ends in `0002`.

### `GET /health`

Returns demo configuration and runtime health.

### `GET /events`

Returns sanitized local audit events for the dashboard.

### `GET /sessions`

Returns completed payment sessions.

### `POST /tools/start-secure-payment`

Assistant webhook tool that starts Pay over Voice and returns `secure_payment_event: started`.

### `POST /tools/record-payment-complete`

Assistant webhook tool that records `secure_payment_event: completed` without storing card details.

## PCI Notes

This demo is designed to show a compliant architecture pattern, not to certify your production environment.

- The app never asks the caller to speak card data.
- The app never uses raw `gather_using_audio` to receive the PAN.
- The app starts Telnyx Pay over Voice for the sensitive card-entry step.
- The local dashboard logs only high-level payment status.
- The local dashboard and assistant tool responses do not log PAN, CVV, expiration date, postal code, or raw DTMF.
- This sample demonstrates a PCI-protected integration pattern. It does not certify your production environment by itself.

## Troubleshooting

- If the assistant does not answer, confirm `TELNYX_ASSISTANT_ID` is set and the Voice API application webhook points to `/webhooks/voice`.
- If the assistant tool fails with `unauthorized tool request`, make sure `TOOL_SECRET` in `.env` matches the value used by `provision_assistant.py`.
- If Pay over Voice does not start, confirm `PAY_CONNECTOR_NAME` matches the connector created by `provision_assistant.py`.
- If Pay starts but no progress or completion events appear, confirm the Pay Connector endpoint is reachable at `/webhooks/payment-processor` and returns either `charge_id` or `token_id` with empty `error_code`.
- If card digits appear in your app logs, stop and review the integration. This sample should only log sanitized payment status, masked payment fields, or assistant tool markers.

## Related Examples

- [route-phone-calls-to-ai-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-python/README.md)
- [chat-with-ai-assistant-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/chat-with-ai-assistant-python/README.md)
- [ai-assistant-multi-tool-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-assistant-multi-tool-python/README.md)

## Agent Discovery

Agents should start with `README.md`, then inspect `API.md` for endpoint contracts and `provision_assistant.py` for assistant/tool provisioning. The primary runtime entrypoint is `app.py`.
