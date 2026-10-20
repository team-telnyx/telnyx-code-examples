# Structured-Insights Pipeline Desk — A Schema-First Conversation Mining Tutorial

This guide walks you through the `insights-pipeline` sample end to end. By the
time you finish, you will have built a complete structured-insights pipeline
over AI conversations: three `json_schema`-backed insight templates, an insight
group that bundles them, an assistant wired to that group, a demo call that
produces a real conversation, a webhook receiver that consumes the completion
event, and a QA scorecard that renders typed records — sentiment distribution,
compliance-flag rates, escalation breakdown — with zero regex parsing.

The whole point of the sample is the **schema-first pattern**. Instead of
shipping free-text summaries into your analytics pipeline and then
regex-parsing them, you declare a strict `json_schema` on each insight
template. The model's output is a typed record on day one, so it lands in a
dashboard without anyone writing a parser.

---

## 1. What you are building

The pipeline has four layers, and each one only talks to its neighbor:

```
┌─────────────────────┐
│  Insight templates  │  one per concern, each with its own json_schema
│  (sentiment-v1,     │  POST /ai/conversations/insights
│   compliance-v1,    │
│   escalation-v1)    │
└──────────┬──────────┘
           │ assign
           ▼
┌─────────────────────┐
│   Insight group     │  bundles the templates
│   qa-scorecard-v1   │  POST /ai/conversations/insight-groups
└──────────┬──────────┘
           │ referenced by
           ▼
┌─────────────────────┐
│ Assistant           │  insight_settings → group id
│ insight_settings    │  every call conversation analyzed once
└──────────┬──────────┘
           │ produces
           ▼
┌─────────────────────┐        ┌──────────────────────┐
│ Webhook receiver    │        │  Scorecard renderer  │
│ call.conversation.  │        │  schema-validate +   │
│ insights_generated  │        │  aggregate           │
└─────────────────────┘        └──────────────────────┘
```

The webhook receiver is the **push** path. Polling
`GET /ai/conversations/{id}/conversations-insights` is the **pull** fallback,
and it is also the source of truth for the scorecard. The sample deliberately
runs both so you can see they agree.

---

## 2. Prerequisites

- Python 3.10 or newer.
- A Telnyx account with an API key. Create one in the
  [Telnyx Portal](https://portal.telnyx.com).
- An assistant phone number already associated with your assistant in the
  portal. The scheduled-event surface requires `telnyx_agent_target` to be a
  number the assistant owns.
- A destination number you control (the "caller" side of the demo call).
- Optional but recommended for the webhook path: [`ngrok`](https://ngrok.com)
  so your local receiver is publicly reachable.

Install dependencies:

```bash
pip install -r requirements.txt
```

---

## 3. Environment setup

Copy the example env file and fill it in:

```bash
cp .env.example .env
```

The variables the sample reads:

| Variable | Purpose |
| --- | --- |
| `TELNYX_API_KEY` | Bearer token for every REST call and the typed SDK. |
| `TELNYX_PUBLIC_KEY` | Ed25519 public key used to verify webhook signatures. |
| `TELNYX_API_BASE` | API base URL. Defaults to `https://api.telnyx.com/v2`. |
| `PUBLIC_WEBHOOK_BASE_URL` | Public base URL of your receiver (e.g. the ngrok URL). Registered into the template and group `webhook` fields. |
| `CONVERSATIONS_STORE` | Path to the local JSON-lines store. Defaults to `conversations.json`. |
| `INSIGHT_TEMPLATE_IDS` | Comma-separated template IDs produced by `create_templates.py`. |
| `INSIGHT_GROUP_ID` | Group ID produced by `create_group.py`. |
| `ASSISTANT_ID` | Assistant ID produced by `wire_assistant.py` (or one you already have). |
| `ASSISTANT_PHONE_NUMBER` | The number associated with the assistant in the portal. |
| `DESTINATION_NUMBER` | The caller's number for the demo call (E.164). |
| `DEMO_MODE` | `true` (default) prints the scheduled-event payload instead of placing a real call. Set `false` to place the call. |

### Demo mode vs live mode

`place_call.py` is the only script that can spend money or ring a phone. It is
gated by `DEMO_MODE`:

- **Demo mode** (`DEMO_MODE=true`, the default): the script prints the exact
  scheduled-event payload it *would* POST and exits. Nothing is dialed. This is
  the safe default for CI and for first runs.
- **Live mode** (`DEMO_MODE=false`): the script POSTs the scheduled event to
  `POST /ai/assistants/{assistant_id}/scheduled-events`, the call is placed
  ~60 seconds later, and the response's `conversation_id` is appended to the
  local store.

You can also force a dry run regardless of `DEMO_MODE` with
`python place_call.py --dry-run`.

---

## 4. The workflow, step by step

Each step is a standalone script. Run them in order. Every script prints the
export line the next script needs.

### Step 1 — `create_templates.py`: declare the extraction schemas

This is where the schema-first pattern lives. The script defines three
templates, each with a strict `json_schema` in **object form**:

- **`sentiment-v1`** — `positivity_score` (number, 1–5), `frustration_level`
  (number, 1–5), `overall_sentiment` (enum: `positive` | `negative` | `mixed` |
  `neutral`), `key_emotions` (array of free strings). Required:
  `positivity_score`, `frustration_level`, `overall_sentiment`.
- **`compliance-v1`** — `verified_identity` (boolean), `compliance_flags`
  (array of enum: `identity_verification_passed` | `disclosure_missing` |
  `profanity_detected` | `sensitive_data_mentioned` | `escalation_requested`).
  Required: `verified_identity`, `compliance_flags`.
- **`escalation-v1`** — `escalation_reason` (enum: `caller_request` |
  `compliance_violation` | `poor_call_quality` | `system_error` | `other`),
  `agent_performed_well` (boolean). Required: `escalation_reason`,
  `agent_performed_well`.

The script POSTs each template to `POST /ai/conversations/insights`, validates
that the response echoes an `id` and a `json_schema`, and prints the template
IDs. It also diffs the template count before and after the run and prints the
drift, so re-runs that would duplicate instead of update are visible.

Templates are idempotently named (`sentiment-v1`, etc.) so re-running updates
rather than duplicates.

```bash
python create_templates.py
```

Copy the printed IDs into `INSIGHT_TEMPLATE_IDS` in `.env`.

> **Note on the SDK surface.** The AI Conversations insights endpoints are
> untyped in the shipped Python SDK, so this script (and `create_group.py` and
> `scorecard.py`) call them via raw REST with the `Authorization: Bearer`
> header and unwrap the `{"data": ...}` envelope. Assistant create/update in
> `wire_assistant.py` uses the typed SDK (`client.ai.assistants.*`).

### Step 2 — `create_group.py`: bundle the templates

An insight group is the documented composition pattern: the assistant
references the group once, and every call conversation is analyzed with all
templates applied — no per-call wiring.

The script POSTs to `POST /ai/conversations/insight-groups` with a name, a
description, and (if `PUBLIC_WEBHOOK_BASE_URL` is set) the webhook URL. It then
assigns each template from `INSIGHT_TEMPLATE_IDS` via
`POST /ai/conversations/insight-groups/{group_id}/insights/{insight_id}/assign`.

Finally it **re-reads the group** and prints its membership, and exits with an
error if the membership count does not match the number of templates you
assigned. That verification is the point — you should never trust the assign
call's 200 alone.

```bash
python create_group.py
```

Copy the printed `INSIGHT_GROUP_ID` into `.env`.

### Step 3 — `wire_assistant.py`: attach `insight_settings`

This script sets `insight_settings` on the assistant so every call conversation
is analyzed. If `ASSISTANT_ID` is set in the environment it updates that
assistant; otherwise it creates a new one.

The demo assistant's `system_prompt` embeds the scenario that guarantees a
non-trivial scorecard:

> The caller is a frustrated patient demanding to speak to a human (triggers
> `frustration_level` > 1 and `escalation_reason: caller_request`). The
> assistant must verify the caller's date of birth before discussing anything
> (`identity_verification_passed`), and must state a mandatory
> callback-disclosure line exactly once (one scripted miss makes
> `disclosure_missing` appear).

Model and voice are omitted on create so the platform defaults apply.

After create/update, the script calls `client.ai.assistants.retrieve(...)` and
verifies that `insight_settings` is actually reported back. If it is not, the
script exits with an error — the wiring failed.

```bash
python wire_assistant.py
```

Copy the printed `ASSISTANT_ID` into `.env`.

### Step 4 — `place_call.py`: place the demo call

The demo call goes through the assistant **scheduled-event surface** with
channel `phone_call`:

```json
{
  "telnyx_conversation_channel": "phone_call",
  "telnyx_end_user_target": "$DESTINATION_NUMBER",
  "telnyx_agent_target": "$ASSISTANT_PHONE_NUMBER",
  "scheduled_at_fixed_datetime": "<now + ~60 seconds>"
}
```

The script errors with an actionable message if `ASSISTANT_PHONE_NUMBER` is not
set, because `telnyx_agent_target` must be a number already associated with the
assistant in the portal.

In live mode, the create response includes a `conversation_id`. The script
appends `{"conversation_id", "received_at"}` to the local JSON-lines store
(`conversations.json` by default) so `scorecard.py` can find the conversation
without enumerating the account.

```bash
python place_call.py            # respects DEMO_MODE
python place_call.py --dry-run  # always prints the payload
```

### Step 5 — `webhook_receiver.py`: consume the completion event

The receiver is a FastAPI app that listens on `POST /webhooks/telnyx`. It
verifies the Telnyx Ed25519 signature via `telnyx.Webhook.construct_event`,
ignores anything that is not `call.conversation.insights_generated`, and on
first receipt of a conversation prints the **payload keys** and appends the
conversation id to the local store.

Start it:

```bash
python webhook_receiver.py --port 8000
```

Expose it publicly:

```bash
ngrok http 8000
```

Then set `PUBLIC_WEBHOOK_BASE_URL` to the ngrok URL and re-run
`create_templates.py` and `create_group.py` so the webhook is registered into
the template and group `webhook` fields. To see the exact registration payload
without guessing:

```bash
python webhook_receiver.py --print-url
```

> **The webhook is an enhancement, not a requirement.** With no public URL
> configured, the demo still works end to end via the scorecard's polling path
> (`GET /ai/conversations/{id}/conversations-insights`). The receiver exists so
> you can see the push path and confirm both routes agree.

### Step 6 — `scorecard.py`: validate and render

This is the payoff. The script:

1. Loads conversation rows from the local store, filtered by `--date` (an ISO
   date prefix) or overridden entirely by `--conversation-id`.
2. For each conversation, calls
   `GET /ai/conversations/{conversation_id}/conversations-insights`.
3. Classifies each record:
   - status `pending` or `in_progress` → **pending** (not a failure — the
     insight set is not ready yet),
   - missing required fields → **schema-invalid** (excluded from aggregates),
   - otherwise → **valid**.
4. Renders the scorecard: sentiment distribution, compliance-flag rates,
   escalation breakdown.

```bash
python scorecard.py --date 2026-10-20
python scorecard.py --conversation-id <id>
```

The readiness gate matters: the sample distinguishes "not ready yet" from
"schema-invalid". A record still `in_progress` is a pending row, not a failure.

#### The `--strict` failure mode

`python scorecard.py --strict` injects a **synthetic** invalid record — one
missing the required `positivity_score` field — under the clearly-fake
conversation ID `demo-synthetic-invalid`. The validator flags it, excludes it
from the aggregates, and prints its conversation ID.

This is deterministic on purpose: it does not depend on the model misbehaving,
so you can demo the failure mode in a CI run.

```bash
python scorecard.py --strict
```

---

## 5. The thin dispatcher: `app.py`

`app.py` is not a workflow step. It is a help dispatcher that lists the six
scripts and their roles:

```bash
python app.py --list
```

It exists so a new developer can see the whole pipeline in one screen without
reading the README.

---

## 6. The local conversation store

`conversations.json` is a JSON-lines file maintained inside the sample:

```json
{"conversation_id": "abc-123", "received_at": "2026-10-20T14:03:11+00:00"}
{"conversation_id": "def-456", "received_at": "2026-10-20T14:07:42+00:00"}
```

Two writers append to it:

- `webhook_receiver.py` appends a row on every
  `call.conversation.insights_generated` event it receives.
- `place_call.py` appends a row using the `conversation_id` returned directly
  on the scheduled-event create response.

`scorecard.py` reads it. There is no account-wide conversation enumeration in
the referenced API set, so the store is how the scorecard knows which
conversations to pull.

---

## 7. Running the whole thing

```bash
# 1. Declare the schemas
python create_templates.py
# → copy the printed IDs into INSIGHT_TEMPLATE_IDS

# 2. Bundle them
python create_group.py
# → copy INSIGHT_GROUP_ID into .env

# 3. Wire the assistant
python wire_assistant.py
# → copy ASSISTANT_ID into .env

# 4. (optional) start the receiver and expose it
python webhook_receiver.py --port 8000 &
ngrok http 8000
# → set PUBLIC_WEBHOOK_BASE_URL, re-run steps 1 and 2

# 5. Place the demo call (live mode)
DEMO_MODE=false python place_call.py

# 6. Render the scorecard once insights complete
python scorecard.py --date 2026-10-20

# 7. See the failure mode
python scorecard.py --strict
```

---

## 8. Troubleshooting

**`TELNYX_API_KEY is not set`** — you did not copy `.env.example` to `.env`, or
you are running from a directory where `.env` is not found. `load_dotenv()`
reads from the current working directory.

**`INSIGHT_TEMPLATE_IDS is not set`** — run `create_templates.py` first and
paste the printed IDs into `.env` as a comma-separated list.

**`Membership mismatch`** — the group re-read did not return every template you
assigned. Check that the template IDs in `INSIGHT_TEMPLATE_IDS` are the ones
you just created, not stale IDs from a previous run.

**`Assistant does not report insight_settings`** — the update call returned 200
but the retrieve did not echo the settings. Confirm `INSIGHT_GROUP_ID` is set
and that the group exists.

**`ASSISTANT_PHONE_NUMBER is not set`** — `telnyx_agent_target` must be a
number already associated with the assistant in the portal. Associate one
there, then set the env var.

**`Scheduled-event response is missing conversation_id`** — the create response
did not include the conversation id. Check the raw response body; the sample
expects the id at `data.conversation_id`.

**Webhook signature verification fails** — `TELNYX_PUBLIC_KEY` is wrong or
missing. Copy the public key from the portal. The receiver returns 400 on
verification failure and logs the exception server-side.

**Scorecard shows everything as pending** — the insight set has not completed
yet. `call.conversation.insights_generated` fires once per conversation when
the set completes; give it a minute and re-run.

---

## 9. Next steps

- [Structured data insights](https://developers.telnyx.com/docs/inference/ai-insights/structured-insights) — the schema-first pattern in depth.
- [Insight groups](https://developers.telnyx.com/docs/inference/ai-insights/insight-groups) — the composition pattern this sample uses.
- [Create insight template](https://developers.telnyx.com/api-reference/conversations/create-insight-template) — the `json_schema` string-vs-object option.
- [Create insight template group](https://developers.telnyx.com/api-reference/conversations/create-insight-template-group)
- [Assign insight template to group](https://developers.telnyx.com/api-reference/conversations/assign-insight-template-to-group)
- [Get insights for a conversation](https://developers.telnyx.com/api-reference/conversations/get-insights-for-a-conversation) — the four statuses: `pending`, `in_progress`, `completed`, `failed`.
- [call.conversation.insights_generated webhook](https://developers.telnyx.com/api-reference/callbacks/call-conversation-insights-generated)
- [Update an assistant](https://developers.telnyx.com/api-reference/assistants/update-an-assistant) — `insight_settings` wiring.
