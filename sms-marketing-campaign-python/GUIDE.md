# Build an SMS Marketing Campaign Sender with Telnyx

Run bulk SMS marketing campaigns with Flask and the Telnyx Messaging API — create campaigns, send rate-limited batches, and track delivery via signed webhooks.

## How It Works

```
  POST /campaigns            POST /campaigns/{id}/send
        │                              │
        ▼                              ▼
  ┌──────────────┐            ┌─────────────────────┐
  │ campaigns DB  │            │ rate-limited batch   │──► POST /v2/messages ──► Telnyx
  │ (SQLite)      │◄───────────│ loop (RATE_LIMIT)    │
  └──────────────┘            └─────────────────────┘
        ▲                                                     │
        │                                                     ▼
        │                              Telnyx delivery receipt (Ed25519-signed)
        │                                                     │
        └──────────── POST /webhooks/message-status ◄─────────┘
                      (signature verified, status persisted)
```

## Telnyx Products Used

- **Messaging** — send messages and receive delivery receipts via webhooks.

## API Endpoints

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api/messaging/send-message)
- **Delivery receipts** — Telnyx posts `message.sent` / `message.finalized` events to your webhook URL.

## Prerequisites

- Python 3.8+ (3.12+ recommended).
- A [Telnyx account](https://portal.telnyx.com/sign-up) with a funded balance.
- A [Telnyx API key](https://portal.telnyx.com/api-keys) and the matching **public key** (same page) for webhook verification.
- A [phone number](https://portal.telnyx.com/numbers/my-numbers) with messaging enabled and a [Messaging Profile](https://portal.telnyx.com/messaging/profiles).
- [ngrok](https://ngrok.com) to expose your local server to Telnyx webhooks.

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-marketing-campaign-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your credentials:

```
TELNYX_API_KEY=KEY...
TELNYX_PUBLIC_KEY=...        # from Portal → API Keys → Public Key
TELNYX_PHONE_NUMBER=+15551234567
FLASK_DEBUG=false
```

`TELNYX_PUBLIC_KEY` is required: the webhook handler rejects any request whose signature it cannot verify with it.

## Step 2: Understand the Code

Everything lives in `app.py`. The data model is three SQLite tables created on startup by `init_db()`:

- `campaigns` — one row per campaign (id, name, message, status).
- `campaign_recipients` — one row per phone number, with its `message_id` and delivery `status`.
- `message_events` — append-only log of delivery receipts.

### Sending one message

`send_sms_message()` validates the destination is E.164, calls `client.messages.create(...)`, and returns a JSON-serializable dict (SDK objects are not directly serializable):

```python
response = client.messages.create(from_=from_number, to=to_number, text=message)
return {
    "message_id": response.data.id,
    "status": response.data.to[0].status if response.data.to else "queued",
    ...
}
```

### Sending a batch with rate limiting

`send_campaign_batch()` pulls pending recipients and sends them one at a time, sleeping `RATE_LIMIT_DELAY` (100ms) between sends to stay under the API throughput limit. A failure on one recipient marks it `failed` and the loop continues — one bad number never sinks the whole batch.

### Verifying inbound webhooks

The delivery-receipt handler verifies the Telnyx Ed25519 signature **before** parsing the body. This is enforced on every request:

```python
@app.route("/webhooks/message-status", methods=["POST"])
def webhook_message_status():
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
    except Exception:
        return jsonify({"error": "invalid signature"}), 401

    body = request.get_json(silent=True)
    data = body.get("data", {})
    event_type = data.get("event_type")        # event_type lives at the data level
    payload = data.get("payload", {})          # event fields are nested under data.payload
    message_id = payload.get("id")
    status = (payload.get("to") or [{}])[0].get("status")
    ...
```

The client is initialized with both keys so `unwrap()` has the public key it needs:

```python
client = telnyx.Telnyx(
    api_key=os.getenv("TELNYX_API_KEY"),
    public_key=os.getenv("TELNYX_PUBLIC_KEY"),
)
```

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/campaigns` | Create a campaign and queue recipients |
| `POST` | `/campaigns/{id}/send` | Send a rate-limited batch |
| `GET`  | `/campaigns/{id}` | Status + delivery breakdown |
| `POST` | `/webhooks/message-status` | Receive signed delivery receipts |
| `GET`  | `/health` | Liveness probe |

## Step 3: Run It

```bash
python app.py
```

The server starts on `http://localhost:5000` and creates `marketing.db` automatically.

In a separate terminal, expose it for webhooks:

```bash
ngrok http 5000
```

Copy the HTTPS URL and set it in the [Telnyx Portal](https://portal.telnyx.com):

- **Messaging Profile** → Outbound → Webhook URL → `https://<id>.ngrok.io/webhooks/message-status`

## Step 4: Test It

Create a campaign:

```bash
curl -X POST http://localhost:5000/campaigns \
  -H "Content-Type: application/json" \
  -d '{"name": "Spring Sale", "message": "20% off this weekend! Reply STOP to opt out.", "recipients": ["+12125551234"]}'
```

Send it (use the `campaign_id` from the previous response):

```bash
curl -X POST http://localhost:5000/campaigns/<campaign_id>/send \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 100}'
```

Check status — as delivery receipts arrive, the breakdown updates from `queued` to `delivered`:

```bash
curl http://localhost:5000/campaigns/<campaign_id>
```

## Going to Production

- **Database** — SQLite is fine for testing; move to PostgreSQL for concurrency and volume.
- **Compliance** — honor STOP/opt-out, register your 10DLC brand and campaign, and only message consenting recipients.
- **Background sending** — move `send_campaign_batch` to a worker/queue (Celery, RQ) so large campaigns don't block HTTP requests.
- **Authentication** — add API-key or token auth to the campaign endpoints.
- **Webhook security** — already enforced here via `client.webhooks.unwrap()`; keep `TELNYX_PUBLIC_KEY` set in every environment.
- **Monitoring** — add structured logging and alert on the `failed` recipient count.

## Resources

- [Source code and API reference](./README.md)
- [Endpoint reference](./API.md)
- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Receive Webhooks](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx Portal](https://portal.telnyx.com)
