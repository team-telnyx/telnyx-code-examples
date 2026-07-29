---
name: ai-lab-results-notification-voice
title: "AI Lab Results Notification Voice Assistant"
description: "Create a Telnyx AI Assistant for HIPAA-compliant lab results workflows that verifies patients, delivers normal lab result summaries, sends secure portal links over SMS, and escalates abnormal results to a nurse."
language: python
framework: flask
telnyx_products: [AI Assistants, Voice, Messaging]
channel: [voice, sms]
---

# AI Lab Results Notification Voice Assistant

This example creates a Telnyx AI Assistant for HIPAA-compliant lab results workflows on Telnyx AI Communications Infrastructure. The assistant verifies identity against mock records, gives minimum-necessary result summaries, sends secure portal links by SMS, and escalates abnormal results to clinical staff.

The sample highlights compliance safeguards for healthcare voice AI: identity verification, minimum necessary disclosure, no lab values in SMS, recording disabled, assistant data retention disabled, and mock records only.

## What You Are Building

- A Telnyx AI Assistant with a lab results notification prompt
- A Telnyx phone number assigned directly to the assistant
- Native assistant messaging for secure portal links without a custom webhook
- A mock EHR JSON fixture for local development
- Optional Flask endpoints that show how to add verified lookup, audit, and escalation workflows

## Architecture

```text
patient
  |
  v
telnyx phone number
  |
  v
telnyx ai assistant
  |
  +--> verifies against mock records in the assistant prompt
  +--> sends secure portal link with native send_message
```

## Telnyx APIs Used

- **AI Assistants API**: create or update the results assistant.
- **AI Assistant Telephony**: attach the assistant directly to a Telnyx phone number.
- **Native assistant messaging**: send a secure portal link without lab values in the SMS body.

## Why Telnyx

Telnyx lets the phone number, voice assistant, transcription, text-to-speech, and secure follow-up messaging live in one communications platform. For healthcare demos, that keeps the architecture simpler: the inbound call can go directly to the AI Assistant, the SMS follow-up can use native assistant messaging, and the sample can keep recording and assistant data retention disabled.

## Requirements

- Python 3.11+
- Telnyx API key
- Telnyx phone number with voice and SMS enabled

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-lab-results-notification-voice-python

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
```

Fill in `.env`:

```bash
TELNYX_API_KEY=KEY_your_telnyx_api_key_here
TELNYX_PHONE_NUMBER=+18005551234
```

Get your Telnyx public key from the Portal or API and set:

```bash
TELNYX_PUBLIC_KEY=your_telnyx_public_key_here
```

## Create Or Update The Assistant

```bash
python provision_assistant.py
```

Copy the printed assistant ID into `.env`:

```bash
TELNYX_ASSISTANT_ID=assistant-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

The assistant uses:

- model: `moonshotai/Kimi-K2.6`
- voice: `voice ultra katie`
- native `send_message` for secure portal link texts
- greeting interruption protection and conservative end-of-turn settings
- recording disabled and assistant data retention disabled
- lowercase prompt text with no exclamation marks

## Configure The Phone Number

In the Telnyx Portal, assign your Telnyx phone number directly to the AI Assistant. When the number receives an inbound call, Telnyx starts the assistant without a local tunnel or separate Call Control webhook.

## Optional Local Extension

`app.py` includes Flask endpoints for teams that want to move verification, result lookup, audit events, or nurse routing out of the prompt and into a backend service. That path requires a public HTTPS URL and webhook signature verification, but it is not needed for the direct assistant demo.

## Troubleshooting

- If the assistant does not answer, confirm the Telnyx number is assigned directly to the AI Assistant in the Portal.
- If the assistant cuts off the greeting, confirm greeting interruption protection and conservative end-of-turn settings are applied by rerunning `python provision_assistant.py`.
- If SMS does not arrive, confirm the number has messaging enabled and the assistant includes the native `send_message` tool.
- If local endpoint tests return `unauthorized`, set `TOOL_SECRET` in `.env` and pass the same value in `X-Lab-Results-Tool-Secret`.
- If provisioning fails with an authentication error, verify `TELNYX_API_KEY` is set and has access to AI Assistants.

## Agent Discovery

This folder is self-contained for coding agents and answer engines. Start with `README.md` for the direct assistant flow, `provision_assistant.py` for the Telnyx Assistant payload, `app.py` for the optional Flask dashboard and webhook extension points, and `data/patients.json` for mock patient records. Do not use `.env` values in generated output or commits.

## HIPAA Compliance Safeguards

- Three-attempt identity verification before result lookup
- Minimum necessary lab result disclosure
- SMS messages that contain no lab values, only a secure portal link
- Masked phone and name displays in app state
- Mock EHR data only
- Recording disabled and assistant data retention disabled
- Escalation to nurse for abnormal results

## Production Notes

- Replace mock JSON and in-memory state with encrypted storage.
- Use proper staff authentication and role-based access control.
- Configure retention, deletion, access logs, and breach response policies.
- Use secure, authenticated portal links with single-use tokens and short TTLs.
- Pair the deployment with the required BAA, access controls, audit logging, retention policies, monitoring, and compliance review.

## Related Examples

- [AI Prescription Refill Intake Voice Assistant](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-prescription-refill-intake-voice-assistant-python/README.md)
- [Prescription Refill Line](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/prescription-refill-line-python/README.md)
- [Route Phone Calls to an AI Agent](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-python/README.md)

## Resources

- [Telnyx AI Assistants](https://developers.telnyx.com/docs/inference/ai-assistants)
- [Attach an AI Assistant to a Call](https://developers.telnyx.com/docs/voice/programmable-voice/ai-assistant-start)
- [Telnyx Messaging API](https://developers.telnyx.com/docs/messaging)
