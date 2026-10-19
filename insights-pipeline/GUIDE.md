# Structured-Insights Pipeline Desk — A Guided Tour

This guide walks you through `insights-pipeline`, a Flask + CLI sample that builds a
**schema-first structured-insights pipeline** over Telnyx AI conversations. By the end
you will have created three insight templates with strict `json_schema` definitions,
bundled them into an insight group, wired that group to an assistant, placed a demo
call, consumed the `call.conversation.insights_generated` webhook, and rendered a QA
scorecard from **typed records** — no regex, no prose parsing.

The whole point of the sample is the schema-first pattern: the model's output is a
typed record that lands directly in a dashboard, not a free-text summary that someone
has to scrape.

---

## 1. What you are building

The pipeline has four layers, and each layer only talks to its neighbor:

```
┌────────────────────┐   ┌────────────────────┐   ┌────────────────────┐
│ Insight templates  │──▶│ Insight group      │──▶│ Assistant          │
│ (json_schema)      │   │ (assign endpoint)  │   │ (insight_settings) │
└────────────────────┘   └────────────────────┘   └────────────────────┘
                                                          │
                                                          ▼
┌────────────────────┐   ┌────────────────────┐   ┌────────────────────┐
│ QA scorecard       │◀──│ Polling path       │◀──│ Demo call          │
│ (schema-validated) │   │ GET .../insights   │   │ (scheduled event)  │
└────────────────────┘   └────────────────────┘   └────────────────────┘
          ▲
          │
┌────────────────────┐
│ Webhook receiver   │  call.conversation.insights_generated
│ (Flask, push)      │
└────────────────────┘
```

- **Insight templates** are the extraction definitions — one per concern — each
  declaring its own `json_schema`.
- The **insight group** bundles the templates. The assistant's `insight_settings`
  references the group, so every call conversation is analyzed once with all templates
  applied — no per-call wiring.
- The **webhook receiver** consumes `call.conversation.insights_generated` for push
  delivery. Polling `GET .../conversations-insights` is the fallback and the source of
  truth for the scorecard.
- The **scorecard renderer** schema-validates each record and aggregates into the
  report.

---

## 2. Prerequisites

- Python 3.10 or newer
- A Telnyx account with an API key ([get one here](https://portal.telnyx.com/#/app/api-keys))
- An AI assistant with a phone number associated with it (created in the Telnyx portal)
- A destination phone number you control for the demo call
- Optional: [`ngrok`](https://ngrok.com/) if you want the webhook push path to reach
  your local machine

---

## 3. Environment setup

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `TELNYX_API_KEY` | yes | Your Telnyx API key. |
| `TELNYX_PUBLIC_KEY` | for webhooks | Ed25519 public key used to verify webhook signatures. |
| `ASSISTANT_ID` | no | If set, `wire-assistant` updates this assistant instead of creating one. |
| `ASSISTANT_PHONE_NUMBER` | for live calls | A number already associated with the assistant in the portal. |
| `DESTINATION_NUMBER` | for live calls | The number the demo call dials. |
| `PUBLIC_WEBHOOK_BASE_URL` | no | Public base URL registered into template/group `webhook` fields. |
| `CONVERSATIONS_STORE` | no | Path to the JSON-lines store (default `conversations.json`). |
| `DEMO_MODE` | no | `true` (default) logs the call payload instead of placing it. |
| `PORT` | no | Flask port (default `8000`). |

Install dependencies:

```bash
pip install -r requirements.txt
```

---

## 4. Demo mode vs live mode

The sample ships in **safe demo mode** by default. `DEMO_MODE=true` means
`place-call` prints the exact scheduled-event payload it *would* send and returns a
synthetic conversation ID — no real call is placed and no charges are incurred.

To run against the live Telnyx API, set:

```bash
DEMO_MODE=false
```

in your `.env`. In live mode `place-call` sends the scheduled event to
`POST /ai/assistants/{assistant_id}/scheduled_events` and appends the returned
`conversation_id` to the local store.

Everything else in the pipeline (template creation, group creation, assistant wiring,
scorecard rendering) talks to the real API in both modes — only the call placement is
gated.

---

## 5. The insight templates (`create-templates`)

Open `app.py` and find the **"Insight template schemas"** section. This is where the
three schemas live, and they are the heart of the sample.

### 5.1 The sentiment schema

The `SENTIMENT_SCHEMA` constant declares a JSON Schema object with four required
fields:

- `positivity_score` — a number between 1 and 5
- `frustration_level` — a number between 0 and 5
- `overall_sentiment` — a string enum: `positive`, `negative`, `mixed`, `neutral`
- `key_emotions` — an array of free-form strings

### 5.2 The compliance schema

`COMPLIANCE_SCHEMA` declares:

- `verified_identity` — a boolean
- `compliance_flags` — an array whose items are constrained to the enum
  `identity_verification_passed`, `disclosure_missing`, `profanity_detected`,
  `sensitive_data_mentioned`, `escalation_requested`

### 5.3 The escalation schema

`ESCALATION_SCHEMA` declares:

- `escalation_reason` — an enum: `caller_request`, `compliance_violation`,
  `poor_call_quality`, `system_error`, `other`
- `agent_performed_well` — a boolean

### 5.4 The `TEMPLATES` list

The `TEMPLATES` list binds each schema to a name (`sentiment-v1`, `compliance-v1`,
`escalation-v1`) and an `instructions` string that tells the model how to fill the
record. The instructions are where you nudge the model toward the right enum values —
for example, "key_emotions are free-form labels such as frustrated, confused,
satisfied."

### 5.5 Creating the templates

The `create_templates()` function (in the **"Telnyx API helpers"** section) does the
following:

1. Reads the current template count via `GET /ai/conversations/insights`.
2. For each entry in `TEMPLATES`, POSTs to `/ai/conversations/insights` with
   `name`, `instructions`, and `json_schema` (serialized with `json.dumps` — the
   endpoint accepts the schema as a string or an object).
3. If `PUBLIC_WEBHOOK_BASE_URL` is set, attaches a `webhook` field pointing at
   `/webhooks/telnyx`.
4. Validates that the response contains an `id` and prints it.
5. Re-reads the template count and prints the drift (expected `0` on re-runs).

Templates are idempotently named, so re-running the command updates rather than
duplicates.

Run it:

```bash
python app.py create-templates
```

---

## 6. The insight group (`create-group`)

The `create_group()` function creates a group via
`POST /ai/conversations/insight-groups` with a `name`, `description`, and (if
configured) a `webhook`. It then assigns each template to the group via
`POST /ai/conversations/insight-groups/{group_id}/insights/{insight_id}/assign`.

After assignment, the function **re-reads the group** with
`GET /ai/conversations/insight-groups/{group_id}` and prints the membership list —
this is the verification step required by the acceptance criteria.

Run it:

```bash
python app.py create-group
```

Note that `create-group` also calls `create_templates()` first, so the group always
reflects the current template set.

---

## 7. Wiring the assistant (`wire-assistant`)

The `wire_assistant()` function attaches the group to an assistant through the
`insight_settings` field:

- If `ASSISTANT_ID` is set in the environment, it POSTs to
  `/ai/assistants/{assistant_id}` with `{"insight_settings": {"insight_group_id":
  group_id}}`.
- Otherwise it creates a new assistant with a demo `system_prompt` (see
  `DEMO_SYSTEM_PROMPT`) and the same `insight_settings`.

The demo system prompt is deliberately scripted to produce a non-trivial scorecard:
the caller is a frustrated patient demanding a human, the agent must verify the
caller's date of birth, and the agent must state a mandatory callback-disclosure line
exactly once. That guarantees sentiment, at least one compliance flag, and an
escalation reason beyond `other`.

After wiring, the function re-reads the assistant with `GET /ai/assistants/{id}` and
prints the `insight_settings` block so you can confirm the group is attached.

Run it:

```bash
python app.py wire-assistant
```

---

## 8. Placing the demo call (`place-call`)

The `place_call()` function uses the assistant scheduled-event surface with channel
`phone_call`:

```json
{
  "telnyx_conversation_channel": "phone_call",
  "telnyx_end_user_target": "$DESTINATION_NUMBER",
  "telnyx_agent_target": "$ASSISTANT_PHONE_NUMBER",
  "scheduled_at_fixed_datetime": "<now + 60s>"
}
```

It errors with an actionable message if `ASSISTANT_PHONE_NUMBER` is not set — that
number must already be associated with the assistant in the portal.

In demo mode the payload is printed and a synthetic conversation ID is returned. In
live mode the scheduled event is POSTed to
`/ai/assistants/{assistant_id}/scheduled_events`, and the returned `conversation_id`
is appended to the local JSON-lines store.

Run it:

```bash
python app.py place-call
```

---

## 9. The webhook receiver (`serve`)

The Flask app exposes two routes:

- `POST /webhooks/telnyx` — verifies the Ed25519 signature with
  `telnyx.Webhook.construct_event`, checks that the event type is
  `call.conversation.insights_generated`, prints the sorted payload keys, and appends
  the `conversation_id` to the local store.
- `GET /health` — a liveness probe.

Start the receiver:

```bash
python app.py serve
```

To make it reachable from Telnyx, expose it with ngrok:

```bash
ngrok http 8000
```

Then set `PUBLIC_WEBHOOK_BASE_URL` to the ngrok URL and re-run `create-templates` and
`create-group` so the `webhook` fields point at your tunnel. You can print the exact
registration URL with:

```bash
python app.py print-url
```

The webhook is an **enhancement, not a requirement** — the scorecard's polling path
works end-to-end without it.

---

## 10. The QA scorecard (`scorecard`)

The `render_scorecard()` function is where the schema-first payoff lands. It:

1. Reads conversation rows from the local store (or uses `--conversation-id` for a
   manual run).
2. Filters by `--date` if provided.
3. Fetches insight records per conversation via
   `GET /ai/conversations/{conversation_id}/conversations-insights`.
4. For each record, checks the status:
   - `pending` / `in_progress` → added to the **pending** list (not a failure)
   - `completed` → validated against the declared schema
5. Validates each completed record with `_validate_record()`, which checks required
   fields, enum membership, and primitive types.
6. Aggregates valid records into three buckets: sentiment distribution, compliance
   flag rates, and escalation breakdown.

Run it:

```bash
python app.py scorecard --date 2026-10-20
```

### 10.1 The `--strict` failure mode

Passing `--strict` appends a synthetic record with conversation ID
`demo-synthetic-invalid` to the row list. That record is missing the required
`positivity_score` field, so the validator flags it, excludes it from the aggregates,
and prints its conversation ID under `schema_invalid`.

```bash
python app.py scorecard --strict
```

This is deterministic — it does not depend on the model misbehaving — and it
demonstrates the difference between "not ready yet" (pending) and "schema-invalid"
(a record that violated the contract).

---

## 11. The four insight statuses

The scorecard distinguishes four statuses returned by the polling endpoint:

| Status | Meaning | Scorecard treatment |
| --- | --- | --- |
| `pending` | Analysis has not started. | Added to `pending` list. |
| `in_progress` | Analysis is running. | Added to `pending` list. |
| `completed` | Record is ready. | Validated and aggregated. |
| `failed` | Analysis failed. | Surfaced via the API response; not aggregated. |

The key insight: `pending` and `in_progress` are **not failures**. The sample treats
them as "not ready yet" so a scorecard run never conflates a slow pipeline with a
broken one.

---

## 12. The `json_schema` string-vs-object option

The `POST /ai/conversations/insights` endpoint accepts `json_schema` as either a
JSON string or a JSON object. This sample serializes with `json.dumps()` before
sending, which is the string form. If you prefer to send the object directly, drop
the `json.dumps()` call in `create_templates()` — the endpoint accepts both.

The string form is convenient when you are loading schemas from a file or a database
column; the object form is convenient when the schema is defined inline in Python.

---

## 13. End-to-end run

Putting it all together:

```bash
# 1. Create the three insight templates
python app.py create-templates

# 2. Create the group and assign the templates
python app.py create-group

# 3. Wire the group to the assistant
python app.py wire-assistant

# 4. Start the webhook receiver (in another terminal)
python app.py serve

# 5. Place the demo call
python app.py place-call

# 6. Render the scorecard
python app.py scorecard --date 2026-10-20

# 7. Demonstrate the strict failure mode
python app.py scorecard --strict
```

---

## 14. Next steps

- [Structured data insights](https://developers.telnyx.com/docs/inference/ai-insights/structured-insights) — the conceptual overview of schema-first extraction.
- [Insight groups](https://developers.telnyx.com/docs/inference/ai-insights/insight-groups) — how to bundle templates and attach them to assistants.
- [Create insight template](https://developers.telnyx.com/api-reference/conversations/create-insight-template) — the full request/response shape for `POST /ai/conversations/insights`.
- [Create insight template group](https://developers.telnyx.com/api-reference/conversations/create-insight-template-group) — group creation parameters.
- [Assign insight template to group](https://developers.telnyx.com/api-reference/conversations/assign-insight-template-to-group) — the membership endpoint.
- [Get insights for a conversation](https://developers.telnyx.com/api-reference/conversations/get-insights-for-a-conversation) — the polling path and status semantics.
- [call.conversation.insights_generated webhook](https://developers.telnyx.com/api-reference/callbacks/call-conversation-insights-generated) — the push completion signal.
- [Update an assistant](https://developers.telnyx.com/api-reference/assistants/update-an-assistant) — the `insight_settings` field.

From here you can extend the sample by adding more templates (one per concern), wiring
multiple groups to different assistants, or feeding the scorecard output into your own
dashboard. The schema-first pattern means every downstream consumer gets a typed
record — no regex required.
