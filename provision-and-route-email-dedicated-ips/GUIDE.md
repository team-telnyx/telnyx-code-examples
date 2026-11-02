# Provision and Route Email Dedicated IPs — Developer Guide

This guide walks through the `provision-and-route-email-dedicated-ips` sample step by step. By the end you'll understand how to programmatically purchase a dedicated sending IP, start its warm-up, group it into a default IP pool, and verify that mail is routed through that pool — all against the Telnyx REST API.

The sample is a small Flask app (`app.py`) that exposes the whole flow as a single orchestrated function, `run_provisioning_flow()`, callable either over HTTP (`POST /run`) or from the command line (`python app.py run`).

---

## 1. What you're building

Sending reputation is a resource you manage, not something you inherit from a shared pool. This sample isolates outbound traffic onto a dedicated IP and controls the warm-up lifecycle through the API instead of the portal.

The flow composes three Telnyx primitives:

| Primitive | What it is | Endpoint |
|---|---|---|
| **Dedicated IP** | The isolated sending address you own | `POST /email/dedicated_ips` |
| **IP Pool** | The routing group that decides which IP carries a message | `POST /email/ip_pools` |
| **Email Message** | The payload that gets routed through the pool | `POST /email_messages` |

The data flow is: **Client → Telnyx API (provisioning) → Telnyx API (routing config) → Telnyx API (delivery)**.

---

## 2. Prerequisites

- Python 3.9+
- A Telnyx account that is **verified / enterprise / legacy** — dedicated IP purchase returns `403` otherwise.
- A verified sending domain so `TELNYX_EMAIL_FROM` is valid.
- A mailbox you control for `TELNYX_EMAIL_TO`.
- A Telnyx API key with email permissions.

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

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `TELNYX_API_KEY` | live mode | — | Bearer token for all API calls |
| `DEMO_MODE` | no | `true` | When `true`, no billed purchase and no real email |
| `TELNYX_EMAIL_FROM` | live mode | — | Sender address on a verified Telnyx email domain |
| `TELNYX_EMAIL_TO` | live mode | — | Recipient mailbox you control |
| `WARMUP_TIMEOUT_SECONDS` | no | `300` | Max time to wait for the IP to become send-ready |
| `WARMUP_POLL_INTERVAL_SECONDS` | no | `10` | Interval between readiness polls |
| `PORT` | no | `5000` | Flask bind port |

The app loads these via `python-dotenv` at import time (`load_dotenv()` near the top of `app.py`). Credentials are never hardcoded.

---

## 4. Demo mode vs. live mode

This is the most important switch in the sample.

**Demo mode (`DEMO_MODE=true`, the default)** — `run_provisioning_flow()` short-circuits and returns a synthetic summary. It does **not** call the billed purchase endpoint and does **not** send a real email. This is safe to run repeatedly with no side effects and no charges.

**Live mode (`DEMO_MODE=false`)** — the full flow executes against the real API:

1. A dedicated IP is purchased (this starts a **$14/mo MRC billing side-effect** at purchase time).
2. Warm-up is started.
3. The script polls until the IP is send-ready.
4. A default pool is created and the IP is added.
5. A test email is sent and its UUID is printed.

To switch:

```bash
# demo (default)
python app.py run

# live
DEMO_MODE=false python app.py run
```

Because live mode allocates a real, billable resource, the sample documents how to release it when you're done:

```bash
curl -X DELETE https://api.telnyx.com/v2/email/dedicated_ips/<ip_id> \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

---

## 5. Walking through the code

### 5.1 Configuration and the raw-REST decision

Near the top of `app.py`, after `load_dotenv()`, the module reads its config and sets `telnyx.api_key` if present.

A key architectural note: the installed `telnyx` PyPI SDK (verified 4.189.0) has **no `dedicated_ips` and no `ip_pools` resources**. So those calls are made with `requests` against `https://api.telnyx.com/v2`. The email send uses the SDK (`client.email_messages.create`), which the spec allows. This is the "SDK-surface honesty" rule in action — a raw call that works beats a typed chain that raises `AttributeError`.

### 5.2 The HTTP helpers

Two small helpers wrap the raw calls:

- `_headers(idempotency_key=None)` builds the `Authorization: Bearer` header and optionally adds `Idempotency-Key`.
- `_post(path, payload, idempotency_key=None)` and `_get(path)` issue the request, raise `TelnyxApiError` on any status ≥ 400, and unwrap JSON safely via `_safe_json`.

`TelnyxApiError` carries the status code and body so callers can inspect specific failures (like the `422` we deliberately trigger later).

### 5.3 Purchasing the dedicated IP

`purchase_dedicated_ip()` calls `POST /email/dedicated_ips` with:

```json
{ "region": "ewr-nj1", "ip_version": "ipv4" }
```

**The `Idempotency-Key` header is mandatory here.** Without it the API returns `400` with code `10015` and nothing is allocated. The helper generates a fresh `uuid.uuid4()` per call.

On success the API returns `201` with `data.status == "provisioning"` and a populated `data.ip_address`. Two failure modes are worth knowing:

- **No stock for the selector** → `429` plus a waitlist payload. Surface it; do not retry in a loop.
- **Account not eligible** → `403`.

### 5.4 Starting warm-up

`start_warmup(ip_id)` posts to `/email/dedicated_ips/{id}/actions/start_warmup` with an empty body.

Warm-up only accepts IPs in `provisioning` status:

| Current status | Response |
|---|---|
| `provisioning` | `200` |
| `warming_up` / `active` / `released` | `422` |
| `suspended` | `409` (code `40901`) |

Note that `start_warmup` does **not** check DNS — that's why the next step exists.

### 5.5 Polling for send-readiness

`wait_for_send_ready(ip_id)` is the piece that prevents you from sending a message that will be silently held.

An IP only carries mail while `dns_confirmed_at` is set, and while every pool member is still `provisioning` the pool holds its mail. So the function polls `GET /email/dedicated_ips/{id}` every `WARMUP_POLL_INTERVAL_SECONDS` (default 10s) until **both** conditions hold:

- `data.status == "warming_up"`, and
- `data.provisioning.dns_status == "dns_confirmed"`.

It gives up after `WARMUP_TIMEOUT_SECONDS` (default 300) by raising `TimeoutError`. The caller translates that into the message *"IP not send-ready; mail may be held by the pool"* and exits non-zero — it never sends a guaranteed-held message.

### 5.6 Creating the default pool

`create_default_pool(name)` posts to `/email/ip_pools` with `{"name": ..., "is_default": true}` and returns `201`.

Pool name rules: 1–64 chars, lowercase letters/digits/`.`/`_`/`-`, must be unique, and must not start with `dip_`. The sample generates a name like `dip-pool-<8 hex chars>`.

An account can have **at most one default pool**. If one already exists, the API surfaces an error — the sample lets that propagate clearly rather than swallowing it.

### 5.7 Adding the IP to the pool

`add_ip_to_pool(pool_id, ip_id)` posts `{"dedicated_ip_id": "<uuid>"}` to `/email/ip_pools/{id}/ips` and returns `201`. This is the routing configuration step: from here, mail sent through the default pool is carried by this IP.

### 5.8 Demonstrating the 422 case

The spec's acceptance criteria require demonstrating that calling `start_warmup` on a non-`provisioning` IP returns `422`. In live mode, `run_provisioning_flow()` calls `start_warmup(ip_id)` a **second time** on the now-`warming_up` IP and captures the `TelnyxApiError`. The status and body are recorded under `warmup_422_demo` in the result. No extra resource is needed — the IP we already own is the fixture.

### 5.9 Sending the verification email

`send_test_email()` uses the SDK:

```python
client.email_messages.create(
    from_=EMAIL_FROM,
    to=EMAIL_TO,
    subject="Dedicated IP routing verification",
    text="This message verifies routing through the dedicated IP pool.",
)
```

Only `from` and `to` are required; `subject` is required when no template is used. A successful send returns `202` with `data.status == "queued"` and a non-empty `data.id`.

**The successful `202` through the default pool *is* the routing verification.** The script prints the message UUID so you can optionally follow up with `GET /email_messages/{id}` — that follow-up is not required.

### 5.10 Orchestration

`run_provisioning_flow()` ties it together and returns a JSON-serializable summary. In demo mode it returns the synthetic summary described in §4. In live mode it runs the real sequence and records each step's result under keys like `dedicated_ip`, `warmup`, `pool`, `pool_membership`, `warmup_422_demo`, and `email`.

### 5.11 The Flask surface

- `GET /health` → `{"status": "ok", "demo_mode": <bool>}`.
- `POST /run` → runs the flow and returns the summary.

Error mapping in the `/run` handler:

| Exception | HTTP status | Body |
|---|---|---|
| `TimeoutError` | `504` | `{"error": "IP not send-ready; mail may be held by the pool"}` |
| `TelnyxApiError` | `502` | `{"error": "Telnyx API request failed", "status": <code>}` |
| anything else | `500` | `{"error": "Internal server error"}` |

Exceptions are logged with `app.logger.exception(...)`; the response bodies stay generic so nothing sensitive leaks.

---

## 6. Running the sample

**CLI (recommended for a one-shot run):**

```bash
python app.py run
```

**HTTP server:**

```bash
python app.py
# then, in another shell:
curl -X POST http://localhost:5000/run
curl http://localhost:5000/health
```

**Smoke test** (verifies the module loads and routes are registered — no API calls):

```bash
python smoke_test.py
```

---

## 7. Reading the output

A live-mode run prints a JSON summary. The fields that matter for the acceptance criteria:

- `dedicated_ip.status == "provisioning"` and a valid `dedicated_ip.ip_address` — the `201` from purchase.
- `pool.is_default == true` — the `201` from pool creation.
- `pool_membership.added == true` — the `201` from adding the IP.
- `warmup_422_demo.status == 422` — the deliberate second warm-up call.
- `email.status == "queued"` and a non-empty `email.id` — the `202` from the send.

If you see `"IP not send-ready; mail may be held by the pool"`, the poll timed out. Increase `WARMUP_TIMEOUT_SECONDS` or check the IP's DNS status with `GET /email/dedicated_ips/{id}`.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `400` code `10015` on purchase | Missing `Idempotency-Key` | The sample always sends one; if you're calling manually, add the header |
| `429` on purchase | No stock for the region/version selector | Surface the waitlist; don't retry in a loop |
| `403` on purchase | Account not verified/enterprise/legacy | Contact Telnyx to upgrade eligibility |
| `422` on first `start_warmup` | IP not in `provisioning` | Check `GET /email/dedicated_ips/{id}` status |
| `409` code `40901` on `start_warmup` | IP is `suspended` | Resolve the suspension before warming up |
| Default-pool error on create | Account already has a default pool | Reuse or remove the existing default |
| `504` from `/run` | Warm-up poll timed out | Raise `WARMUP_TIMEOUT_SECONDS`; verify DNS |

---

## 9. Next steps

- [Email Dedicated IPs overview](https://developers.telnyx.com/docs/messaging/email/dedicated-ips)
- [Purchase a Dedicated IP](https://developers.telnyx.com/api-reference/dedicated-ips/purchase-a-dedicated-ip)
- [Create an IP Pool](https://developers.telnyx.com/api-reference/ip-pools/create-an-ip-pool)
- [Send an Email Message](https://developers.telnyx.com/api-reference/email/send-an-email)
- Explore the sibling samples in this repo for messaging, voice, and AI primitives that compose with email routing.
=== END FILE ===
