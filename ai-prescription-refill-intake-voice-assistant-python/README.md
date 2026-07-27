---
name: ai-prescription-refill-intake-voice-assistant
title: "AI Prescription Refill Intake Voice Assistant"
description: "Create a Telnyx AI Assistant that answers prescription refill calls, collects medication and pharmacy details, flags requests for manual review, and queues pharmacy callbacks."
language: python
framework: flask
telnyx_products: [AI Assistants, Voice, Call Control, Messaging]
integrations: [Slack]
channel: [voice]
---

# AI Prescription Refill Intake Voice Assistant

This example creates a Telnyx AI Assistant for an inbound prescription refill line. The assistant handles the live voice conversation while a small Flask backend handles workflow actions: creating refill requests, flagging requests for manual pharmacy review, and queueing callbacks.

This sample demonstrates HIPAA-aware engineering patterns, not legal compliance certification. A production healthcare deployment still needs the covered entity or business associate controls around policies, access, retention, auditing, and agreements.

## What You Are Building

- A Telnyx AI Assistant with a prescription refill intake prompt
- A Call Control webhook that answers inbound calls and starts the assistant with `ai_assistant_start`
- Webhook tools the assistant can call during the conversation:
  - `create_refill_request`
  - `flag_manual_review`
  - `queue_callback`
- A dynamic variables endpoint for clinic-specific assistant context
- A minimal refill request API for staff review

## Architecture

```text
caller
  |
  v
telnyx phone number
  |
  v
call control application -> flask /webhooks/voice
  |
  v
answer call -> ai_assistant_start
  |
  v
telnyx ai assistant
  |
  +--> /tools/create_refill_request
  +--> /tools/flag_manual_review
  +--> /tools/queue_callback
```

## Telnyx APIs Used

- **AI Assistants API**: create/update the refill assistant and webhook tools.
- **Call Control Answer**: `POST /v2/calls/{call_control_id}/actions/answer`
- **Start AI Assistant**: `POST /v2/calls/{call_control_id}/actions/ai_assistant_start`
- **Messaging API**: optional SMS callback confirmation.

## Requirements

- Python 3.9+
- Telnyx API key
- Telnyx phone number with voice enabled
- Public HTTPS URL for local development, such as ngrok

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-prescription-refill-intake-voice-assistant-python

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login

# Provision resources
telnyx available-phone-numbers list --country US --features sms
telnyx number-orders create --phone-number +15551234567
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>


Fill in `.env`:

```bash
TELNYX_API_KEY=KEY_your_telnyx_api_key_here
PUBLIC_BASE_URL=https://your-public-url.example.com
TOOL_SECRET=replace_with_a_random_shared_secret
TELNYX_PHONE_NUMBER=+18005551234
```

Get your Telnyx public key from the Portal or API and set:

```bash
TELNYX_PUBLIC_KEY=your_telnyx_public_key_here
```

## Run Locally

Start the Flask backend:

```bash
python app.py
```

Expose it:

```bash
ngrok http 5000
```

Set `PUBLIC_BASE_URL` in `.env` to the ngrok HTTPS URL.

## Create Or Update The Assistant

```bash
python provision_assistant.py
```

Copy the printed assistant ID into `.env`:

```bash
TELNYX_ASSISTANT_ID=assistant-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

The provisioned assistant uses:

- model: `moonshotai/Kimi-K2.6`
- dynamic variables from `/dynamic-variables`
- webhook tools for refill requests, manual review, and callbacks
- one-question-at-a-time conversation behavior

## Configure The Phone Number

Create or update a Call Control Application in the Telnyx Portal:

- Webhook URL: `https://your-public-url.example.com/webhooks/voice`
- Webhook API version: `2`

Assign your Telnyx phone number to that Call Control Application. When the number receives an inbound call, this app answers and starts the configured AI Assistant.

## API Endpoints

### `POST /webhooks/voice`

Receives Telnyx Call Control webhooks. On inbound calls, it answers the call and starts the configured AI Assistant.

### `POST /tools/create_refill_request`

Creates a minimal refill request from assistant-provided intake context.

### `POST /tools/flag_manual_review`

Marks a refill request for manual pharmacy review and optionally sends a Slack notification.

### `POST /tools/queue_callback`

Queues a pharmacy team callback and optionally sends SMS confirmation.

### `GET /refills/requests`

Returns recent refill requests with masked caller identifiers.

### `GET /health`

Checks server status.

## HIPAA-Aware Safeguards Demonstrated

- Webhook signature verification with `TELNYX_PUBLIC_KEY`
- Minimum necessary refill summaries
- Masked caller identifiers in stored request records
- Shared secret on assistant tool endpoints
- Manual review for controlled substances, dosage changes, side effects, urgent access issues, and callback requests
- Explicit instruction that the assistant never approves or denies refills

## Production Notes

- Replace in-memory storage with an encrypted datastore.
- Apply authentication and role-based access control to staff APIs.
- Configure retention and deletion policies for PHI.
- Avoid sending raw PHI to Slack, logs, or non-healthcare systems unless your compliance program allows it.
- Review HIPAA obligations, BAAs, and security safeguards with your legal/compliance team.

## Why Telnyx

Telnyx provides the AI Communications Infrastructure for this workflow: programmable voice, Call Control webhooks, AI Assistants, webhook tools, and optional Messaging API confirmations in one platform. That lets the voice assistant answer the call, collect structured refill context, and hand off staff-review actions to your backend.

## Troubleshooting

- If inbound calls do not reach the app, confirm the phone number is assigned to the Call Control Application and the webhook URL points to `/webhooks/voice`.
- If Telnyx webhooks return `401`, check that `TELNYX_PUBLIC_KEY` is correct or leave it unset only for local testing.
- If assistant tools return `401`, make sure `TOOL_SECRET` matches the secret used when running `provision_assistant.py`.
- If no refill request appears, verify the assistant has `TELNYX_ASSISTANT_ID` set and the tool URLs use your current public HTTPS URL.

## Related Examples

- [Prescription Refill Line](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/prescription-refill-line-python/README.md)
- [Route Phone Calls to an AI Agent](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-python/README.md)
- [AI Assistant Multi-Tool](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-assistant-multi-tool-python/README.md)

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Telnyx AI Assistant quickstart](https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant)
- [Attach an AI Assistant to a Call](https://developers.telnyx.com/docs/voice/programmable-voice/ai-assistant-start)
- [AI Assistant dynamic variables](https://developers.telnyx.com/docs/inference/ai-assistants/dynamic-variables)
- [AI Assistant conversation workflows](https://developers.telnyx.com/docs/inference/ai-assistants/workflows)
