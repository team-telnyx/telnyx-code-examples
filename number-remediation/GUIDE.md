# Number Reputation Remediation Desk — Developer Guide

A step-by-step walkthrough of the `number-remediation` sample: how a flagged
phone number flows from intake, through the two-tier remediation review, to a
per-number verdict report.

This guide explains **what each script does, why it exists, and how the pieces
connect**. For the endpoint-level reference see `API.md`; for setup and the
quick command list see `README.md`.

---

## 1. The problem this sample solves

Outbound-heavy teams eventually get numbers flagged. The operational question
is never "are we flagged?" — it's **"our numbers got flagged, now what?"**

Number Reputation answers that with a **remediation workflow**: you submit the
flagged numbers with a stated `call_purpose`, Telnyx runs a **two-tier review**,
and each number lands in exactly one outcome bucket:

| Bucket | Meaning |
| --- | --- |
| `remediated` | The flag was cleared — the number is good to dial again. |
| `not_flagged` | On review, the number was never actually flagged. |
| `requires_review` | Needs a human decision; follow the review guidance docs. |
| `ineligible` | Cannot be remediated (e.g. not owned by the enterprise). |
| `refused` | Remediation was declined. |

This sample is the **remediation half** of the reputation story. (An earlier
sample, DEV-216, built a *monitor with auto-rotation* — swap flagged numbers
out. This one *submits* flagged numbers and rides the review to a verdict.
They are deliberately non-overlapping.)

---

## 2. Architecture at a glance

Four pieces, in the order a flagged number flows through them:

```
numbers.csv
    │
    ▼
┌──────────────────────────┐
│ check_reputation.py      │  Step 1 — enterprise reputation read
│  (flagged-number intake) │  splits flagged vs clean → flagged.csv
└──────────────────────────┘
    │
    ▼
┌──────────────────────────┐
│ submit_remediation.py    │  Step 2 — POST remediation request
│  (202 Accepted contract) │  stores remediation_request_id.txt
└──────────────────────────┘
    │
    ├──────────────► webhook_receiver.py   Step 3a — tiered events
    │                (Flask + Ed25519)      tier1_complete → completed/failed
    │
    └──────────────► poll_remediation.py   Step 3b — no-webhook fallback
                       (60 s poll loop)     status transitions + tier timestamps
    │
    ▼
┌──────────────────────────┐
│ report.py                │  Step 4 — render the five buckets
│  (report writer)         │  → remediation_report.md
└──────────────────────────┘
```

The **enterprise** is the resource root. Reputation data and remediation
requests are both scoped to `TELNYX_ENTERPRISE_ID` — the same enterprise you
register once and share with Branded Calling.

`app.py` is a **thin dispatcher only**. It prints the menu and points at the
right script. It holds no workflow logic.

---

## 3. Prerequisites

- Python 3.10+
- A Telnyx account with an **enterprise** registered
- `TELNYX_API_KEY` and `TELNYX_ENTERPRISE_ID`
- For webhook mode: a public HTTPS endpoint and your `TELNYX_PUBLIC_KEY`

Install dependencies:

```bash
pip install -r requirements.txt
```

---

## 4. Demo mode vs live mode

Every script reads `DEMO_MODE` from the environment (default `true`).

- **Demo mode (`DEMO_MODE=true`)** — no network calls to Telnyx. Each script
  returns deterministic fixture data so the whole workflow runs end-to-end
  without credentials. This is the default and the safe way to explore the
  flow.
- **Live mode (`DEMO_MODE=false`)** — real API calls against your enterprise.
  Requires `TELNYX_API_KEY` and `TELNYX_ENTERPRISE_ID`. The webhook receiver
  additionally requires `TELNYX_PUBLIC_KEY`.

Switch by editing `.env`:

```bash
DEMO_MODE=false
```

The scripts guard live mode explicitly: if `DEMO_MODE=false` and the required
credentials are missing, they exit with a clear error rather than making a
half-authenticated call.

---

## 5. Step 1 — Flagged-number intake (`check_reputation.py`)

**Role:** read enterprise-scoped reputation data for every number in a CSV,
print the interesting fields, and write the flagged subset to `flagged.csv`.

**Run:**

```bash
python check_reputation.py --numbers numbers.csv
```

**What it does, in order:**

1. `read_numbers()` parses the first column of the input CSV. A header row
   (`number`, `phone_number`, `e164`) is skipped automatically.
2. For each number, `fetch_reputation()` calls the enterprise-scoped
   reputation read and pulls `spam_risk`, `spam_score`, `spam_category`, and
   `last_refreshed_at`. In demo mode, `_demo_record()` produces a deterministic
   record instead.
3. `is_flagged()` is the intake rule: a number is flagged when `spam_risk` is
   `medium` or `high`, **or** a `spam_category` is set. This is the single
   place the "what counts as flagged" decision lives.
4. The script prints a table and writes the flagged numbers to `flagged.csv`
   (default `--out`).

**Why it's a separate script:** intake is the *detect* half of the
detect-then-remediate loop. Keeping it separate means you can re-run intake
against fresh reputation data at any time without touching the submission
state.

**Output:** a printed table plus `flagged.csv` with a `phone_number` header.

---

## 6. Step 2 — Submit for remediation (`submit_remediation.py`)

**Role:** POST the flagged set to the enterprise remediation endpoint, assert
the `202 Accepted` contract, and store the request ID for later steps.

**Run:**

```bash
python submit_remediation.py \
  --purpose "Outbound appointment reminders for our dental clinic." \
  --webhook https://example.com/hooks/remediation
```

**The 202 Accepted contract.** The submit endpoint returns `202 Accepted`
with a persisted request whose initial `status` is `pending`, plus three
counts:

- `phone_numbers_count` — total numbers in the request
- `phone_numbers_submitted` — numbers accepted into review
- `phone_numbers_ineligible` — numbers rejected up front

The script **asserts all three fields are present and that `status ==
"pending"`** before it stores the request ID. If the contract is violated, it
fails loudly rather than writing a bad ID to disk.

**Validation limits, encoded in the tool.** The endpoint enforces:

| Field | Limit |
| --- | --- |
| `phone_numbers` | 1–2,000 E.164 numbers |
| `call_purpose` | 1–2,000 characters (required) |
| `contact_email` | max 255 characters |
| `webhook_url` | max 2,048 characters |

The script checks these locally *before* submitting, and the
`--invalid-purpose` flag demonstrates the server-side `400`:

```bash
python submit_remediation.py --invalid-purpose
```

This sends an over-length `call_purpose` and a batch over 2,000 numbers, and
prints the documented `400` for each — so the limits are visible in the tool
itself, not just in the docs.

**Output:** the JSON `202` response, and `remediation_request_id.txt`
containing the request ID.

---

## 7. Step 3a — Webhook receiver (`webhook_receiver.py`)

**Role:** a Flask app that verifies the Telnyx Ed25519 signature and logs the
three tiered remediation events.

**Run:**

```bash
python webhook_receiver.py
```

The receiver listens on `/hooks/remediation` (port from `PORT`, default
`5000`). Every request is verified with `client.webhooks.unwrap(...)` against
`TELNYX_PUBLIC_KEY`; a failed verification returns `401` and logs the
exception — no payload details leak into the response.

**The three tiered events:**

| Event | Meaning |
| --- | --- |
| `number_reputation.remediation.tier1_complete` | Tier-1 review done; the request continues to tier 2. |
| `number_reputation.remediation.completed` | Review finished; `results` buckets are populated. |
| `number_reputation.remediation.failed` | Review failed; a `failure_reason` is included. |

Each payload carries the request `id`, `status`, and (on completion) the
`results`. The receiver prints a human-readable line per event and logs it via
`app.logger`. Unhandled event types are logged and ignored, not errored.

**Why the tier-1 event matters:** it's the signal that the request is *still
moving*. If you only watched for `.completed`, a long tier-2 phase would look
like a hang. The tier-1 event tells you where the wall-clock time is going.

---

## 8. Step 3b — Polling fallback (`poll_remediation.py`)

**Role:** the no-webhook path. Polls the request endpoint every 60 seconds and
prints status transitions.

**Run:**

```bash
python poll_remediation.py            # loop until terminal
python poll_remediation.py --once     # single poll
python poll_remediation.py --interval 30
```

The script reads the request ID from `remediation_request_id.txt` (written by
Step 2) or from `--request-id`. It polls
`GET .../reputation/remediation/{id}` and prints `status` plus
`tier1_completed_at` / `tier2_completed_at` when present.

**Meta-statuses:** `pending` → `in_progress` → `completed` / `failed` /
`cancelled`. The loop stops on any terminal status.

**Why both paths exist:** webhooks are the low-latency path, but not every
team has a public callback endpoint. Polling reaches the **same final report**
without webhooks — the two observation paths are interchangeable, and the
report writer doesn't care which one you used.

---

## 9. Step 4 — Report writer (`report.py`)

**Role:** render the final request into `remediation_report.md`.

**Run:**

```bash
python report.py
python report.py --request-id demo-remediation-0001 --out remediation_report.md
```

The report contains:

- **Meta-status** and the request ID
- **Two-tier timing** — `tier1_completed_at` vs `tier2_completed_at`, which
  shows where the request actually spent its wall-clock time
- **A bucket summary table** with counts for all five buckets
- **A per-bucket listing** of the numbers in each

For `requires_review` numbers, the report links the review guidance docs so a
human reviewer has a next step rather than a dead end.

**Output:** `remediation_report.md`.

---

## 10. The dispatcher (`app.py`)

`app.py` is intentionally trivial. It parses no workflow arguments and holds
no state — it prints the ordered menu of the five scripts and exits. Run it
when you forget the order:

```bash
python app.py
```

For flags on any individual step, use that script's own `--help`.

---

## 11. Running the full flow

**Demo mode (default, no credentials):**

```bash
python check_reputation.py --numbers numbers.csv
python submit_remediation.py --purpose "Outbound appointment reminders."
python poll_remediation.py
python report.py
```

**Live mode:**

```bash
# .env: DEMO_MODE=false, TELNYX_API_KEY=..., TELNYX_ENTERPRISE_ID=...
python check_reputation.py --numbers numbers.csv
python submit_remediation.py \
  --purpose "Outbound appointment reminders for our dental clinic." \
  --webhook https://example.com/hooks/remediation
python webhook_receiver.py     # in a second terminal, if using webhooks
python report.py
```

---

## 12. Testing

```bash
pytest smoke_test.py
```

The smoke test imports every workflow module, asserts each exposes a callable
`main()`, checks the webhook receiver registers `/hooks/remediation`, and
verifies the report's `BUCKETS` constant matches the five documented buckets.

---

## 13. Next steps

- [Remediation guide](https://developers.telnyx.com/docs/number-reputation/remediation) — the two-tier flow and bucket semantics in depth
- [Number Reputation overview](https://developers.telnyx.com/docs/number-reputation/overview)
- [Query reputation scores](https://developers.telnyx.com/docs/number-reputation/phone-numbers) — the intake read
- [Quickstart](https://developers.telnyx.com/docs/number-reputation/quickstart)
- [Submit phone numbers for reputation remediation](https://developers.telnyx.com/api-reference/reputation/submit-phone-numbers-for-reputation-remediation)
- [Get a reputation remediation request](https://developers.telnyx.com/api-reference/reputation/get-a-reputation-remediation-request)
- [List reputation remediation requests](https://developers.telnyx.com/api-reference/reputation/list-reputation-remediation-requests-for-an-enterprise)
- [Number Reputation pricing](https://developers.telnyx.com/docs/number-reputation/pricing)
