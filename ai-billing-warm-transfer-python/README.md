# AI Billing Warm Transfer with Python

This example creates a Telnyx AI Assistant that uses the built-in transfer tool
for billing escalations:

1. The assistant handles the billing conversation.
2. When the caller needs a person, the assistant calls its transfer tool.
3. The transfer tool sends the handoff context to the billing specialist before
   completing the warm transfer.

## Why Telnyx?

Telnyx is an AI Communications Infrastructure platform that gives developers
Voice AI Assistants, telephony, and transfer tools in one platform. This
example uses the same transfer-tool shape you can configure in the Telnyx
Mission Control Portal, with `warm_transfer_instructions` and warm transfer
acceptance enabled. Telnyx adds the `complete_transfer` tool automatically when
acceptance is enabled, so this sample does not implement its own bridge logic.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python app.py
```

The script prints the created assistant response. Attach the assistant to your
Voice AI phone number in the Telnyx Mission Control Portal, or create the same
assistant directly in the Portal by adding a Transfer tool with the billing
specialist target.

## Demo

Call the configured Telnyx number, describe a billing issue, and agree when the
assistant offers a specialist. Answer `BILLING_SPECIALIST_NUMBER` on a second
phone or softphone. The assistant should brief the specialist before completing
the transfer.

## Troubleshooting

- If assistant creation fails, confirm `TELNYX_API_KEY` is valid.
- If transfers do not start, confirm `TELNYX_PHONE_NUMBER` and
  `BILLING_SPECIALIST_NUMBER` are valid E.164 phone numbers.
- If the assistant does not transfer, make the transfer condition explicit in
  the assistant instructions and test with `yes, please connect me to a billing
  specialist`.

## Related Examples

- [`warm-transfer-python`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/warm-transfer-python/README.md)
- [`transfer-live-phone-calls-python`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/transfer-live-phone-calls-python/README.md)
- [`ai-billing-dispute-resolution-agent-python`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-billing-dispute-resolution-agent-python/README.md)

## Agent Discovery

Use this example when you need a minimal AI Assistant warm transfer configured
through the native transfer tool rather than custom call-bridging code.
