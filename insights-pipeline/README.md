---
name: insights-pipeline
title: "Structured-Insights Pipeline Desk — Schema-First Conversation Mining"
description: "Build a schema-first structured-insights pipeline over AI conversations: typed insight templates, insight groups, assistant wiring, webhook + poll, and a QA scorecard."
language: python
framework: flask
telnyx_products: [AI, AI Insights, Assistants, Voice]
---

# Structured-Insights Pipeline Desk — Schema-First Conversation Mining

Turn AI conversation analysis into typed records — sentiment, compliance flags, escalation reasons — that land in dashboards without anyone writing a regex.

## The Story

A mid-sized outpatient clinic runs a patient-services phone line. Every call is a liability surface: a missed identity check, a skipped recording disclosure, or an ignored escalation request can mean a compliance finding, a refunded visit, or a patient who never comes back. The clinic's QA lead currently reads free-text call summaries and hand-tags them in a spreadsheet — slow, inconsistent, and impossible to audit when a regulator asks "show me every call where the disclosure line was missed."

The actor IS the QA scorecard. It is born the moment an insight template declares its `json_schema` — the shape of a record the model is contractually obligated to produce. It evolves as templates are bundled into a group and attached to the assistant, so every call conversation is analyzed once with all three concerns applied. It completes when a conversation's insight set finishes and the scorecard renders typed values — sentiment distribution, compliance-flag rates, escalation breakdown — with zero prose parsing. It survives the ordinary chaos of a live phone line: the webhook receiver is a separate process that may not be running, so the scorecard falls back to polling the same endpoint and produces the identical report; a record still `in_progress` is a pending row, not a failure; a record missing a required field is flagged by conversation ID and excluded from aggregates rather than silently poisoning the numbers. The rest of this README is the API surface of that story.

## Why Telnyx

Structured insights are the analytics-grade half of AI Insights — the half that feeds dashboards — and Telnyx exposes them as first-class, composable primitives rather than a black-box summary string. You declare a `json_schema`, bundle templates into a group, attach the group to an assistant once, and every call conversation is mined into typed records. The `call.conversation.insights_generated` webhook closes the loop for real-time QA consoles, and the polling endpoint is the source of truth when the receiver isn't up. This is **AI Communications Infrastructure**: the model's output is a typed record on day one, not prose you regex later.

## Telnyx API Endpoints Used

All paths are relative to `TELNYX_API_BASE` (default `https://api.telnyx.com/v2`).

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/ai/conversations/insights` | Create an insight template (`name`, `instructions`, `json_schema`, optional `webhook`). |
| `GET` | `/ai/conversations/insights` | List insight templates (used for idempotency + drift check). |
| `POST` | `/ai/conversations/insight-groups` | Create an insight group (`name`, `description`, `webhook`). |
| `GET` | `/ai/conversations/insight-groups` | List groups (find-or-create by name). |
| `GET` | `/ai/conversations/insight-groups/{group_id}` | Re-read group membership for assignment verification. |
| `POST` | `/ai/conversations/insight-groups/{group_id}/insights/{insight_id}/assign` | Assign a template to the group. |
| `POST` | `/ai/assistants` | Create the assistant (when `ASSISTANT_ID` is unset). |
| `POST` | `/ai/assistants/{assistant_id}` | Attach `insight_settings` (the group) to the assistant. |
| `GET` | `/ai/assistants/{assistant_id}` | Verify `insight_settings.insight_group_id` is attached. |
| `POST` | `/ai/assistants/{assistant_id}/scheduled_events` | Place the demo call (channel `phone_call`); response carries `conversation_id`. |
| `GET` | `/ai/conversations/{conversation_id}/conversations-insights` | Per-conversation insight records; statuses `pending` / `in_progress` / `completed` / `failed`. |
| Webhook | `call.conversation.insights_generated` | Fires when a conversation's insight set completes. |

## Architecture

The pipeline has four layers, and each one only talks to its neighbor.

```text
┌──────────────────────────────────────────────────────────────────────┐
│  LAYER 1 — INSIGHT TEMPLATES  (create_templates.py)                  │
│                                                                      │
│   sentiment-v1        compliance-v1        escalation-v1             │
│   ┌────────────┐      ┌────────────┐       ┌────────────┐            │
│   │ json_schema│      │ json_schema│       │ json_schema│            │
│   │ positivity │      │ verified_  │       │ escalation │            │
│   │ frustration│      │  identity  │       │  _reason   │            │
│   │ sentiment  │      │ compliance │       │ agent_     │            │
│   │ emotions   │      │  _flags[]  │       │ performed  │            │
│   └────────────┘      └────────────┘       └────────────┘            │
│        POST /ai/conversations/insights                               │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│  LAYER 2 — INSIGHT GROUP  (create_group.py)                          │
│                                                                      │
│   qa-scorecard-v1  ── assign ──▶  sentiment-v1                       │
│                    ── assign ──▶  compliance-v1                      │
│                    ── assign ──▶  escalation-v1                      │
│                                                                      │
│   POST /ai/conversations/insight-groups                              │
│   POST .../insight-groups/{group_id}/insights/{insight_id}/assign    │
│   GET  .../insight-groups/{group_id}   ← membership verification     │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│  LAYER 3 — ASSISTANT WIRING  (wire_assistant.py)                     │
│                                                                      │
│   assistant.insight_settings = { insight_group_id: <group_id> }      │
│   → every call conversation analyzed once, all templates applied     │
│                                                                      │
│   POST /ai/assistants/{assistant_id}   (attach)                      │
│   GET  /ai/assistants/{assistant_id}   (verify)                      │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│  LAYER 4 — DELIVERY + RENDER                                         │
│                                                                      │
│   place_call.py ──▶ POST .../scheduled_events ──▶ conversation_id    │
│                     writes conversations.json                        │
│                     polls GET .../conversations-insights until done  │
│                                                                      │
│   webhook_receiver.py (Flask)                                        │
│     ◀── call.conversation.insights_generated                         │
│     prints payload keys, appends conversation_id to store            │
│     (enhancement — poll fallback produces identical scorecard)       │
│                                                                      │
│   scorecard.py                                                       │
│     reads conversations.json (--date / --conversation-id)            │
│     schema-validates each record                                     │
│     aggregates → sentiment / compliance / escalation                 │
│     --strict injects a synthetic invalid record and flags it         │
└──────────────────────────────────────────────────────────────────────┘
```

Insight statuses drive the readiness gate: records still `pending` or `in_progress` are pending rows, not failures — the sample distinguishes "not ready yet" from "schema-invalid".

## Environment Variables

The sample reads exactly five variables:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | Telnyx API key used for all REST calls. | Telnyx Portal → API Keys. |
| `ASSISTANT_PHONE_NUMBER` | `string` | `+1555YYYYYYY` | **yes** | The number already associated with the assistant in the portal. `place_call.py` errors with an actionable message if unset. | Telnyx Portal → AI → Assistants. |
| `DESTINATION_NUMBER` | `string` | `+1555XXXXXXX` | **yes** | The number the demo call dials. | Any number you can call. |
| `ASSISTANT_ID` | `string` | `your_assistant_id_here` | no | Assistant to wire `insight_settings` onto and place the demo call through. If unset, `wire_assistant.py` creates one with platform-default model/voice and the demo-scenario system prompt. | Telnyx Portal → AI → Assistants, or the `id` printed by `wire_assistant.py`. |
| `PUBLIC_WEBHOOK_BASE_URL` | `string` | `https://your-subdomain.ngrok.app` | no | Public base URL registered into template/group `webhook` fields. When absent the demo runs end-to-end via the poll fallback. | `ngrok http 8000` prints it. |

Two more variables are read but have safe defaults: `TELNYX_API_BASE` (defaults to `https://api.telnyx.com/v2`) and `TELNYX_PUBLIC_KEY` (required by `webhook_receiver.py` for Ed25519 signature verification — the receiver refuses to start without it). `DEMO_MODE` (default `true`) gates real call placement. `scheduled_at_fixed_datetime` is computed at runtime, not an env var.

> **Agent / CLI access:** provision the pieces this example needs from the CLI:
>
> ```bash
> # Confirm or pick the assistant id for ASSISTANT_ID
> telnyx assistant list
>
> # Create the assistant when ASSISTANT_ID is unset (prints the id)
> telnyx assistant create
>
> # Provision the demo numbers (Telnyx CLI — human or agent)
> telnyx available-phone-numbers list --country US --features voice
> telnyx number-orders create --phone-numbers "+1555XXXXXXX"
> ```

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/insights-pipeline

python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# edit .env — set TELNYX_API_KEY, ASSISTANT_PHONE_NUMBER, DESTINATION_NUMBER,
# and (optionally) ASSISTANT_ID and PUBLIC_WEBHOOK_BASE_URL
```

<details><summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login

# List assistants (confirm or pick the id for ASSISTANT_ID)
telnyx assistant list

# Create the assistant when ASSISTANT_ID is unset (prints the id)
telnyx assistant create

# Provision the two numbers the demo dials from / to
telnyx available-phone-numbers list --country US --features voice
telnyx number-orders create --phone-numbers "+1555XXXXXXX"
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>

### Run the workflow, in order

Each step is a standalone CLI script. Run them in this order:

```bash
# 1. Create the three json_schema insight templates (idempotent names).
python create_templates.py

# 2. Create the insight group and assign the three templates.
#    Re-reads the group and prints its membership to verify.
python create_group.py

# 3. Attach insight_settings (the group) to the assistant.
#    Creates the assistant if ASSISTANT_ID is unset; prints the id to set in .env.
python wire_assistant.py

# 4. Place the demo call and poll insights until all records are completed.
#    DEMO_MODE=true (default) logs the scheduled-event payload instead of dialing.
python place_call.py

# 5. (optional) Run the Flask receiver for call.conversation.insights_generated.
#    Requires TELNYX_PUBLIC_KEY. Expose port 8000 with `ngrok http 8000` and set
#    PUBLIC_WEBHOOK_BASE_URL. The demo works end-to-end without this step.
python webhook_receiver.py

# 6. Render the QA scorecard from typed records.
python scorecard.py --date 2026-10-20

# 6b. Demonstrate the failure mode: inject a synthetic schema-invalid record.
python scorecard.py --strict
```

### `json_schema`: string vs object

The `json_schema` field on `POST /ai/conversations/insights` accepts **either a
string or an object**. This sample sends the **string form**
(`json.dumps(tpl["json_schema"])` in `create_templates.py`), which is the
canonical wire format. If your tooling prefers the object form, pass the dict
directly — the API accepts both.

### The four insight statuses

Every insight record carries a `status`:

| Status | Meaning | Scorecard treatment |
| --- | --- | --- |
| `pending` | Queued, not started. | Counted as a pending row. |
| `in_progress` | Analysis running. | Counted as a pending row. |
| `completed` | Analysis finished. | Validated and aggregated. |
| `failed` | Analysis errored. | `place_call.py` exits non-zero; scorecard skips. |

The distinction between "not ready yet" (`pending` / `in_progress`) and
"schema-invalid" (`completed` but missing a field) matters: the first is a
timing issue, the second is a contract violation. The sample treats them
differently.

## API Reference

The typed endpoint reference lives in [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/insights-pipeline/API.md); the step-by-step walkthrough in [GUIDE.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/insights-pipeline/GUIDE.md). Summary of the request surface:

- `POST /ai/conversations/insights` — `InsightTemplateCreateReq` (`name`, `instructions`, `json_schema` as string or object, optional `webhook`)
- `POST /ai/conversations/insight-groups` — `InsightTemplateGroupCreateReq` (`name`, `description`, `webhook`)
- `POST /ai/conversations/insight-groups/{group_id}/insights/{insight_id}/assign` — group membership
- `POST /ai/assistants` / `POST /ai/assistants/{assistant_id}` — create the assistant; attach `insight_settings` (the group)
- `GET /ai/assistants/{assistant_id}` — verify `insight_settings.insight_group_id` is attached
- `POST /ai/assistants/{assistant_id}/scheduled_events` — place the demo call (channel `phone_call`); the response carries `conversation_id`
- `GET /ai/conversations/{conversation_id}/conversations-insights` — per-conversation insight records; statuses `pending` / `in_progress` / `completed` / `failed`
- Webhook `call.conversation.insights_generated` — fires when the conversation's insight set completes

## Troubleshooting

**`TELNYX_API_KEY is required`** — you did not create `.env` or the key is
blank. Copy `.env.example` and fill it in.

**`ASSISTANT_PHONE_NUMBER is required`** — the number must already be
associated with the assistant in the Telnyx portal. Set it in `.env`.

**`Missing templates [...] — run create_templates.py first`** — `create_group.py`
could not find the three templates by name. Run step 1 first.

**`Group qa-scorecard-v1 not found — run create_group.py first`** —
`wire_assistant.py` could not find the group. Run step 2 first.

**`ASSISTANT_ID is required — run wire_assistant.py first`** — `place_call.py`
needs the assistant id. Run step 3, then set `ASSISTANT_ID` in `.env`.

**Polling times out** — the conversation may still be analyzing. The bounded
timeout is ~3 minutes; if your conversations are longer, increase
`POLL_TIMEOUT` in `place_call.py`.

**Webhook signature verification fails** — check that `TELNYX_PUBLIC_KEY` is
set and matches the key Telnyx uses for your account. The receiver has no
unverified fallback: a missing key exits at startup, and a bad signature
returns `400`.

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Related Examples

- [create-ai-assistant-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/create-ai-assistant-python/README.md) — provision the assistant this sample wires `insight_settings` onto
- [update-ai-assistant-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/update-ai-assistant-python/README.md) — update assistant configuration programmatically
- [chat-with-ai-assistant-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/chat-with-ai-assistant-python/README.md) — text chat with a Telnyx AI Assistant (no telephony)
- [post-call-qa-scoring](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/post-call-qa-scoring/README.md) — the QA scorecard pattern for post-call review

## Resources

- [Structured data insights](https://developers.telnyx.com/docs/inference/ai-insights/structured-insights) — the concept behind the `json_schema` templates.
- [Insight groups](https://developers.telnyx.com/docs/inference/ai-insights/insight-groups) — how to bundle templates and attach them to assistants.
- [Create insight template](https://developers.telnyx.com/api-reference/conversations/create-insight-template) — the `InsightTemplateCreateReq` shape.
- [Create insight template group](https://developers.telnyx.com/api-reference/conversations/create-insight-template-group) — the group create endpoint.
- [Assign insight template to group](https://developers.telnyx.com/api-reference/conversations/assign-insight-template-to-group) — group membership.
- [Get insights for a conversation](https://developers.telnyx.com/api-reference/conversations/get-insights-for-a-conversation) — the polling source of truth.
- [call.conversation.insights_generated webhook](https://developers.telnyx.com/api-reference/callbacks/call-conversation-insights-generated) — the completion signal.
- [Update an assistant](https://developers.telnyx.com/api-reference/assistants/update-an-assistant) — where `insight_settings` lives.

From here, the natural extensions are: adding a fourth template for a new
concern (the group pattern scales), wiring the scorecard into a real dashboard
(the records are already typed), and replacing the local `conversations.json`
store with your own persistence layer (the schema is the contract, not the
store).
