# Number Reputation Remediation Desk — Developer Guide

A step-by-step walkthrough of the `number-remediation` sample: how it reads enterprise-scoped reputation data, submits flagged numbers for remediation, rides the two-tier review via webhooks or polling, and renders the five outcome buckets into a report.

This guide assumes you have the sample checked out and are reading `app.py` alongside it. Line ranges are referenced by feature (function name / route), not by absolute line number, so they stay stable as the file evolves.

---

## 1. What this sample does

Number Reputation's remediation flow is the operational answer to *"our numbers got flagged — now what?"* The sample closes the loop end to end:

1. **Intake** — read per-number reputation data (`spam_risk`, scores, `spam_category`, `last_refreshed_at`) from the enterprise-scoped reputation API, separate flagged from clean, write `flagged.csv`.
2. **Submit** — `POST` the flagged set (1–2,000 E.164 numbers + a `call_purpose`) to the remediation endpoint, assert the `202 Accepted` contract fields, store the request ID.
3. **Observe** — consume the tiered webhooks (`number_reputation.remediation.tier1_complete`, then `.completed` / `.failed`) **or** poll `GET .../remediation/{id}` as the no-webhook fallback.
4. **Report** — render the per-number buckets (`remediated`, `not_flagged`, `requires_review`, `ineligible`, `refused`) plus tier-1/tier-2 timing into a reviewable Markdown document.

The ticket spec describes this as a multi-script CLI flow (`check_reputation.py`, `submit_remediation.py`, `poll_remediation.py`, `report.py`, `webhook_receiver.py`). Because this repo's runtime is fixed to **Python / Flask**, those stages are consolidated into a single Flask app exposing equivalent HTTP routes plus a CLI entrypoint — each stage is a distinct route and function, so the whole flow runs from one process.

---

## 2. Prerequisites

- Python 3.10+ (the code uses `str | None` union syntax).
- A Telnyx account with **Number Reputation** enabled.
- An **enterprise** registered on your account. The enterprise is the resource root for both reputation reads and remediation requests — it is registered once and shared with Branded Calling. You need its ID (`TELNYX_ENTERPRISE_ID`).
- A Telnyx API key with access to the enterprise.
- (Optional, for webhook mode) A publicly reachable URL that forwards to this app, and your Telnyx **public key** for Ed25519 signature verification.

---

## 3. Environment setup

Copy the example env file and fill it in:

```bash
cp .env.example .env
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `TELNYX_API_KEY` | yes | Authenticates every SDK call. |
| `TELNYX_ENTERPRISE_ID` | yes | The enterprise resource root — scopes reputation reads and remediation requests. |
| `TELNYX_PUBLIC_KEY` | webhook mode | Verifies inbound webhook signatures via `client.webhooks.unwrap`. |
| `DEMO_MODE` | no (default `true`) | When `true`, no real remediation is submitted and reputation reads are synthesized. |
| `POLL_INTERVAL_SECONDS` | no (default `60`) | Sleep between polls in live mode. |
| `PORT` | no (default `5000`) | Flask bind port. |

The app loads these via `load_dotenv()` at the top of `app.py` and reads them into module-level constants (`TELNYX_API_KEY`, `ENTERPRISE_ID`, `PUBLIC_KEY`, `DEMO_MODE`, `POLL_INTERVAL_SECONDS`). The SDK client is constructed once:

```python
client = telnyx.Client(api_key=TELNYX_API_KEY) if TELNYX_API_KEY else None
```

If no key is present the client is `None` and every stage falls back to demo behavior — the app still boots and the smoke test still passes.

### Demo mode vs live mode

**Demo mode is the default.** With `DEMO_MODE=true`:

- `read_reputation()` returns synthesized records (alternating `high`/`low` risk) instead of calling the API.
- `submit_remediation()` returns a fake `202` body with `id: "demo-remediation-request"` and the three count fields, without hitting the network.
- `get_remediation()` returns a completed request with all five buckets populated.
- `poll_until_terminal()` returns immediately after the first read.

**To go live**, set `DEMO_MODE=false` in `.env` and restart. Now every stage calls the real Telnyx SDK transport against `/v2/enterprises/{enterprise_id}/reputation/...`. Nothing else in the code changes — the demo branches are guarded by `if DEMO_MODE or client is None`.

> The SDK calls use the generic request surface (`client.get(...)` / `client.post(...)`) against the enterprise reputation paths, because typed SDK wrappers for `/v2/enterprises/.../reputation` may not be present in every SDK version. This is the **real SDK transport**, not raw HTTP.

---

## 4. Running the app

```bash
pip install -r requirements.txt
python app.py
```

The Flask server binds to `0.0.0.0:$PORT` (default `5000`). Verify it's up:

```bash
curl http://localhost:5000/health
# {"status": "ok", "demo_mode": true}
```

Run the smoke test (imports the module, checks routes, no network):

```bash
python smoke_test.py
```

---

## 5. Walking through the code

### 5.1 Constants and validation limits

Near the top of `app.py` you'll find the limits pinned by the API contract:

```python
MAX_NUMBERS = 2000
MIN_PURPOSE = 1
MAX_PURPOSE = 2000
MAX_CONTACT_EMAIL = 255
MAX_WEBHOOK_URL = 2048
OUTCOME_BUCKETS = ("remediated", "not_flagged", "requires_review", "ineligible", "refused")
```

These are the same limits the API enforces. Encoding them in the tool means the validation demo (§5.7) can explain *why* a request was rejected before it ever leaves the process.

### 5.2 Helpers — masking, timestamps, validation

- `_mask(number)` keeps the country code and last two digits (`+1555***01`) so logs never carry a full phone number.
- `_now_iso()` returns a UTC ISO-8601 timestamp.
- `validate_submission(numbers, call_purpose, contact_email, webhook_url)` returns a list of human-readable errors (empty list == valid). It checks:
  - at least 1 number, at most `MAX_NUMBERS`;
  - each number looks like E.164 (starts with `+`, length ≥ 8);
  - `call_purpose` is present and 1–2,000 chars;
  - `contact_email` ≤ 255 chars if provided;
  - `webhook_url` ≤ 2,048 chars if provided.

- `_reputation_path(suffix)` builds `/v2/enterprises/{ENTERPRISE_ID}/reputation{suffix}` — the single place the enterprise scoping is applied.

### 5.3 Stage 1 — flagged-number intake (`read_reputation`, `split_flagged`, `write_flagged_csv`)

`read_reputation(numbers)` reads enterprise-scoped reputation data for each number. In live mode it calls:

```python
resp = client.get(_reputation_path("/phone_numbers"), params={"phone_numbers": ",".join(numbers)})
return resp.data.get("data", [])
```

Each record carries `phone_number`, `spam_risk`, `spam_score`, `spam_category`, and `last_refreshed_at`.

`split_flagged(records)` separates the set: a number is **flagged** if its `spam_risk` is `high` or `medium`, or if it has a `spam_category`. Everything else is clean. This is the detect-then-remediate hinge — the flagged set is what gets submitted.

`write_flagged_csv(flagged, path="flagged.csv")` writes the flagged records to `flagged.csv` with the reputation columns, so the intake stage leaves an auditable artifact.

**Route:** `POST /reputation/check` (see `route_check`) takes `{"phone_numbers": [...]}`, runs the three functions above, and returns `{"flagged": [...], "clean": [...], "flagged_csv": "flagged.csv"}`.

### 5.4 Stage 2 — submit remediation (`submit_remediation`)

`submit_remediation(numbers, call_purpose, contact_email=None, webhook_url=None)`:

1. Runs `validate_submission` and raises `ValueError` with the joined errors if anything fails.
2. Builds the payload — `phone_numbers` and `call_purpose` are required; `contact_email` and `webhook_url` are added only if provided.
3. In live mode, `POST`s to `_reputation_path("/remediation")` and unwraps `resp.data.get("data", resp.data)`.
4. **Asserts the pinned `202` contract** before storing the ID:

```python
for field in ("phone_numbers_count", "phone_numbers_submitted", "phone_numbers_ineligible"):
    if field not in body:
        raise RuntimeError(f"202 response missing required field: {field}")
```

If any of the three count fields is missing, the sample raises rather than silently storing a malformed request ID. This is the "assert all three counts before storing the request ID" step from the spec.

5. Stores `body["id"]` in `_STATE["request_id"]` (and the full body in `_STATE["last_submission"]`) — the convenience handle the CLI flow uses to chain stages.

**Route:** `POST /remediation/submit` (see `route_submit`) returns the `202` body on success, `400` with the validation error on `ValueError`, and `502` on a contract violation.

### 5.5 Stage 3 — observe (`get_remediation`, `poll_until_terminal`, webhook route)

There are **two observation paths**, and both must work.

**Path A — polling.** `get_remediation(request_id)` calls `GET _reputation_path(f"/remediation/{request_id}")` and returns the request detail. `poll_until_terminal(request_id, max_polls=30)` loops:

```python
terminal = {"completed", "failed", "cancelled"}
for _ in range(max_polls):
    last = get_remediation(request_id)
    status = last.get("status")
    logger.info("poll: request=%s status=%s", request_id, status)
    if status in terminal:
        return last
    if DEMO_MODE:
        return last
    time.sleep(POLL_INTERVAL_SECONDS)
```

It logs each status transition (`pending` → `in_progress` → `completed`/`failed`/`cancelled`) and returns as soon as a terminal status is reached. In demo mode it returns after the first read so the flow doesn't block.

**Route:** `GET /remediation/<request_id>/poll` (see `route_poll`).

**Path B — webhooks.** `POST /webhooks/remediation` (see `route_webhook`) verifies the Ed25519 signature and logs the event:

```python
event = client.webhooks.unwrap(payload.decode("utf-8"), headers, PUBLIC_KEY) if client else json.loads(payload)
...
data = event.get("data", {}) if isinstance(event, dict) else {}
event_type = data.get("event_type", "")
pl = data.get("payload", {})
logger.info("webhook event=%s request=%s status=%s", event_type, pl.get("id"), pl.get("status"))
```

The three events you'll see, in order:

1. `number_reputation.remediation.tier1_complete` — tier-1 review done, the request is continuing.
2. `number_reputation.remediation.completed` — terminal success; `results` buckets are populated.
3. `number_reputation.remediation.failed` — terminal failure.

Each payload carries the request `id`, `status`, and `results` when populated. A signature failure returns `400 {"error": "invalid signature"}` and logs the exception server-side — no detail leaks to the caller.

**Route:** `GET /remediation/<request_id>` (see `route_get`) returns the raw detail, or `404` if the request isn't found or isn't owned by your enterprise.

### 5.6 Stage 4 — report writer (`render_report`)

`render_report(detail)` turns the request detail into a Markdown document:

- Header block with the request ID, meta-status, and `tier1_completed_at` / `tier2_completed_at` (or `n/a`).
- A table iterating `OUTCOME_BUCKETS` in fixed order, showing each bucket's count and the numbers in it.
- If `requires_review` is non-empty, a section linking the remediation guide's review guidance.

The two-tier timing is the point: `tier1_completed_at` vs `tier2_completed_at` shows where the request actually spent its wall-clock time.

**Route:** `GET /remediation/<request_id>/report` (see `route_report`) returns the rendered Markdown with `mimetype="text/markdown"`.

### 5.7 The validation demo

The validation contract is enforced in `validate_submission` and demonstrated by two cases:

- An **over-length `call_purpose`** (> 2,000 chars) → `400` with `"call_purpose exceeds limit: N > 2000"`.
- A **batch over 2,000 numbers** → `400` with `"phone_numbers exceeds limit: N > 2000"`.

Both are caught in `route_submit` and returned as `{"error": "..."}` with status `400`. The limits are encoded in the tool itself, so the demo doesn't need a live API call to prove the contract.

---

## 6. End-to-end walkthrough

With the app running (demo mode is fine for a first pass):

**1. Intake — read reputation, write `flagged.csv`:**

```bash
curl -s -X POST http://localhost:5000/reputation/check \
  -H 'Content-Type: application/json' \
  -d '{"phone_numbers": ["+15550000001","+15550000002","+15550000003"]}' | jq
```

You'll get back `flagged`, `clean`, and `flagged_csv: "flagged.csv"`.

**2. Submit — get the `202` and the request ID:**

```bash
curl -s -X POST http://localhost:5000/remediation/submit \
  -H 'Content-Type: application/json' \
  -d '{
    "phone_numbers": ["+15550000001","+15550000003"],
    "call_purpose": "Outbound appointment reminders for our dental clinic.",
    "webhook_url": "https://example.com/hooks/remediation"
  }' | jq
```

Response includes `id`, `status: "pending"`, `phone_numbers_count`, `phone_numbers_submitted`, `phone_numbers_ineligible`.

**3. Observe — poll (or let the webhooks arrive):**

```bash
curl -s http://localhost:5000/remediation/demo-remediation-request/poll | jq
```

**4. Report — render the buckets:**

```bash
curl -s http://localhost:5000/remediation/demo-remediation-request/report
```

You'll see the Markdown report with all five buckets and the tier timestamps.

**5. Validation demo — trigger a `400`:**

```bash
curl -s -X POST http://localhost:5000/remediation/submit \
  -H 'Content-Type: application/json' \
  -d "{\"phone_numbers\": [\"+15550000001\"], \"call_purpose\": \"$(python -c 'print("x"*2001)')\"}" | jq
# {"error": "call_purpose exceeds limit: 2001 > 2000"}
```

---

## 7. Webhook setup (live mode)

To receive the tiered events:

1. Expose this app publicly (a tunnel to `localhost:5000` works for testing).
2. Set `TELNYX_PUBLIC_KEY` in `.env` to your Telnyx public key.
3. Pass `webhook_url` in the submit payload pointing at `https://<your-host>/webhooks/remediation`.

The receiver verifies the signature with `client.webhooks.unwrap(payload, headers, PUBLIC_KEY)` and reads fields from `data.payload`. If you don't have a callback endpoint, use the polling route instead — it reaches the same final report.

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `/health` shows `demo_mode: true` when you expected live | `DEMO_MODE` unset or `true` | Set `DEMO_MODE=false` in `.env` and restart. |
| `400` on submit with "invalid E.164 number" | A number doesn't start with `+` or is too short | Normalize to E.164 (`+1555...`). |
| `502 {"error": "upstream contract error"}` | The `202` body was missing a count field | Check the API response shape; the sample refuses to store a malformed ID. |
| Webhook returns `400 {"error": "invalid signature"}` | `TELNYX_PUBLIC_KEY` missing or wrong | Set the correct public key; check the raw body isn't being re-encoded by a proxy. |
| `404` on `GET /remediation/<id>` | Request not found, or not owned by your enterprise | Confirm `TELNYX_ENTERPRISE_ID` matches the enterprise that submitted it. |
| Poll never reaches terminal | Long-running tier-2 review | Increase `max_polls` or wait — tier-2 can take a while; check `tier1_completed_at`. |

---

## 9. Next steps

- **Remediation guide** — the full flow, bucket semantics, and review guidance: https://developers.telnyx.com/docs/number-reputation/remediation
- **Number Reputation overview** — what the product does and why: https://developers.telnyx.com/docs/number-reputation/overview
- **Query reputation scores** — the read side in depth: https://developers.telnyx.com/docs/number-reputation/phone-numbers
- **Quickstart** — get a first reputation read in minutes: https://developers.telnyx.com/docs/number-reputation/quickstart
- **Submit phone numbers for reputation remediation** (API ref): https://developers.telnyx.com/api-reference/reputation/submit-phone-numbers-for-reputation-remediation
- **Get a reputation remediation request** (API ref): https://developers.telnyx.com/api-reference/reputation/get-a-reputation-remediation-request
- **List reputation remediation requests** (API ref): https://developers.telnyx.com/api-reference/reputation/list-reputation-remediation-requests-for-an-enterprise
- **Number Reputation pricing**: https://developers.telnyx.com/docs/number-reputation/pricing

For the complementary operational half — monitoring reputation and auto-rotating flagged numbers out — see the reputation monitor sample (DEV-216). This sample is the remediation workflow; that one is the rotation workflow. Together they cover both responses to a flag.
=== END FILE ===
