---
name: number-remediation
title: "Number Reputation Remediation Desk — Flag-Response Workflow with Tiered Outcomes"
description: "Submit flagged numbers for Number Reputation remediation, ride the two-tier review via webhooks or polling, and render per-number outcome buckets."
language: python
framework: flask
telnyx_products: [Number Reputation, Messaging]
---

# Number Reputation Remediation Desk — Flag-Response Workflow with Tiered Outcomes

Close the loop on flagged numbers: read enterprise-scoped reputation data, submit a remediation request, consume the tiered webhooks (or poll as a fallback), and render the five per-number outcome buckets into a reviewable report.

## The Story

A dental clinic runs outbound appointment reminders from a small pool of local numbers. When those numbers get flagged as spam, the reminders stop landing — patients miss appointments, chairs sit empty, and the front desk spends its morning calling people back by hand. The stakes are not abstract: a flagged number is lost revenue and lost trust, and the clinic has no idea which numbers are recoverable and which are dead.

The actor IS the remediation desk. It is born the moment a number is flagged — it reads that number's reputation data, separates the dirty from the clean, and writes the flagged set to a file. It evolves as it submits that set for review, then waits through a two-tier pipeline, watching webhooks arrive or polling the request endpoint when no callback endpoint exists. It completes when every number lands in a bucket — remediated, not_flagged, requires_review, ineligible, or refused — and the desk renders the verdict into a report a human can act on. It survives the ordinary chaos of the job: the webhook receiver goes down mid-review, so the poller picks up the thread; the sending platform reboots mid-batch, so the stored request ID lets the desk re-attach to the same request instead of resubmitting. Durability is the point — the numbers keep moving through review whether or not anyone is watching. The rest of this README is the API surface of that story.

## Why Telnyx

Number Reputation remediation is the operational half of outbound deliverability, and it runs on **AI Communications Infrastructure** — the same enterprise-scoped reputation service that powers Branded Calling, the same webhook fabric that carries every other Telnyx event, and the same API key that sends the messages in the first place. You do not bolt on a separate reputation vendor; the numbers you send from are the numbers you remediate, under one enterprise root.

## Telnyx API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/v2/enterprises/{enterprise_id}/reputation/phone_numbers` | Read per-number reputation data (`spam_risk`, scores, `spam_category`, `last_refreshed_at`) |
| `POST` | `/v2/enterprises/{enterprise_id}/reputation/remediation` | Submit 1–2,000 E.164 numbers with a `call_purpose`; returns `202 Accepted` with `status: pending` |
| `GET` | `/v2/enterprises/{enterprise_id}/reputation/remediation/{id}` | Poll request detail; `results` buckets populated once completed |
| `GET` | `/v2/enterprises/{enterprise_id}/reputation/remediation` | List remediation requests for the enterprise |
| Webhook | `number_reputation.remediation.tier1_complete` | Tier-1 review finished, pipeline continuing |
| Webhook | `number_reputation.remediation.completed` | Request finished; `results` populated |
| Webhook | `number_reputation.remediation.failed` | Request failed |

## Architecture

```text
  numbers.csv
      │
      ▼
┌──────────────────────┐   GET .../reputation/phone_numbers
│  Stage 1: Intake     │──────────────────────────────────────►  Enterprise
│  check_reputation.py │◄──────────────────────────────────────  Reputation
│  split flagged/clean │   spam_risk / scores / spam_category     Service
└──────────┬───────────┘
           │ flagged.csv
           ▼
┌──────────────────────┐   POST .../reputation/remediation
│  Stage 2: Submit     │──────────────────────────────────────►  202 Accepted
│  submit_remediation  │◄──────────────────────────────────────  status: pending
│  assert 3 counts     │   phone_numbers_count / _submitted / _ineligible
└──────────┬───────────┘
           │ request_id (stored)
           ▼
┌──────────────────────┐        ┌─────────────────────────────┐
│  Stage 3: Observe    │◄───────│  Webhooks (tier1_complete,  │
│  webhook_receiver.py │        │  completed, failed)         │
│  poll_remediation.py │◄───────│  GET .../remediation/{id}   │
└──────────┬───────────┘        └─────────────────────────────┘
           │ final detail (results buckets + tier timestamps)
           ▼
┌──────────────────────┐
│  Stage 4: Report     │  remediation_report.md
│  report.py           │  remediated / not_flagged / requires_review
└──────────────────────┘  / ineligible / refused
```

Four pieces, in the order a flagged number flows through them. The **enterprise reputation service** holds the enterprise-scoped data and the remediation requests — the enterprise is the resource root, registered once and shared with Branded Calling. The **remediation pipeline** is the two-tier review flow with per-number outcomes; webhooks notify progress, polling is the fallback for teams without callback endpoints. The **flagged-number intake** reads reputation data and derives the submission set, closing the detect-then-remediate loop in one repo. The **report writer** renders the five outcome buckets plus the two-tier timing into a reviewable document.

The submit contract is pinned precisely: `202 Accepted` returns the persisted request with initial `status: pending` plus `phone_numbers_count`, `phone_numbers_submitted`, and `phone_numbers_ineligible` — the sample asserts all three counts before storing the request ID.

## Environment Variables

| Variable | Type | Example | Required | Default | Description | Where to get it |
|----------|------|---------|----------|---------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789` | **yes** | — | Authenticates every SDK call | Telnyx Portal → API Keys |
| `TELNYX_ENTERPRISE_ID` | `string` | `ent_abc123` | **yes** | — | Enterprise resource root; scopes reputation reads and remediation requests | Telnyx Portal → Enterprise |
| `TELNYX_PUBLIC_KEY` | `string` | `+abc123...` | webhook mode only | — | Verifies inbound webhook signatures via `client.webhooks.unwrap` | Telnyx Portal → Webhooks |
| `DEMO_MODE` | `string` | `true` | no | `true` | When `true`, no real remediation is submitted and reputation reads are synthesized | — |
| `POLL_INTERVAL_SECONDS` | `string` | `60` | no | `60` | Sleep between polls in live mode | — |
| `PORT` | `string` | `5000` | no | `5000` | Flask bind port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/number-remediation

python -m venv .venv
source .venv/bin/activate

pip install -r requirements.txt

cp .env.example .env
# edit .env — set TELNYX_API_KEY and TELNYX_ENTERPRISE_ID
# set TELNYX_PUBLIC_KEY only if you want webhook mode
# leave DEMO_MODE=true to run the whole flow without submitting anything real

python app.py
```

The app starts on `PORT` (default `5000`). In demo mode every stage runs end-to-end against synthetic reputation data and a synthetic remediation request, so you can walk the full flow — intake, submit, observe, report — without touching a real number.

Run the smoke test to confirm the module loads and the routes are wired:

```bash
python smoke_test.py
```

## API Reference

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/health` | Liveness check; reports `demo_mode` |
| `POST` | `/reputation/check` | Read reputation for a list of numbers; splits flagged from clean; writes `flagged.csv` |
| `POST` | `/remediation/submit` | Validate and submit a remediation request; returns the `202` body |
| `GET` | `/remediation/{request_id}` | Fetch request detail (status + `results` buckets) |
| `GET` | `/remediation/{request_id}/poll` | Poll until a terminal status (`completed` / `failed` / `cancelled`) |
| `GET` | `/remediation/{request_id}/report` | Render the markdown report for a request |
| `POST` | `/webhooks/remediation` | Receive tiered remediation webhooks (Ed25519 signature verified) |

See [API.md](API.md) for full request/response shapes and status codes.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `400` on submit with "call_purpose exceeds limit" | `call_purpose` longer than 2,000 chars | Shorten the purpose string; the limit is 1–2,000 chars |
| `400` on submit with "phone_numbers exceeds limit" | More than 2,000 numbers in one request | Split into batches of ≤2,000 |
| `404` on `GET /remediation/{id}` | Request ID not found, or not owned by this enterprise | Confirm `TELNYX_ENTERPRISE_ID` matches the enterprise that submitted |
| Webhook returns `400 invalid signature` | `TELNYX_PUBLIC_KEY` missing or wrong | Set the Telnyx public key from the portal; the handler verifies Ed25519 |
| Poll never reaches terminal | Review still in progress | Increase `POLL_INTERVAL_SECONDS` or wait; tier-2 review can take time |
| `502 upstream contract error` | `202` response missing a required count field | Check SDK version and API status; the sample asserts all three counts |

## Agent Discovery

- Telnyx agent signup: https://telnyx.com/agent-signup.md
- Telnyx AI examples: https://github.com/team-telnyx/ai
- Telnyx llms.txt: https://telnyx.com/llms.txt

## Related Examples

- `number-reputation-monitor` — reputation monitoring with auto-rotation (swap flagged numbers out)
- `branded-calling` — shares the enterprise resource root with Number Reputation
- `messaging-outbound` — the sending side that remediation protects

## Resources

- [Remediation guide](https://developers.telnyx.com/docs/number-reputation/remediation)
- [Number Reputation overview](https://developers.telnyx.com/docs/number-reputation/overview)
- [Query reputation scores](https://developers.telnyx.com/docs/number-reputation/phone-numbers)
- [Quickstart](https://developers.telnyx.com/docs/number-reputation/quickstart)
- [Submit phone numbers for reputation remediation](https://developers.telnyx.com/api-reference/reputation/submit-phone-numbers-for-reputation-remediation)
- [Get a reputation remediation request](https://developers.telnyx.com/api-reference/reputation/get-a-reputation-remediation-request)
- [List reputation remediation requests](https://developers.telnyx.com/api-reference/reputation/list-reputation-remediation-requests-for-an-enterprise)
- [Number Reputation pricing](https://developers.telnyx.com/docs/number-reputation/pricing)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Number Reputation product page](https://telnyx.com/products/number-reputation)
