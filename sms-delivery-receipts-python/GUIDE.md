# Track SMS Delivery Receipts with Telnyx and Flask

Build a Flask service that sends SMS through Telnyx, then listens for the asynchronous `message.finalized` webhook to record whether each message was delivered or failed. Delivery receipts are stored in SQLite and queryable over HTTP.

## How It Works

```
  POST /sms/send  ──►  Telnyx  ──►  carrier  ──►  handset
        │                                            │
        │ store row (queued)                         │ delivery result
        ▼                                            ▼
     SQLite  ◄────  POST /webhooks/message (message.finalized, signed)
```

When you send a message, Telnyx returns immediately with a `message_id` and a `queued` status. Delivery happens asynchronously; minutes later Telnyx calls your webhook with the final outcome. This example stitches those two moments together.

## Telnyx Products Used

- **Messaging** — send SMS and receive delivery-status webhooks with carrier error codes.

## API Endpoints

- **Send Message**: `POST /v2/messages` -- [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- **Delivery webhook**: `message.finalized` -- [Webhook reference](https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks)

## Prerequisites

- Python 3.8+ (3.12+ recommended).
- A [Telnyx account](https://portal.telnyx.com/sign-up) with a funded balance.
- An [API key](https://portal.telnyx.com/api-keys) and the matching **public key** (same page) for webhook signature verification.
- A [phone number](https://portal.telnyx.com/numbers/my-numbers) with messaging enabled.
- A [Messaging Profile](https://portal.telnyx.com/messaging/profiles) where you can set a webhook URL.
- [ngrok](https://ngrok.com) (or similar) to expose your local server to Telnyx.

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-delivery-receipts-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env`:

```
TELNYX_API_KEY=KEY...
TELNYX_PUBLIC_KEY=...
TELNYX_PHONE_NUMBER=+15551234567
FLASK_DEBUG=false
```

`TELNYX_PUBLIC_KEY` is on the same [API Keys](https://portal.telnyx.com/api-keys) page as your secret key and is what the SDK uses to verify that incoming webhooks really came from Telnyx.

## Step 2: Understand the Code

Everything lives in `app.py`.

### Client and database

```python
client = telnyx.Telnyx(
    api_key=os.getenv("TELNYX_API_KEY"),
    public_key=os.getenv("TELNYX_PUBLIC_KEY"),
)
```

Passing `public_key` enables `client.webhooks.unwrap()` to verify signatures. `init_db()` runs on startup and creates two SQLite tables: `messages` (one row per outbound send) and `delivery_receipts` (one row per finalized event, with a `UNIQUE` constraint on `message_id` for idempotency).

### Sending and tracking

`send_sms_with_tracking()` validates the destination is E.164, calls `client.messages.create(...)`, then inserts a row with `status="queued"`. The endpoint `POST /sms/send` wraps it with typed Telnyx error handling (auth, rate limit, connection, API status).

### Verifying and processing the webhook

The webhook handler verifies the signature **before** reading the body:

```python
@app.route("/webhooks/message", methods=["POST"])
def handle_message_webhook():
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
    except Exception:
        return jsonify({"error": "invalid signature"}), 401

    payload = request.get_json(silent=True)
    data = payload.get("data", {})
    event_type = data.get("event_type")          # event_type stays at the data level
    event_payload = data.get("payload", {})      # event fields live under data.payload
```

Only `message.finalized` events are processed. The handler pulls the carrier `status`, `error_code`, and `error_message` from `payload.to[0]`, updates the message row, and inserts a delivery receipt. A duplicate `message_id` short-circuits to `{"status": "already_processed"}` so Telnyx retries are safe. Internal errors are logged server-side and answered with a generic message — exception text is never returned to the caller.

### Querying status

- `GET /messages/<message_id>` returns the message plus its receipt (once one exists).
- `GET /messages` lists messages newest-first with an optional `?status=` filter.

## Step 3: Run It

```bash
python app.py
```

The server creates `receipts.db` and starts on `http://localhost:5000`.

In a second terminal, expose it:

```bash
ngrok http 5000
```

Copy the HTTPS URL and set it in the [Telnyx Portal](https://portal.telnyx.com):

- **Messaging → Messaging Profiles** → your profile → **Webhook URL** → `https://<id>.ngrok.io/webhooks/message`

## Step 4: Test It

Send a message to your own phone:

```bash
curl -X POST http://localhost:5000/sms/send \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125551234", "message": "Delivery receipt test"}'
```

You get back a `message_id` with `status: queued`. Within a minute or two, Telnyx posts a signed `message.finalized` event to `/webhooks/message`. Then query the message:

```bash
curl http://localhost:5000/messages/<message_id>
```

The `status` should now be `delivered` (or `failed`, with an `error_code`), and a `delivery_receipt` object will be present.

> Sending a raw `curl` to `/webhooks/message` yourself returns `401 invalid signature` — only genuinely signed Telnyx requests are accepted. To exercise the handler without Telnyx, temporarily relax verification in a local branch; never disable it in production.

## Going to Production

- **Database** — swap SQLite for PostgreSQL or MySQL; SQLite serializes writes and will hit `database is locked` under load.
- **Signature verification** — keep it always on. It is the only thing standing between your status table and a forged webhook.
- **Monitoring** — the app logs failures via the standard `logging` module; ship those logs and alert on `5xx` rates.
- **Retries** — Telnyx retries non-`2xx` webhook responses, so always return `200` once you have durably stored (or safely ignored) the event.

## Resources

- [Source code and route reference](./README.md)
- [Typed API reference](./API.md)
- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Receiving Webhooks](https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx Portal](https://portal.telnyx.com)
