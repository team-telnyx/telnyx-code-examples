---
name: insights-pipeline
title: "Structured-Insights Pipeline Desk — Schema-First Conversation Mining"
description: "Build a schema-first structured-insights pipeline over Telnyx AI conversations and render a typed QA scorecard."
language: python
framework: flask
telnyx_products: [AI, AI Insights, Inference, Voice]
---

# Structured-Insights Pipeline Desk — Schema-First Conversation Mining

A Flask app + CLI that creates strict `json_schema` insight templates, bundles them into an insight group, wires the group to an assistant, places a demo call, consumes the `call.conversation.insights_generated` webhook, and renders a QA scorecard from typed records — no regex parsing anywhere.

## The Story

A regional outpatient clinic runs a patient-services line where every call is a potential compliance event: a frustrated patient demanding a human, an agent who forgets the mandatory callback-disclosure line, a date-of-birth verification that never happened. If the clinic cannot prove — per call, in a dashboard — that identity was verified and disclosure was stated, it is exposed to HIPAA findings, payer audits, and the slow erosion of patient trust that no marketing budget repairs. The clinic does not need another pile of free-text call summaries; it needs typed records that land in a QA console without a human reading transcripts.

The actor IS the clinic's structured-insights pipeline. It is born when three insight templates are created — sentiment, compliance, escalation — each declaring a strict `json_schema` so the model's output is a typed record, not prose. It evolves as the templates are bundled into a group, the group is attached to the assistant's `insight_settings`, and every call conversation is analyzed once with all templates applied. It survives the ordinary chaos of the job: the webhook receiver goes down mid-shift and the pipeline keeps working through the polling path, a record arrives still `in_progress` and is held as a pending row rather than counted as a failure, and a malformed record is caught by the schema validator and excluded from the aggregates instead of poisoning the dashboard. It completes when the scorecard renders — sentiment distribution, compliance-flag rates, escalation breakdown — and it terminates cleanly when the demo call ends and the insight set is marked `completed`.

The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx is **AI Communications Infrastructure**: the assistant, the conversation, the inference, and the structured-insights extraction all live on one platform, so a schema declared at template-creation time is the same schema the model is constrained to at inference time. There is no glue layer between the voice call and the analytics record — the insight group is attached to the assistant, the assistant places the call, and the typed record arrives over the same webhook surface that carries every other Telnyx event. That is what makes the schema-first pattern viable in production: the contract is enforced by the platform, not by a parser you wrote.

## Telnyx API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/ai/conversations/insights` | Create an insight template (`name`, `instructions`, `json_schema`, optional `webhook`) |
| `GET` | `/ai/conversations/insights` | List templates (used for idempotency drift check) |
| `POST` | `/ai/conversations/insight-groups` | Create an insight group (`name`, `description`, `webhook`) |
| `GET` | `/ai/conversations/insight-groups/{group_id}` | Re-read the group to verify membership |
| `POST` | `/ai/conversations/insight-groups/{group_id}/insights/{insight_id}/assign` | Assign a template to the group |
| `POST` | `/ai/assistants` | Create the demo assistant with `insight_settings` |
| `POST` | `/ai/assistants/{assistant_id}` | Update an existing assistant's `insight_settings` |
| `GET` | `/ai/assistants/{assistant_id}` | Verify the group is attached |
| `POST` | `/ai/assistants/{assistant_id}/scheduled_events` | Place the demo call (`telnyx_conversation_channel: phone_call`) |
| `GET` | `/ai/conversations/{conversation_id}/conversations-insights` | Poll per-conversation insight records |
| Webhook | `call.conversation.insights_generated` | Fires when a conversation's insight set completes |

## Architecture

The pipeline has four layers, and each one only talks to its neighbor.

```text
┌─────────────────────────┐
│  Insight Templates      │  POST /ai/conversations/insights
│  sentiment-v1           │  each declares a strict json_schema
│  compliance-v1          │  (object form, explicit required + enums)
│  escalation-v1          │
└───────────┬─────────────┘
            │ assign
            ▼
┌─────────────────────────┐
│  Insight Group          │  POST /ai/conversations/insight-groups
│  qa-scorecard-v1        │  POST .../insights/{insight_id}/assign
│  (membership verified)  │  GET  .../insight-groups/{group_id}
└───────────┬─────────────┘
            │ insight_settings.insight_group_id
            ▼
┌─────────────────────────┐
│  Assistant              │  POST /ai/assistants (or /{id})
│  insights-pipeline-demo │  GET  /ai/assistants/{id}  (verify)
└───────────┬─────────────┘
            │ scheduled_events (phone_call)
            ▼
┌─────────────────────────┐        ┌──────────────────────────┐
│  Demo Call Conversation │───────▶│  Webhook Receiver        │
│  (frustrated patient)   │        │  call.conversation.      │
└───────────┬─────────────┘        │  insights_generated      │
            │                      │  → append conversation_id│
            │                      └──────────┬───────────────┘
            │                                 │
            │  GET .../conversations-insights │  (poll fallback,
            ▼                                 ▼   source of truth)
┌─────────────────────────────────────────────────────────────┐
│  Scorecard Renderer                                         │
│  schema-validate each record → aggregate                     │
│  sentiment distribution · compliance-flag rates ·            │
│  escalation breakdown · schema-invalid IDs · pending IDs     │
└─────────────────────────────────────────────────────────────┘
```

**Insight templates** are the extraction definitions — one per concern — each declaring its own `json_schema` (accepted as a string or an object; this sample sends the object serialized as a string).

The **insight group** bundles the templates; the assistant's `insight_settings` references the group, so every call conversation is analyzed once with all templates applied — no per-call wiring.

The **webhook receiver** (Flask) consumes `call.conversation.insights_generated` for push delivery. Polling `GET .../conversations-insights` is the fallback, and it is also the source of truth for the scorecard: the receiver prints the full payload keys on first receipt, then appends the conversation ID to the local store so the scorecard can pick it up.

The **scorecard renderer** schema-validates each record and aggregates into the report.

Insight statuses drive the readiness gate: records still `pending` or `in_progress` are pending rows, not failures — the sample distinguishes "not ready yet" from "schema-invalid".

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `ASSISTANT_ID` | `string` | `your_assistant_id_here` | **yes** | Existing assistant to wire the insight group to. If unset, `wire-assistant` creates a new assistant. | Telnyx Portal → AI → Assistants |
| `ASSISTANT_PHONE_NUMBER` | `string` | `+1555XXXXXXXX` | **yes** | Phone number already associated with the assistant (used as `telnyx_agent_target`). | Telnyx Portal → AI → Assistants → Phone Numbers |
| `CONVERSATIONS_STORE` | `string` | `conversations.json` | **yes** | Path to the local JSON-lines store of conversation IDs. | Local path |
| `DEMO_MODE` | `string` | `true` | **yes** | When `true`, `place-call` logs the payload instead of placing a real call. | Local config |
| `DESTINATION_NUMBER` | `string` | `+1555XXXXXXXX` | **yes** | The number the demo call dials (`telnyx_end_user_target`). | Your test phone |
| `PORT` | `string` | `8000` | **yes** | Port the Flask webhook receiver binds to. | Local config |
| `PUBLIC_WEBHOOK_BASE_URL` | `string` | `https://your-subdomain.ngrok.app` | **yes** | Public base URL registered into template and group `webhook` fields. | `ngrok http 8000` |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | Telnyx API key used by the SDK. | Telnyx Portal → API Keys |
| `TELNYX_PUBLIC_KEY` | `string` | `your_telnyx_public_key_here` | **yes** | Ed25519 public key used to verify inbound webhook signatures. | Telnyx Portal → API Keys → Public Key |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/insights-pipeline

python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# edit .env with your TELNYX_API_KEY, TELNYX_PUBLIC_KEY,
# ASSISTANT_PHONE_NUMBER, DESTINATION_NUMBER, PUBLIC_WEBHOOK_BASE_URL
```

Expose the receiver locally (optional — the polling path works without it):

```bash
ngrok http 8000
# copy the https URL into PUBLIC_WEBHOOK_BASE_URL in .env
```

Run the pipeline end to end:

```bash
python app.py create-templates     # create the three json_schema templates
python app.py create-group         # create the group + assign templates
python app.py wire-assistant       # attach the group via insight_settings
python app.py serve                # start the webhook receiver (separate terminal)
python app.py place-call           # schedule the demo call (DEMO_MODE=true by default)
python app.py scorecard --date 2026-10-20
python app.py scorecard --strict   # demonstrate the schema-invalid failure mode
```

Verify the module loads:

```bash
python smoke_test.py
```

## API Reference

### `python app.py create-templates`

Creates (or idempotently updates) the three insight templates — `sentiment-v1`, `compliance-v1`, `escalation-v1` — each with a strict `json_schema` in object form. Prints each template ID and the template-count drift (expected `0` on re-run).

### `python app.py create-group`

Creates the `qa-scorecard-v1` insight group, assigns the three templates via the assign endpoint, then re-reads the group and prints its membership list.

### `python app.py wire-assistant`

Attaches the group to the assistant via `insight_settings.insight_group_id`, then verifies with `GET /ai/assistants/{id}` and prints the confirmed settings. Uses `ASSISTANT_ID` if set; otherwise creates a new assistant with the demo scenario in its `system_prompt`.

### `python app.py place-call`

Schedules a demo call through the assistant scheduled-event surface with `telnyx_conversation_channel: phone_call`, `telnyx_end_user_target: $DESTINATION_NUMBER`, `telnyx_agent_target: $ASSISTANT_PHONE_NUMBER`, and `scheduled_at_fixed_datetime` = now + 60 seconds. In `DEMO_MODE=true` it logs the payload and returns a synthetic conversation ID. In live mode it appends the returned `conversation_id` to the local store.

### `python app.py scorecard [--date <ISO date>] [--conversation-id <id>] [--strict]`

Pulls `GET /ai/conversations/{conversation_id}/conversations-insights` per conversation, validates every record against the declared schemas, and renders the scorecard:

```json
{
  "sentiment_distribution": {"negative": 1},
  "compliance_flag_rates": {"disclosure_missing": 1, "escalation_requested": 1},
  "escalation_breakdown": {"caller_request": 1},
  "schema_invalid": [],
  "pending": []
}
```

`--date` filters store rows by `received_at`. `--conversation-id` overrides the store for manual runs. `--strict` injects a synthetic record missing the required `positivity_score` field under the conversation ID `demo-synthetic-invalid`, flags it as schema-invalid, and excludes it from the aggregates.

### `python app.py serve`

Starts the Flask webhook receiver on `PORT`. Routes:

| Method | Route | Purpose |
|--------|-------|---------|
| `POST` | `/webhooks/telnyx` | Verify the Ed25519 signature, handle `call.conversation.insights_generated`, print payload keys, append the conversation ID to the store |
| `GET` | `/health` | Liveness probe |

### `python app.py print-url`

Prints the exact webhook URL that should be registered: `{PUBLIC_WEBHOOK_BASE_URL}/webhooks/telnyx`.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `ASSISTANT_PHONE_NUMBER is not set` | The assistant has no phone number associated | Associate a number with the assistant in the Telnyx Portal, then set `ASSISTANT_PHONE_NUMBER` |
| `DESTINATION_NUMBER is not set` | No test destination configured | Set `DESTINATION_NUMBER` in `.env` |
| Webhook returns `400 invalid signature` | `TELNYX_PUBLIC_KEY` missing or wrong | Copy the public key from the Telnyx Portal into `.env` |
| Scorecard shows every conversation as `pending` | Insight set has not completed yet | Wait for `call.conversation.insights_generated`, or re-run `scorecard` after a minute |
| `schema_invalid` contains a real conversation ID | The model returned a record that violates the declared schema | Inspect the record; tighten `instructions` on the template so the model is guided toward the required fields |
| Template count drift is non-zero | A previous run created templates with different names | Templates are idempotently named (`sentiment-v1`, etc.); delete strays or rename |
| `ngrok` URL changes on restart | Free ngrok tunnels rotate | Re-run `create-templates` and `create-group` so the new URL is registered in the `webhook` fields |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI on GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [AI Assistant with Inference](https://github.com/team-telnyx/telnyx-code-examples/tree/main/ai-assistant-inference)
- [Conversation Insights Polling](https://github.com/team-telnyx/telnyx-code-examples/tree/main/conversation-insights-polling)
- [Webhook Signature Verification](https://github.com/team-telnyx/telnyx-code-examples/tree/main/webhook-signature-verification)

## Resources

- [Structured data insights](https://developers.telnyx.com/docs/inference/ai-insights/structured-insights)
- [Insight groups](https://developers.telnyx.com/docs/inference/ai-insights/insight-groups)
- [Create insight template](https://developers.telnyx.com/api-reference/conversations/create-insight-template)
- [Create insight template group](https://developers.telnyx.com/api-reference/conversations/create-insight-template-group)
- [Assign insight template to group](https://developers.telnyx.com/api-reference/conversations/assign-insight-template-to-group)
- [Get insights for a conversation](https://developers.telnyx.com/api-reference/conversations/get-insights-for-a-conversation)
- [call.conversation.insights_generated webhook](https://developers.telnyx.com/api-reference/callbacks/call-conversation-insights-generated)
- [Update an assistant](https://developers.telnyx.com/api-reference/assistants/update-an-assistant)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Telnyx AI product page](https://telnyx.com/products/ai)
- [Telnyx pricing](https://telnyx.com/pricing)
