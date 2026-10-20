# Structured-Insights Pipeline Desk — A Schema-First Conversation Mining Tutorial

This guide walks you through the `insights-pipeline` sample end to end. By the
time you finish, you will have built a complete structured-insights pipeline
over AI conversations: three `json_schema`-typed insight templates, an insight
group that bundles them, an assistant wired to analyze every call, a demo call
that produces a real conversation, a webhook receiver that consumes
`call.conversation.insights_generated`, and a QA scorecard that renders typed
records — sentiment, compliance flags, escalation reasons — with zero regex
parsing.

The point of the sample is the **schema-first pattern**. Instead of asking a
model for a free-text summary and then regex-parsing it into your dashboard,
you declare a strict `json_schema` up front. The model's output is a typed
record on day one. It lands in dashboards without anyone writing a parser.

---

## 1. What you are building

The pipeline has four layers, and each one only talks to its neighbor:

```
┌──────────────────────┐
│  Insight templates   │  one per concern, each with its own json_schema
│  (sentiment-v1,      │  → POST /ai/conversations/insights
│   compliance-v1,     │
│   escalation-v1)     │
└──────────┬───────────┘
           │ assign
           ▼
┌──────────────────────┐
│  Insight group       │  bundles the templates
│  (qa-scorecard-v1)   │  → POST /ai/conversations/insight-groups
└──────────┬───────────┘  → POST .../insights/{id}/assign
           │ referenced by
           ▼
┌──────────────────────┐
│  Assistant           │  insight_settings.insight_group_id
│  insight_settings    │  → every call conversation is analyzed once
└──────────┬───────────┘
           │ produces
           ▼
┌──────────────────────┐
│  Conversation        │  → GET /ai/conversations/{id}/conversations-insights
│  insight records     │  → webhook call.conversation.insights_generated
└──────────┬───────────┘
           │ validated + aggregated
           ▼
┌──────────────────────┐
│  QA scorecard        │  sentiment distribution, compliance-flag rates,
│                      │  escalation breakdown
└──────────────────────┘
```

**Insight templates** are the extraction definitions — one per concern — each
declaring its own `json_schema` (accepted as a string or an object).

The **insight group** bundles the templates. The assistant's
`insight_settings` references the group, so every call conversation is
analyzed once with all templates applied — no per-call wiring.

The **webhook receiver** (Flask) consumes
`call.conversation.insights_generated` for push delivery. Polling
`GET .../conversations-insights` is the fallback, and it is also the source of
truth for the scorecard: the receiver prints the full payload keys on first
receipt, then diffs subsequent events against the polling path so reviewers
can see that both routes agree.

The **scorecard renderer** schema-validates each record and aggregates into
the report.

Insight statuses drive the readiness gate: records still `in_progress` are
pending rows, not failures — the sample distinguishes "not ready yet" from
"schema-invalid".

---

## 2. Prerequisites

- Python 3.10 or newer.
- A Telnyx account with an API key that can create AI insights and assistants.
- An assistant phone number already associated with your assistant in the
  Telnyx portal (this becomes `ASSISTANT_PHONE_NUMBER`).
- A destination number you can call (this becomes `DESTINATION_NUMBER`).
- Optional: `ngrok` if you want to receive the webhook locally. The demo runs
  end to end without it via the polling fallback.

Install dependencies:

```bash
pip install -r requirements.txt
```

---

## 3. Environment setup

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

The sample reads exactly five environment variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `TELNYX_API_KEY` | yes | Bearer token for every API call. |
| `ASSISTANT_PHONE_NUMBER` | yes | The number already associated with the assistant. `place_call.py` errors with an actionable message if unset. |
| `DESTINATION_NUMBER` | yes | The number the demo call dials. |
| `ASSISTANT_ID` | no | If unset, `wire_assistant.py` creates an assistant with platform-default model/voice and the demo-scenario system prompt. |
| `PUBLIC_WEBHOOK_BASE_URL` | no | Registered into template and group `webhook` fields. When absent, the demo runs end to end via the poll fallback. |

Two more variables are read but have safe defaults:
`TELNYX_API_BASE` (defaults to `https://api.telnyx.com/v2`) and
`TELNYX_PUBLIC_KEY` (used by the receiver for Ed25519 signature verification).

`scheduled_at_fixed_datetime` is computed at runtime (now + ~60 seconds), not
an env var.

---

## 4. Demo mode vs live mode

The sample ships in **safe demo mode** by default. `DEMO_MODE=true` (the
default) means `place_call.py` prints the exact scheduled-event payload it
*would* send and returns a fake conversation id — no real call is placed, no
charges accrue.

To place a real call, set `DEMO_MODE=false` in `.env` or pass `--demo` off:

```bash
DEMO_MODE=false python place_call.py
```

Everything else — template creation, group creation, assistant wiring, the
scorecard — runs against the real API in both modes. Only the call placement
is gated.

---

## 5. The workflow, step by step

Run the scripts in order. Each is a standalone CLI with its own `--help`.

### Step 1 — `create_templates.py`: declare the schemas

This script creates three insight templates via
`POST /ai/conversations/insights`. Each template carries a `name`, an
`instructions` string, and a `json_schema` in **object form** with explicit
`required` fields and enums.

The three schemas are the heart of the sample:

**Sentiment** (`sentiment-v1`) — `positivity_score` (number 1–5),
`frustration_level` (number 0–5), `overall_sentiment` (enum: `positive` |
`negative` | `mixed` | `neutral`), `key_emotions` (array of free strings).

**Compliance** (`compliance-v1`) — `verified_identity` (boolean),
`compliance_flags` (array of enum: `identity_verification_passed` |
`disclosure_missing` | `profanity_detected` | `sensitive_data_mentioned` |
`escalation_requested`).

**Escalation** (`escalation-v1`) — `escalation_reason` (enum:
`caller_request` | `compliance_violation` | `poor_call_quality` |
`system_error` | `other`), `agent_performed_well` (boolean).

Every schema sets `additionalProperties: false`, so the model cannot smuggle
in fields your dashboard does not expect.

The script is **idempotently named**: templates are called `sentiment-v1`,
`compliance-v1`, `escalation-v1`, so re-runs update instead of duplicating.
It diffs the template count before and after and prints any drift:

```
Templates before: 0
  ✓ sentiment-v1     id=...
  ✓ compliance-v1    id=...
  ✓ escalation-v1    id=...
Templates after:  3
  ✓ no unexpected drift (delta=3)
```

Each creation response is validated — the script exits if the response is
missing an `id` or the `name` does not match.

Run it:

```bash
python create_templates.py
```

### Step 2 — `create_group.py`: bundle and assign

This script creates the insight group via
`POST /ai/conversations/insight-groups` (name `qa-scorecard-v1`, a
description, and the optional webhook URL), then assigns each of the three
templates via
`POST /ai/conversations/insight-groups/{group_id}/insights/{insight_id}/assign`.

Assignment is **verified by re-reading the group** and printing its
membership:

```
Group <group_id> membership (3):
  - sentiment-v1 id=...
  - compliance-v1 id=...
  - escalation-v1 id=...
✓ all three templates verified in group membership
```

If any template is missing from the membership list, the script exits
non-zero. This is the acceptance criterion that group assignment is verified,
not assumed.

Run it:

```bash
python create_group.py
```

### Step 3 — `wire_assistant.py`: attach `insight_settings`

This script finds the group by name, then sets
`insight_settings.insight_group_id` on the assistant via
`POST /v2/ai/assistants/{assistant_id}`. If `ASSISTANT_ID` is unset, it first
creates an assistant via `POST /v2/ai/assistants` with platform-default model
and voice and the demo-scenario system prompt.

The demo scenario is embedded in the system prompt: the caller is a
frustrated patient demanding to speak to a human (which triggers
`frustration_level` > 1 and `escalation_reason: caller_request`); the
assistant must verify the caller's date of birth before discussing anything
(which produces `identity_verification_passed`); and the assistant must state
a mandatory callback-disclosure line exactly once (one scripted miss makes
`disclosure_missing` appear). This guarantees a non-trivial scorecard:
sentiment, at least one compliance flag, and an escalation reason beyond
`other`.

The script then **verifies** via `GET /v2/ai/assistants/{id}` that the group
is attached, and prints the assistant id so you can set `ASSISTANT_ID` in
`.env` for the next step.

Run it:

```bash
python wire_assistant.py
```

### Step 4 — `place_call.py`: place the call and poll

This script places the demo call through the assistant scheduled-event
surface:

```
POST /v2/ai/assistants/{assistant_id}/scheduled_events
```

with body:

```json
{
  "telnyx_conversation_channel": "phone_call",
  "telnyx_end_user_target": "$DESTINATION_NUMBER",
  "telnyx_agent_target": "$ASSISTANT_PHONE_NUMBER",
  "scheduled_at_fixed_datetime": "<ISO-8601, now + ~60s>"
}
```

The response carries `scheduled_event_id` and `conversation_id`. The script
writes `{"conversation_id", "received_at"}` to `conversations.json` — the
local JSON-lines store that `scorecard.py` reads.

Then it **polls** `GET /ai/conversations/{conversation_id}/conversations-insights`
every ~10 seconds with a bounded ~3-minute timeout until all insight records
for that conversation are `completed`:

- `pending` / `in_progress` → keep waiting.
- `completed` → done.
- `failed` → print the record's id and exit non-zero.

Polling is the fallback **and** the source of truth. The script does not wait
on the webhook — the receiver is a separate process that may not be running,
and watching `conversations.json` does not work because `place_call.py`
appends its own row immediately from the create response. If
`PUBLIC_WEBHOOK_BASE_URL` is set, the receiver's appended row can be surfaced
as an optional secondary "webhook received" signal — never as the wait
condition.

Run it:

```bash
python place_call.py
```

### Step 5 — `webhook_receiver.py`: consume the completion signal

This is the Flask receiver for `call.conversation.insights_generated`. It
verifies the Telnyx Ed25519 signature via `telnyx.Webhook.construct_event`
(using `TELNYX_PUBLIC_KEY`), prints the payload keys on first receipt, appends
the `conversation_id` to `conversations.json`, and diffs subsequent events
against the polling path so reviewers can see both routes agree.

The receiver has a `--print-url` mode that prints the exact registration
payload for `PUBLIC_WEBHOOK_BASE_URL`:

```bash
python webhook_receiver.py --print-url
```

To receive webhooks locally, expose port 8000 with ngrok:

```bash
ngrok http 8000
```

then set `PUBLIC_WEBHOOK_BASE_URL` in `.env` to the ngrok URL. The receiver
registers at `/webhooks/telnyx`.

Run the receiver:

```bash
python webhook_receiver.py
```

Remember: the webhook is an enhancement, not a requirement. With no public URL
configured, the demo still works end to end via the scorecard's polling path.

### Step 6 — `scorecard.py`: render the QA scorecard

This script reads conversation ids from `conversations.json` (filtered by
`--date` or overridden by `--conversation-id`), fetches
`GET /ai/conversations/{conversation_id}/conversations-insights` per
conversation, validates every record against the declared schemas, and
aggregates into the report:

```
=== QA SCORECARD ===
valid records:   3
invalid records: 0
pending records: 0

Sentiment distribution:
  negative   1

Compliance-flag rates:
  identity_verification_passed   1
  disclosure_missing             1

Escalation breakdown:
  caller_request   1
```

Records still `pending` or `in_progress` are counted as pending rows, not
failures. Records that fail schema validation are excluded from the
aggregates and printed with their conversation id.

Run it:

```bash
python scorecard.py --date 2026-10-20
```

### Step 7 — `scorecard.py --strict`: demonstrate the failure mode

The `--strict` flag injects a **synthetic invalid record** locally — a record
missing the required `positivity_score` field, appended under a clearly-fake
conversation id (`demo-synthetic-invalid`). The scorecard's schema validator
flags it, excludes it from the aggregates, and prints its conversation id:

```
[--strict] injected synthetic invalid record under demo-synthetic-invalid
...
Schema-invalid records (excluded from aggregates):
  demo-synthetic-invalid: missing required field 'positivity_score'
```

This is deterministic — it does not depend on the model misbehaving. It is
how you prove the validator works.

Run it:

```bash
python scorecard.py --strict
```

---

## 6. The dispatcher: `app.py`

`app.py` is a thin help-dispatcher. It does not contain workflow logic — it
prints the six workflow steps in order and exits. Run it when you forget the
order:

```bash
python app.py
```

The workflow lives entirely in the six named scripts. This is deliberate: the
acceptance criteria mandate standalone CLI scripts, one workflow step each.

---

## 7. How the schema-first pattern works

The key idea is that the `json_schema` you declare at template-creation time
becomes the contract for the model's output. Three things follow from that:

1. **The model cannot return prose.** The schema's `required` fields and
   `additionalProperties: false` mean the output is a typed record with
   exactly the fields you declared.

2. **Your dashboard code has no parser.** The scorecard reads
   `result["overall_sentiment"]` directly. There is no regex, no string
   splitting, no "if the summary contains the word 'frustrated'".

3. **Invalid records are detectable.** When a record is missing a required
   field or carries an out-of-enum value, the validator catches it and
   excludes it from aggregates. You see the failure by conversation id
   instead of silently polluting your metrics.

The `json_schema` field accepts **either a string or an object**. This sample
sends the object form (`json.dumps(tpl["json_schema"])` in
`create_templates.py`), which is the more readable option. If your tooling
prefers a string, pass the serialized JSON directly.

---

## 8. The four insight statuses

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

---

## 9. Troubleshooting

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
set and matches the key Telnyx uses for your account. If you are testing
locally without a public URL, the receiver falls back to parsing the payload
as JSON.

---

## 10. Next steps

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
