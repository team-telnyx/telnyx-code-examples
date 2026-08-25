# Multi-Tenant Voice Platform — Developer Guide

This guide walks through the `multi-tenant-voice-platform` code sample, explaining how it implements multi-tenancy for a voice platform using Telnyx. You'll learn how the app isolates tenants, enforces per-tenant rate limits, stores per-tenant configuration, and tracks call state — all in a single deployment.

## Prerequisites

Before you begin, make sure you have:

- **Python 3.9+** installed
- A **Telnyx account** with:
  - An API key (v2)
  - At least one Connection (with Call Control enabled)
  - A phone number assigned to that connection
- **ngrok** (or similar) for exposing your local server to receive webhooks

---

## How the Sample Works

The sample is a Flask application that exposes REST endpoints for initiating and managing voice calls. It's designed to serve multiple tenants (e.g., different customers or departments) from a single deployment.

The core idea: every request includes an `X-Tenant-ID` header. The app uses that header to:

1. **Look up tenant configuration** (simulating a SQL database)
2. **Enforce per-tenant rate limits** (simulating a KV store)
3. **Track per-tenant call state** (simulating a StatefulActor)

Let's walk through each piece.

---

## 1. Configuration and Tenant Setup

The app starts by loading environment variables and configuring the Telnyx SDK:

```python
load_dotenv()
telnyx.api_key = os.getenv("TELNYX_API_KEY")
```

### Tenant Configuration (Simulated SQL DB)

The `TENANT_CONFIG` dictionary simulates a SQL database. Each tenant has:

- `name` — human-readable tenant name
- `rate_limit_per_minute` — max calls per minute
- `default_voice_profile_id` — the Telnyx voice profile used for outbound calls
- `webhook_url` — where Telnyx sends call events for this tenant

```python
TENANT_CONFIG = {
    "tenant_a": {
        "name": "Tenant A",
        "rate_limit_per_minute": 10,
        "default_voice_profile_id": os.getenv("TENANT_A_VOICE_PROFILE_ID", ""),
        "webhook_url": os.getenv("TENANT_A_WEBHOOK_URL", ""),
    },
    "tenant_b": {
        "name": "Tenant B",
        "rate_limit_per_minute": 5,
        "default_voice_profile_id": os.getenv("TENANT_B_VOICE_PROFILE_ID", ""),
        "webhook_url": os.getenv("TENANT_B_WEBHOOK_URL", ""),
    },
}
```

> **In production**, replace this with a real SQL database (e.g., Postgres). The structure maps directly: each row is a tenant, and each column is a config field.

---

## 2. Per-Tenant Rate Limiting (Simulated KV Store)

The sample implements a **sliding window rate limiter** per tenant. It uses:

- `RATE_LIMIT_STORE` — a `defaultdict` keyed by tenant ID, storing the window start time and request count
- `RATE_LIMIT_LOCK` — a threading lock to prevent race conditions

### The Rate Limit Check

The `check_rate_limit` function:

1. Looks up the tenant's rate limit from `TENANT_CONFIG`
2. Resets the window if 60 seconds have passed
3. Returns `(allowed, retry_after)` — whether the request is allowed, and how many seconds to wait if not

```python
def check_rate_limit(tenant_id):
    if tenant_id not in TENANT_CONFIG:
        return False, 0

    limit = TENANT_CONFIG[tenant_id]["rate_limit_per_minute"]
    now = time.time()

    with RATE_LIMIT_LOCK:
        entry = RATE_LIMIT_STORE[tenant_id]

        if now - entry["rate_start"] >= 60:
            entry["rate_start"] = now
            entry["count"] = 0

        if entry["count"] >= limit:
            retry_after = int(60 - (now - entry["rate_start"]))
            return False, retry_after

        entry["count"] += 1
        return True, 0
```

### The Decorator

The `rate_limit_required` decorator wraps any route that should be rate limited. It:

1. Reads the `X-Tenant-ID` header
2. Returns a `400` if the header is missing
3. Calls `check_rate_limit`
4. Returns a `429` with a `Retry-After` header if the limit is exceeded

```python
def rate_limit_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        tenant_id = request.headers.get("X-Tenant-ID")
        if not tenant_id:
            return jsonify({"error": "Missing X-Tenant-ID header"}), 400

        allowed, retry_after = check_rate_limit(tenant_id)
        if not allowed:
            response = jsonify({"error": "Rate limit exceeded"})
            response.status_code = 429
            response.headers["Retry-After"] = str(retry_after)
            return response

        return f(*args, **kwargs)
    return decorated
```

> **In production**, use a real KV store like Redis with `INCR` and `EXPIRE` for atomic, distributed rate limiting.

---

## 3. Per-Tenant Call State (Simulated StatefulActor)

The sample tracks call state per tenant using:

- `CALL_STATE` — a `defaultdict` of dicts: `{tenant_id: {call_id: {state}}}`
- `CALL_STATE_LOCK` — a threading lock for safe concurrent access

When a call is initiated, the app stores:

```python
CALL_STATE[tenant_id][call.id] = {
    "status": "initiated",
    "to": to_number,
    "from": from_number,
    "created_at": datetime.now(timezone.utc).isoformat(),
}
```

When a webhook arrives, the app updates the call state:

```python
call["status"] = payload.get("call_status", call.get("status", "unknown"))
call["last_event"] = payload.get("call_leg_id", "")
call["last_event_type"] = event_type
call["updated_at"] = datetime.now(timezone.utc).isoformat()
```

> **In production**, use a durable store (e.g., Redis with TTL, or a database) so call state survives restarts. The `StatefulActor` pattern in the ticket maps to this — each call is an actor with its own state.

---

## 4. API Routes

### Health Check

`GET /health` — returns a simple status JSON.

### Tenant Management

- `GET /api/tenants` — lists all tenants (admin endpoint)
- `GET /api/tenants/<tenant_id>/config` — returns a specific tenant's config

### Call Management

- `POST /api/tenants/<tenant_id>/calls` — initiates a call (rate-limited)
- `GET /api/tenants/<tenant_id>/calls` — lists all calls for a tenant
- `GET /api/tenants/<tenant_id>/calls/<call_id>` — gets state for a specific call
- `POST /api/tenants/<tenant_id>/calls/<call_id>/hangup` — hangs up a call (rate-limited)

### Webhook Handler

`POST /webhooks/inbound` — receives Telnyx call events.

---

## 5. Initiating a Call

The `initiate_call` route:

1. Validates the tenant exists
2. Parses the JSON body (requires `to`, optional `from`)
3. Calls the Telnyx API to create the call:

```python
call = telnyx.Call.create(
    to=to_number,
    from_=from_number,
    connection_id=config["connection_id"],
    webhook_url=config["webhook_url"],
)
```

4. Stores the call state
5. Returns the call ID and status

### Telnyx Primitive: Call Control

The `telnyx.Call.create` method uses **Call Control** — Telnyx's API for programmatically managing calls. It returns a `call_control_id` that you use for subsequent commands (e.g., hangup, transfer, bridge).

---

## 6. Handling Webhooks

The `inbound_webhook` route:

1. **Verifies the signature** using the Telnyx SDK:

```python
event = telnyx.webhooks.unwrap(
    request.data,
    request.headers.get("Telnyx-Signature-Ed25519", ""),
    request.headers.get("Telnyx-Timestamp", ""),
)
```

2. Extracts the event type and payload
3. **Finds the tenant** by looking up the call ID in `CALL_STATE`
4. **Updates the call state** with the new status

### Telnyx Primitive: Webhooks

Telnyx sends webhooks for call events (e.g., `call.initiated`, `call.answered`, `call.hangup`). Each event includes:

- `call_control_id` — the call identifier
- `call_status` — the current status
- `call_leg_id` — the leg identifier

The sample uses these to keep call state in sync.

---

## 7. Hanging Up a Call

The `hangup_call` route:

1. Validates the tenant and call exist
2. Calls `telnyx.Call.hangup(call_id)`
3. Updates the call state to `hangup_requested`

---

## 8. Tenant Isolation

The sample enforces tenant isolation in three ways:

| Layer | Mechanism |
|-------|-----------|
| **Routing** | Every request must include `X-Tenant-ID`; the app validates it exists |
| **Rate limiting** | Each tenant has its own rate limit window |
| **Call state** | Call state is stored per tenant — tenant A can never see tenant B's calls |

---

## Environment Variables

Create a `.env` file in the project root:

```bash
TELNYX_API_KEY=your_telnyx_api_key_here
TENANT_A_VOICE_PROFILE_ID=your_voice_profile_id_a
TENANT_A_WEBHOOK_URL=https://your-ngrok-url.ngrok.io/webhooks/inbound
TENANT_B_VOICE_PROFILE_ID=your_voice_profile_id_b
TENANT_B_WEBHOOK_URL=https://your-ngrok-url.ngrok.io/webhooks/inbound
```

---

## Running the Sample

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Set up environment variables

Copy `.env.example` to `.env` and fill in your values.

### 3. Start ngrok

```bash
ngrok http 5000
```

Copy the ngrok HTTPS URL — you'll use it for the webhook URLs.

### 4. Run the app

```bash
python app.py
```

### 5. Test it

```bash
# Health check
curl http://localhost:5000/health

# List tenants
curl http://localhost:5000/api/tenants

# Initiate a call (as tenant_a)
curl -X POST http://localhost:5000/api/tenants/tenant_a/calls \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: tenant_a" \
  -d '{"to": "+15551234567"}'

# Check call state
curl http://localhost:5000/api/tenants/tenant_a/calls \
  -H "X-Tenant-ID: tenant_a"
```

---

## Next Steps

Now that you understand the sample, here are some ways to extend it:

- **Replace in-memory stores** with real infrastructure:
  - SQL database for tenant config
  - Redis for rate limiting and call state
- **Add more Telnyx features**:
  - [Call Control](https://developers.telnyx.com/docs/api/v2/call-control) — bridge, transfer, play audio
  - [Conference Calls](https://developers.telnyx.com/docs/voice/conference-calls) — for multi-party calls
  - [SMS](https://developers.telnyx.com/docs/api/v2/messaging) — for notifications
- **Add tenant authentication** — replace the `X-Tenant-ID` header with signed tokens (e.g., JWT)
- **Add a dashboard** — visualize call metrics per tenant

### Telnyx Documentation

- [Telnyx API Reference](https://developers.telnyx.com/docs/api/v2/overview)
- [Call Control API](https://developers.telnyx.com/docs/api/v2/call-control)
- [Webhook Signing](https://developers.telnyx.com/docs/voice/call-control/webhooks)
- [Voice API Overview](https://developers.telnyx.com/docs/voice/overview)

---

## Troubleshooting

| Issue | Likely Cause | Fix |
|-------|-------------|-----|
| `401` on webhook | Invalid signature | Ensure `TELNYX_API_KEY` is set and the webhook URL matches the one configured in Telnyx |
| `429` on calls | Rate limit exceeded | Wait for the `Retry-After` period or increase the tenant's `rate_limit_per_minute` |
| `502` on call initiation | Invalid voice profile or connection ID | Check `TENANT_A_VOICE_PROFILE_ID` and the connection ID in your Telnyx account |
| Calls not updating state | Webhook URL not reachable | Ensure ngrok is running and the webhook URL is correct |

---

This guide covered the architecture and flow of the multi-tenant voice platform sample. You now have a solid foundation to extend it into a production-ready multi-tenant voice service.
