# API Reference — Provision and Route Email Dedicated IPs

Typed contract for the Flask service in `app.py` and the Telnyx REST endpoints it drives.

- **Base URL (local):** `http://localhost:5000`
- **Base URL (Telnyx):** `https://api.telnyx.com/v2`
- **Content type:** `application/json`
- **Auth (Telnyx):** `Authorization: Bearer <TELNYX_API_KEY>`

---

## Local Service Routes

### `GET /health`

Liveness probe. Reports whether the process is running and which mode it is in.

**Request body:** none.

**Example request**

```bash
curl -s http://localhost:5000/health
```

**Response schema — `200 OK`**

| Field | Type | Description |
| --- | --- | --- |
| `status` | string | Always `"ok"` when the process is up. |
| `demo_mode` | boolean | `true` when `DEMO_MODE=true` (no billed calls, no real email). |

**Example response**

```json
{
  "status": "ok",
  "demo_mode": true
}
```

**Status codes**

| Status | Meaning |
| --- | --- |
| `200` | Service is up. |

---

### `POST /run`

Executes the full provisioning flow: preflight the email setup → purchase (or reuse) the dedicated IP → start warm-up → poll for send-readiness → reuse-or-create the default IP pool → add IP to pool → demonstrate the `422` warm-up case → send the verification email.

In **live mode** the flow validates that `TELNYX_EMAIL_FROM` is on a verified sending domain **before** the billed purchase (the purchase starts a $14/month MRC and cannot be undone). If `REUSE_DEDICATED_IP_ID` is set, that IP is resumed instead of purchasing a new one, and the account's existing default pool is reused when present.

In **demo mode** (`DEMO_MODE=true`, the default) no Telnyx API calls are made and no email is sent; the response is a simulated summary of the same shape.

**Request body:** none. All configuration comes from environment variables.

**Example request**

```bash
curl -s -X POST http://localhost:5000/run
```

**Response schema — `200 OK`**

| Field | Type | Description |
| --- | --- | --- |
| `demo_mode` | boolean | Whether the run was simulated. |
| `preflight` | array | Live mode only: non-fatal setup warnings (absent in demo mode). |
| `dedicated_ip` | object | The purchased (or reused) IP record (`id`, `ip_address`, `status`, `region`, `ip_version`). |
| `reused_ip` | boolean | Live mode only: `true` when `REUSE_DEDICATED_IP_ID` resumed an existing IP. |
| `warmup` | object | `status` (`"warming_up"`) and `dns_status` (`"dns_confirmed"`) observed after polling. |
| `pool` | object | The created pool (`id`, `name`, `is_default`). |
| `pool_membership` | object | `dedicated_ip_id`, `pool_id`, `added`. |
| `warmup_422_demo` | object | Result of the second `start_warmup` call: `status` (`422` in live mode) plus the error `body`. |
| `email` | object | The queued message (`id`, `status`). |

**Example response (demo mode)**

```json
{
  "demo_mode": true,
  "dedicated_ip": {
    "id": "demo-ip-uuid",
    "ip_address": "203.0.113.10",
    "status": "provisioning",
    "region": "ewr-nj1",
    "ip_version": "ipv4"
  },
  "warmup": { "status": "warming_up", "dns_status": "dns_confirmed" },
  "pool": { "id": "demo-pool-uuid", "name": "demo-default-pool", "is_default": true },
  "pool_membership": { "dedicated_ip_id": "demo-ip-uuid", "added": true },
  "warmup_422_demo": {
    "status": 422,
    "note": "Second start_warmup on a warming_up IP returns 422 (demonstrated in live mode)."
  },
  "email": {
    "id": "demo-message-uuid",
    "status": "queued",
    "note": "Demo mode: no real email sent."
  }
}
```

**Example response (live mode, abbreviated)**

```json
{
  "demo_mode": false,
  "preflight": [],
  "dedicated_ip": {
    "id": "3f1c9a2e-...-b7d4",
    "ip_address": "198.51.100.24",
    "status": "provisioning",
    "region": "ewr-nj1",
    "ip_version": "ipv4"
  },
  "warmup": { "status": "warming_up", "dns_status": "dns_confirmed" },
  "pool": { "id": "9a7e...", "name": "dip-pool-4c1f8a02", "is_default": true },
  "pool_membership": { "dedicated_ip_id": "3f1c9a2e-...-b7d4", "pool_id": "9a7e...", "added": true },
  "warmup_422_demo": {
    "status": 422,
    "body": { "errors": [ { "code": "10007", "detail": "IP is not in provisioning state" } ] }
  },
  "email": { "id": "msg_01H...", "status": "queued" }
}
```

**Status codes**

| Status | Meaning |
| --- | --- |
| `200` | Flow completed; email queued (live) or simulated (demo). |
| `400` | Live-mode preflight blocker: `TELNYX_EMAIL_FROM` is not a verified sending domain for the account. The check runs before the billed purchase; the response body carries the setup instructions. |
| `500` | Unexpected internal error, or a missing required env var. Body: `{"error": "Internal server error"}`. |
| `502` | A Telnyx REST call returned a non-success status. Body: `{"error": "Telnyx API request failed", "status": <upstream_status>}`. |
| `504` | Warm-up polling timed out before the IP became send-ready. Body: `{"error": "IP not send-ready; mail may be held by the pool"}`. Re-run with `REUSE_DEDICATED_IP_ID` to resume the same IP without a second purchase. |

---

## Telnyx REST Endpoints Used

All calls below are made by `app.py` against `https://api.telnyx.com/v2`. The `dedicated_ips` and `ip_pools` resources are called with `requests` because the installed `telnyx` SDK (4.189.0) does not expose typed resources for them. The email send uses the SDK (`client.email_messages.create`).

---

### `POST /email/dedicated_ips`

Purchase a dedicated sending IP. **Requires an `Idempotency-Key` header** — without it the API returns `400` with code `10015` and nothing is allocated.

**Headers**

| Header | Type | Required | Description |
| --- | --- | --- | --- |
| `Authorization` | string | yes | `Bearer <TELNYX_API_KEY>`. |
| `Content-Type` | string | yes | `application/json`. |
| `Idempotency-Key` | string | yes | UUID generated per purchase attempt. Prevents duplicate billed allocations on retry. |

**Request body**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `region` | string | yes | Datacenter region. This sample uses `"ewr-nj1"`. |
| `ip_version` | string | yes | IP version to allocate. This sample uses `"ipv4"`. |

**Example request**

```bash
curl -s -X POST https://api.telnyx.com/v2/email/dedicated_ips \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"region": "ewr-nj1", "ip_version": "ipv4"}'
```

**Response schema — `201 Created`**

| Field | Type | Description |
| --- | --- | --- |
| `data.id` | string (uuid) | Dedicated IP identifier, used in all subsequent calls. |
| `data.ip_address` | string | The allocated sending address. |
| `data.status` | string | `"provisioning"` immediately after purchase. |
| `data.region` | string | Region the IP was allocated in. |
| `data.ip_version` | string | `"ipv4"`. |

**Example response**

```json
{
  "data": {
    "id": "3f1c9a2e-...-b7d4",
    "ip_address": "198.51.100.24",
    "status": "provisioning",
    "region": "ewr-nj1",
    "ip_version": "ipv4"
  }
}
```

**Status codes**

| Status | Meaning |
| --- | --- |
| `201` | IP allocated; `data.status == "provisioning"`. |
| `400` | Missing/invalid `Idempotency-Key` (code `10015`) or malformed body. |
| `403` | Account is not verified / enterprise / legacy — dedicated IPs unavailable. |
| `429` | No stock for the requested selectors; response includes waitlist info. Surface it — do not retry. |

> **Billing note:** purchasing a dedicated IP starts a **$14/mo MRC** at the moment of the call. `DEMO_MODE=true` (the default) skips this call entirely.

---

### `POST /email/dedicated_ips/{id}/actions/start_warmup`

Begin the warm-up lifecycle for a dedicated IP. Only IPs in `provisioning` status succeed.

**Path parameters**

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string (uuid) | yes | The dedicated IP id returned by the purchase call. |

**Request body:** none (empty JSON object).

**Example request**

```bash
curl -s -X POST \
  https://api.telnyx.com/v2/email/dedicated_ips/3f1c9a2e-...-b7d4/actions/start_warmup \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response schema — `200 OK`**

| Field | Type | Description |
| --- | --- | --- |
| `data.id` | string (uuid) | The dedicated IP id. |
| `data.status` | string | `"warming_up"` after a successful start. |

**Status codes**

| Status | Meaning |
| --- | --- |
| `200` | Warm-up started (IP was `provisioning`). |
| `409` | IP is `suspended` (code `40901`). |
| `422` | IP is not in `provisioning` state (`warming_up`, `active`, or `released`). This is the case the sample deliberately demonstrates with a second call. |

> Warm-up start does **not** check DNS. Send-readiness is determined separately by polling `GET /email/dedicated_ips/{id}`.

---

### `GET /email/dedicated_ips/{id}`

Read the current state of a dedicated IP. Used by the polling loop to determine send-readiness.

**Path parameters**

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string (uuid) | yes | The dedicated IP id. |

**Example request**

```bash
curl -s https://api.telnyx.com/v2/email/dedicated_ips/3f1c9a2e-...-b7d4 \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

**Response schema — `200 OK`**

| Field | Type | Description |
| --- | --- | --- |
| `data.id` | string (uuid) | The dedicated IP id. |
| `data.status` | string | One of `provisioning`, `warming_up`, `active`, `suspended`, `released`. |
| `data.provisioning.dns_status` | string | DNS verification state; `"dns_confirmed"` means the IP can carry mail. |

**Send-ready predicate:** `data.status == "warming_up"` **and** `data.provisioning.dns_status == "dns_confirmed"`.

**Status codes**

| Status | Meaning |
| --- | --- |
| `200` | IP record returned. |
| `404` | No dedicated IP with that id. |

---

### `POST /email/ip_pools`

Create an IP pool. Setting `is_default: true` makes it the account's default routing pool.

**Request body**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | yes | 1–64 chars; lowercase letters, digits, `.`, `_`, `-`; must be unique; must not start with `dip_`. |
| `is_default` | boolean | no | When `true`, this pool becomes the account default. An account may have at most one default pool. |

**Example request**

```bash
curl -s -X POST https://api.telnyx.com/v2/email/ip_pools \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "dip-pool-4c1f8a02", "is_default": true}'
```

**Response schema — `201 Created`**

| Field | Type | Description |
| --- | --- | --- |
| `data.id` | string (uuid) | Pool identifier, used when adding IPs. |
| `data.name` | string | The pool name. |
| `data.is_default` | boolean | `true` when the pool is the account default. |

**Example response**

```json
{
  "data": {
    "id": "9a7e...",
    "name": "dip-pool-4c1f8a02",
    "is_default": true
  }
}
```

**Status codes**

| Status | Meaning |
| --- | --- |
| `201` | Pool created. |
| `400` | Invalid `name` (length, charset, or `dip_` prefix). |
| `409` | A default pool already exists for the account. |

---

### `POST /email/ip_pools/{id}/ips`

Add a dedicated IP to a pool. While every member of a pool is still `provisioning`, the pool holds its mail.

**Path parameters**

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string (uuid) | yes | The pool id returned by the create call. |

**Request body**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `dedicated_ip_id` | string (uuid) | yes | The dedicated IP to add to the pool. |

**Example request**

```bash
curl -s -X POST https://api.telnyx.com/v2/email/ip_pools/9a7e.../ips \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dedicated_ip_id": "3f1c9a2e-...-b7d4"}'
```

**Response schema — `201 Created`**

| Field | Type | Description |
| --- | --- | --- |
| `data.dedicated_ip_id` | string (uuid) | The IP now associated with the pool. |
| `data.pool_id` | string (uuid) | The pool the IP was added to. |

**Status codes**

| Status | Meaning |
| --- | --- |
| `201` | IP added to the pool. |
| `404` | Pool or dedicated IP not found. |
| `409` | IP is already a member of the pool. |

---

### `POST /email_messages`

Send the verification email. In this sample the call is made through the SDK (`client.email_messages.create`), which issues the same HTTP request.

**Request body**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `from` | string | yes | Sender address; must be on a verified Telnyx email domain (`TELNYX_EMAIL_FROM`). |
| `to` | string | yes | Recipient mailbox the operator controls (`TELNYX_EMAIL_TO`). |
| `subject` | string | yes | Required when no template is supplied. This sample uses `"Dedicated IP routing verification"`. |
| `text` | string | no | Plain-text body. |

**Example request**

```bash
curl -s -X POST https://api.telnyx.com/v2/email_messages \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "sender@your-verified-domain.example",
    "to": "you@your-mailbox.example",
    "subject": "Dedicated IP routing verification",
    "text": "This message verifies routing through the dedicated IP pool."
  }'
```

**Response schema — `202 Accepted`**

| Field | Type | Description |
| --- | --- | --- |
| `data.id` | string | Message UUID. Non-empty on success; printed by the sample. |
| `data.status` | string | `"queued"` on acceptance. |

**Example response**

```json
{
  "data": {
    "id": "msg_01H...",
    "status": "queued"
  }
}
```

**Status codes**

| Status | Meaning |
| --- | --- |
| `202` | Message accepted and queued. This is the routing verification. |
| `400` | Missing required field or invalid sender domain. |
| `403` | Sender domain not verified. |

> An optional follow-up `GET /email_messages/{id}` can be used to inspect delivery status. It is not required by this sample.

---

### `DELETE /email/dedicated_ips/{id}` (release)

Release a dedicated IP and stop its monthly charge. Documented here for cleanup; the sample does not call it automatically.

**Path parameters**

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string (uuid) | yes | The dedicated IP id to release. |

**Example request**

```bash
curl -s -X DELETE https://api.telnyx.com/v2/email/dedicated_ips/3f1c9a2e-...-b7d4 \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

**Status codes**

| Status | Meaning |
| --- | --- |
| `200` | IP released. |
| `404` | No dedicated IP with that id. |

---

## Error Envelope

All Telnyx REST errors are surfaced by `app.py` as a `TelnyxApiError` carrying the upstream status and body. The upstream body follows the standard Telnyx error shape:

```json
{
  "errors": [
    {
      "code": "10015",
      "detail": "Idempotency-Key header is required",
      "title": "Bad Request"
    }
  ]
}
```

When a Telnyx call fails, the local `POST /run` route responds with `502` and a generic message; the upstream status is included in the `status` field. Full upstream bodies are logged server-side via `app.logger.exception(...)` and are never returned to the caller.
