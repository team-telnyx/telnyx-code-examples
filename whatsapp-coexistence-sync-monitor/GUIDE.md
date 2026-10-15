# Guide: WhatsApp Coexistence Sync Monitor

This guide walks through the **WhatsApp Coexistence Sync Monitor** — a lightweight Flask service that monitors a coexistence-enabled WhatsApp number. It verifies the number's lifecycle state via the Telnyx API and listens for `message.echo` webhooks to log messages sent manually from the WhatsApp Business app, ensuring your application state stays in sync with the manual channel.

By the end of this guide, you'll understand:

- How coexistence works for WhatsApp numbers and why it matters
- How to verify a number's coexistence state via the Telnyx API
- How to receive and validate `message.echo` webhooks with Ed25519 signatures
- How to log manual-channel messages without triggering billing events

---

## Prerequisites

Before running this sample, you'll need:

1. **A Telnyx account** with a WhatsApp Business Account (WABA) connected.
2. **A WhatsApp number with coexistence enabled** — this means the number is actively used by a human agent in the WhatsApp Business app *and* is also connected to the Telnyx Cloud API.
3. **A Telnyx API key** — from the [Telnyx Portal](https://portal.telnyx.com) under *Keys & Credentials*.
4. **A Telnyx Public Key** (base64-encoded Ed25519) — also from *Keys & Credentials* in the Portal. This is used to verify webhook signatures.
5. **A webhook endpoint** — a publicly reachable URL (e.g., via `ngrok` for local development) that Telnyx can POST events to.
6. **Python 3.9+** and `pip` installed.

---

## How It Works

The service has three core components:

| Component | Responsibility |
|-----------|----------------|
| **Webhook Receiver** | Handles HTTP POST requests from Telnyx and validates the Ed25519 signature. |
| **State Checker** | Queries the Telnyx API to verify the number's coexistence status (`is_on_biz_app` and `coexistence_state`). |
| **Message Logger** | Persists the content of accepted `message.echo` events to an append-only JSONL file. |

### The Demo Flow

1. **Configure a webhook** to receive `message.echo` events and verify the signature using `telnyx-signature-ed25519`.
2. **Call `GET /v2/whatsapp/business_accounts/{waba_id}/phone_numbers`** to confirm the target number has `is_on_biz_app: true` and `coexistence_state: 'active'`.
3. **Send a message manually** from the WhatsApp Business app to the number.
4. **Observe the webhook payload** arriving with `event_type: 'message.echo'` and `origin: 'whatsapp_business_app'`, and log the message body.
5. **Verify that no billing event is triggered** for the echoed message by checking the `cost` field in the payload is `null`.

---

## Code Walkthrough

Let's walk through `app.py` section by section.

### 1. Configuration and SDK Setup

```python
# Load environment variables from .env if present
load_dotenv()

# Configuration
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
WABA_ID = os.getenv("WABA_ID", "")
WHATSAPP_NUMBER = os.getenv("WHATSAPP_NUMBER", "")  # e.g. +1555XXXXXXXX
ECHO_LOG_PATH = os.getenv("ECHO_LOG_PATH", "echo_log.jsonl")
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"
STATE_CHECK_TTL_SECONDS = int(os.getenv("STATE_CHECK_TTL_SECONDS", "60"))
MAX_TIMESTAMP_SKEW_SECONDS = int(os.getenv("MAX_TIMESTAMP_SKEW_SECONDS", "300"))

# Configure Telnyx SDK
telnyx.api_key = TELNYX_API_KEY
```

All configuration comes from environment variables — no hardcoded credentials. The `DEMO_MODE` flag defaults to `true`, meaning the app runs in a safe demo mode without making real API calls.

### 2. State Checker — Verifying Coexistence Status

The `StateChecker` class (defined near the top of `app.py`) is responsible for querying the Telnyx API to verify the number's coexistence state.

```python
class StateChecker:
    def _fetch_state(self) -> dict:
        # GET /v2/whatsapp/business_accounts/{waba_id}/phone_numbers
        response = telnyx.WhatsappBusinessAccount.phone_numbers(self.waba_id)
        # ... find the target number and return its state
```

Key behaviors:

- **Startup check**: When the app starts (in live mode), it calls `_startup_state_check()` which fails fast with a clear error if the number is missing or not on the biz app.
- **TTL cache**: The `get_state()` method caches the API response for 60 seconds (configurable via `STATE_CHECK_TTL_SECONDS`), so bursts of webhooks don't hammer the API.
- **Active check**: `is_active()` returns `True` only when `is_on_biz_app` is `true` **and** `coexistence_state` is exactly `"active"`. Any other state (e.g., `sync_pending`, `syncing`, `offboarded`) means the number is not ready for Cloud API sends.

> **Why only `active`?** The Telnyx coexistence states are: `active`, `sync_pending`, `syncing`, `sync_complete`, `pending_onboarding`, `history_declined`, `sync_deadline_expired`, `offboarded`, `disconnected`, or `null`. Only `active` allows Cloud API sends — so we treat everything else as "not active."

### 3. Message Logger — Append-Only JSONL Persistence

The `MessageLogger` class is a simple append-only JSONL file writer:

```python
class MessageLogger:
    def append(self, event: dict) -> None:
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
```

Each accepted `message.echo` event is logged as one JSON line, including:

- ISO timestamp
- Event ID
- `origin` and whether it matches `whatsapp_business_app` (`origin_matches_biz_app`)
- Message text
- Message ID
- `billing_confirmed` — `true` when `cost` is `null` / `{ "amount": null, "currency": null }`
  (no billing event for the manual-channel echo)

Raw phone numbers (`from`/`to`) and monetary amounts are intentionally **not** persisted —
only the boolean verdicts derived from them (PII minimization).

The log path defaults to `echo_log.jsonl` in the working directory and can be overridden with the `ECHO_LOG_PATH` env var.

### 4. Webhook Signature Verification (Ed25519)

The `verify_webhook_signature` function validates incoming webhooks using Telnyx's Ed25519 signature scheme:

```python
def verify_webhook_signature(headers: dict, raw_body: bytes) -> bool:
    signature = headers.get("telnyx-signature-ed25519")
    timestamp = headers.get("telnyx-timestamp")

    # Reject timestamps that skew too far from now (> 300s)
    if abs(time.time() - ts) > MAX_TIMESTAMP_SKEW_SECONDS:
        return False

    # Verify using the Telnyx SDK (kwarg is `key` in SDK >= 4.x)
    client.webhooks.unwrap(
        payload=raw_body.decode("utf-8"),
        headers={
            "telnyx-signature-ed25519": signature,
            "telnyx-timestamp": timestamp,
        },
        key=TELNYX_PUBLIC_KEY,
    )
```

This validates:

1. Both `telnyx-signature-ed25519` and `telnyx-timestamp` headers are present.
2. The timestamp is within 300 seconds of the current time (prevents replay attacks).
3. The signature is cryptographically valid over `<timestamp>|<raw body>` using the Telnyx public key.

If any check fails, the function returns `False` and the webhook handler returns **HTTP 401** without processing the message.

### 5. Webhook Handler — Processing `message.echo` Events

The main webhook route is `/webhooks/whatsapp/echo`:

```python
@app.route("/webhooks/whatsapp/echo", methods=["POST"])
def whatsapp_echo_webhook():
    raw_body = request.get_data()

    # 1. Verify signature
    if not verify_webhook_signature(request.headers, raw_body):
        return jsonify({"error": "Invalid signature"}), 401

    # 2. Parse payload
    payload = json.loads(raw_body)
    event_type = payload.get("event_type")
    if event_type != "message.echo":
        return jsonify({"status": "ignored"}), 200

    # 3. Check coexistence state
    if not state_checker.is_active():
        # Log warning, accept with 200, skip processing
        return jsonify({"ok": "skipped", "reason": "number_not_active"}), 200

    # 4. Log the message
    message_logger.append(log_entry)
    return jsonify({"ok": True}), 200
```

The handler follows this flow:

1. **Verify signature** — if invalid, return 401 and do NOT process.
2. **Parse payload** — if it's not a `message.echo` event, ignore it (return 200).
3. **Check coexistence state** — if the number is not `active`, accept with 200 but skip processing (log a warning). This is intentional: rejecting with 4xx would make Telnyx retry delivery, which is wrong for a manual-channel mirror we can't act on yet.
4. **Log the message** — append the event to the JSONL log.

### 6. Startup State Check

When the app starts (in live mode), it verifies the number is coexistence-enabled:

```python
def _startup_state_check() -> None:
    if DEMO_MODE:
        app.logger.info("DEMO_MODE: skipping startup state check")
        return

    state = state_checker.get_state()
    if not state.get("is_on_biz_app"):
        raise SystemExit(
            f"Phone number {WHATSAPP_NUMBER} is not on the WhatsApp Business app "
            f"(is_on_biz_app={state.get('is_on_biz_app')}). "
            "Enable coexistence for this number before running the sample."
        )
```

This fails fast with a clear error if the number isn't properly configured.

---

## Demo Mode vs. Live Mode

### Demo Mode (default)

When `DEMO_MODE=true` (the default), the app:

- **Skips the startup state check** — logs a message saying so.
- **Simulates the state check** — `_fetch_state()` returns a hardcoded `active` state for the configured number.
- **Still verifies webhook signatures** — you need `TELNYX_PUBLIC_KEY` set, but you can test with a fake signature to see the 401 path.

This lets you run the app locally and test the webhook flow without making real API calls.

### Live Mode

To run in live mode:

1. Set `DEMO_MODE=false`.
2. Set `TELNYX_API_KEY` to your real API key.
3. Set `WABA_ID` to your WhatsApp Business Account ID.
4. Set `WHATSAPP_NUMBER` to the coexistence-enabled number (e.g., `+15551234567`).

In live mode, the app will:

- Verify the number's coexistence state at startup (fails fast if not on the biz app).
- Re-verify the state before processing each webhook (with the 60-second TTL cache).

---

## Setup and Run

### 1. Clone and Install Dependencies

```bash
git clone <repo-url>
cd whatsapp-coexistence-sync-monitor
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|----------|-------------|---------|
| `TELNYX_API_KEY` | Your Telnyx API key (from Portal > Keys & Credentials) | *(empty)* |
| `TELNYX_PUBLIC_KEY` | Your Telnyx public key (base64 Ed25519, from Portal > Keys & Credentials) | *(empty)* |
| `WABA_ID` | Your WhatsApp Business Account ID | *(empty)* |
| `WHATSAPP_NUMBER` | The coexistence-enabled number (e.g., `+15551234567`) | *(empty)* |
| `DEMO_MODE` | Set to `true` for demo mode (no real API calls) | `true` |
| `ECHO_LOG_PATH` | Path to the JSONL log file | `echo_log.jsonl` |
| `STATE_CHECK_TTL_SECONDS` | TTL for the state check cache | `60` |
| `MAX_TIMESTAMP_SKEW_SECONDS` | Max allowed webhook timestamp skew | `300` |
| `PORT` | Port for the Flask server | `5000` |

### 3. Run the Server

```bash
python app.py
```

You should see:

```
 * Running on http://0.0.0.0:5000
```

### 4. Expose Your Webhook Endpoint

For Telnyx to reach your webhook, you need a public URL. Use `ngrok`:

```bash
ngrok http 5000
```

Copy the `https://...` URL and configure it as the webhook URL for your WhatsApp number in the Telnyx Portal (or via the API).

### 5. Test the Flow

**Demo mode:**

1. Send a POST request to `http://localhost:5000/webhooks/whatsapp/echo` with a fake `message.echo` payload (see below).
2. Check `echo_log.jsonl` for the logged message.

**Live mode:**

1. Send a message manually from the WhatsApp Business app to your number.
2. Telnyx will POST a `message.echo` webhook to your endpoint.
3. Check the logs and `echo_log.jsonl`.

### Sample Webhook Payload

```json
{
  "event_type": "message.echo",
  "data": {
    "id": "event-123",
    "origin": "whatsapp_business_app",
    "payload": {
      "id": "msg-456",
      "from": "+15551234567",
      "to": "+15559876543",
      "text": "Hello from the WhatsApp Business app!",
      "cost": null
    }
  }
}
```

---

## Running the Smoke Test

A `smoke_test.py` is included to verify the app loads and the routes are registered:

```bash
python smoke_test.py
```

This test:

- Imports the Flask app.
- Verifies the `/health` and `/webhooks/whatsapp/echo` routes exist.
- Confirms the module loads without error.

---

## Next Steps

Now that you understand how the WhatsApp Coexistence Sync Monitor works, here are some ways to extend it:

- **Add a database** — replace the JSONL file with a real database (e.g., PostgreSQL) for production-scale audit trails.
- **Add a dashboard** — build a simple web UI to visualize the echoed messages.
- **Sync state with your CRM** — when a `message.echo` arrives, update your CRM with the manual-channel conversation.
- **Handle other event types** — extend the webhook handler to process `message.received` or `message.sent` events.
- **Add alerting** — notify your team when a number's coexistence state changes (e.g., via Slack webhook).

### Related Documentation

- [WhatsApp Coexistence Overview](https://developers.telnyx.com/docs/messaging/whatsapp/coexistence)
- [WhatsApp Business App Message Echo Webhook](https://developers.telnyx.com/api-reference/callbacks/whatsapp-business-app-message-echo)
- [Telnyx WhatsApp Phone Numbers API](https://developers.telnyx.com/api-reference/whatsapp-phone-numbers)
- [Telnyx Webhook Security](https://developers.telnyx.com/docs/webhooks/security)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
