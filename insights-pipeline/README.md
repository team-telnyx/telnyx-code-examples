---
name: insights-pipeline
title: "Structured-Insights Pipeline Desk — Schema-First Conversation Mining"
description: "Build a schema-first structured-insights pipeline over AI conversations: typed insight templates, insight groups, assistant wiring, webhook consumption, and a QA scorecard."
language: python
framework: fastapi
telnyx_products: [AI, AI Insights, AI Assistants, Webhooks]
---

# Structured-Insights Pipeline Desk — Schema-First Conversation Mining

A Python sample that turns AI conversation analysis into typed records — sentiment scores, compliance flags, escalation reasons — and renders them as a QA scorecard with zero regex parsing.

## The Story

A regional clinic network runs a patient-support line where every call is handled by an AI assistant. The compliance team needs to prove, per call, that the agent verified the caller's date of birth before discussing anything, that the mandatory callback-disclosure line was stated, and that escalations were logged with a reason. If that proof is missing or wrong, the clinic risks HIPAA findings, patient-safety incidents, and lost trust — and a free-text summary that someone has to regex-parse is not proof.

The actor IS the structured-insights pipeline. It is born when three insight templates are created — one for sentiment, one for compliance, one for escalation — each declaring a strict `json_schema` so the model's output is a typed record, not prose. It evolves as the templates are bundled into an insight group and attached to the assistant through `insight_settings`, so every call conversation is analyzed once with all templates applied. It completes when the `call.conversation.insights_generated` webhook fires and the scorecard pulls `GET /ai/conversations/{conversation_id}/conversations-insights`, validates every record against the declared schemas, and aggregates only the schema-valid ones. It survives the ordinary chaos of a live pipeline: the webhook receiver goes down mid-shift and the scorecard's polling path produces the identical report; a record arrives still `in_progress` and is counted as pending, not as a failure; a malformed record is flagged by conversation ID and excluded from the aggregates instead of poisoning them. The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx is **AI Communications Infrastructure** — the assistant, the conversation, the insight extraction, and the webhook that signals completion all live on one platform. That matters here because the schema-first pattern only works if the extraction layer and the transport layer agree on identity: the same `conversation_id` that the scheduled event returns is the one the webhook carries and the one the insights endpoint is keyed by. No stitching a separate analytics vendor onto a separate voice vendor and reconciling IDs by timestamp.

## Telnyx API Endpoints Used

- `POST /ai/conversations/insights` — create an insight template (`name`, `instructions`, `json_schema`, optional `webhook`)
- `POST /ai/conversations/insight-groups` — create a group (`name`, `description`, `webhook`)
- `POST /ai/conversations/insight-groups/{group_id}/insights/{insight_id}/assign` — assign a template to the group
- `POST /v2/ai/assistants` / `POST /v2/ai/assistants/{assistant_id}` — assistant create/update with `insight_settings`
- `POST /ai/assistants/{assistant_id}/scheduled-events` — place the demo call (channel `phone_call`)
- `GET /ai/conversations/{conversation_id}/conversations-insights` — per-conversation insight records
- Webhook `call.conversation.insights_generated` — fires when the conversation's insight set completes

## Architecture

Four layers, each one only talks to its neighbor.

```text
┌──────────────────────────┐
│  create_templates.py     │  POST /ai/conversations/insights  ×3
│  sentiment-v1            │  each with a strict json_schema
│  compliance-v1           │
│  escalation-v1           │
└────────────┬─────────────┘
             │ INSIGHT_TEMPLATE_IDS
             ▼
┌──────────────────────────┐
│  create_group.py         │  POST /ai/conversations/insight-groups
│  qa-scorecard-v1         │  POST .../insights/{id}/assign  ×3
│                          │  re-reads group to verify membership
└────────────┬─────────────┘
             │ INSIGHT_GROUP_ID
             ▼
┌──────────────────────────┐
│  wire_assistant.py       │  assistant.insight_settings = {group, enabled}
│  (create or update)      │  verified via GET /v2/ai/assistants/{id}
└────────────┬─────────────┘
             │ ASSISTANT_ID
             ▼
┌──────────────────────────┐        ┌──────────────────────────────┐
│  place_call.py           │        │  webhook_receiver.py         │
│  scheduled-events        │───────▶│  call.conversation.          │
│  channel=phone_call      │        │  insights_generated          │
│  → conversation_id       │        │  Ed25519 verified            │
└────────────┬─────────────┘        └──────────────┬───────────────┘
             │                                     │
             │        conversations.json           │
             │        (JSON-lines store)           │
             └────────────────┬────────────────────┘
                              ▼
                 ┌──────────────────────────┐
                 │  scorecard.py            │
                 │  GET .../conversations-  │
                 │  insights per id         │
                 │  schema-validate         │
                 │  aggregate valid only    │
                 │  --strict flags invalid  │
                 └──────────────────────────┘
```

Insight statuses drive the readiness gate: records still `pending` or `in_progress` are counted as pending rows, not failures. The sample distinguishes "not ready yet" from "schema-invalid".

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `ASSISTANT_ID` | `string` | `your_assistant_id_here` | **yes** | Assistant to wire `insight_settings` onto and place the demo call through. If unset, `wire_assistant.py` creates one. | Output of `wire_assistant.py`, or the
