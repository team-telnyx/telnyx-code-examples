# Receive Inbound MMS Webhooks with Telnyx and Python

Receive inbound MMS messages with a Telnyx webhook, verify the signature, and download media attachments.

## How It Works

```
  Inbound MMS
       │
       ▼
  ┌──────────────────┐
  │ Telnyx Messaging  │
  └────────┬─────────┘
           │  POST message.received (Ed25519-signed)
           ▼
  ┌────────────────────────────┐
  │ Flask  /webhooks/message    │
  │  1. verify signature        │
  │  2. parse data.payload      │
  │  3. download media[].url    │
  └────────────┬───────────────┘
               │
               └──► ./media/<message_id>_<idx>.<ext>
```

When someone sends an MMS to your Telnyx number, Telnyx POSTs a signed `message.received` event to your webhook URL. Your server verifies the signature, reads the message fields from `data.payload`, and downloads each media attachment from its signed URL.

## Telnyx Products Used

- **Messaging** — inbound SMS/MMS delivered as signed webhook events.

## Webhook Consumed

- **`message.received`** — sent to your Messaging Profile's inbound webhook URL. See the [inbound message reference](https://developers.telnyx.com/api-reference/messages/receive-a-message).

## Prerequisites

- Python 3.8+ (3.12+ recommended).
- A [Telnyx account](https://portal.telnyx.com/sign-up).
- A [Telnyx API key](https://portal.telnyx.com/api-keys).
- Your Telnyx **public key**, from the same [API keys page](https://portal.telnyx.com/api-keys) — used to verify webhook signatures.
- A [Telnyx phone number](https://portal.telnyx.com/numbers/my-numbers) with MMS enabled, assigned to a [Messaging Profile](https://portal.telnyx.com/messaging/profiles).
- [ngrok](https://ngrok.com) (or any public HTTPS tunnel) to expose your local server.

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/receive-mms-webhook-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your `TELNYX_API_KEY` and `TELNYX_PUBLIC_KEY`. Both come from the [Telnyx Portal API keys page](https://portal.telnyx.com/api-keys).

## Step 2: Understand the Code

Everything lives in `app.py`. Here is what each piece does.

### Verify the signature first

Every inbound webhook is rejected unless its Ed25519 signature verifies. The client is initialized with both your API key and public key, and `unwrap()` runs at the top of the route, before any parsing:

```python
client = telnyx.Telnyx(
    api_key=os.getenv("TELNYX_API_KEY"),
    public_key=os.getenv("TELNYX_PUBLIC_KEY"),
)

@app.route("/webhooks/message", methods=["POST"])
def receive_mms():
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
    except Exception:
        return jsonify({"error": "invalid signature"}), 401
```

`unwrap()` reads the `telnyx-signature-ed25519` and `telnyx-timestamp` headers and raises if the signature or timestamp (replay) check fails. Never parse an unverified body.

### Read fields from the right place

The Telnyx envelope keeps `id` and `event_type` at the `data` level, and the message fields under `data.payload`:

```python
event_data = payload.get("data", {})
event_type = event_data.get("event_type")
if event_type != "message.received":
    return jsonify({"status": "ignored", "event_type": event_type}), 200

p = event_data.get("payload", {})
from_number = p.get("from", {}).get("phone_number", "unknown")
text = p.get("text", "")
media_urls = p.get("media", [])
```

### Download media promptly

Telnyx `media[].url` values are signed and short-lived, so download them as soon as the event arrives:

```python
def download_media(media_url: str, filename: str) -> dict:
    response = requests.get(media_url, timeout=10)
    response.raise_for_status()
    os.makedirs("media", exist_ok=True)
    with open(os.path.join("media", filename), "wb") as f:
        f.write(response.content)
```

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/webhooks/message` | Receive and process inbound MMS |
| `GET` | `/messages` | List downloaded media (demo) |
| `GET` | `/health` | Liveness probe |

## Step 3: Run It

```bash
python app.py
```

The server starts on `http://localhost:5000`.

In a separate terminal, expose it for webhooks:

```bash
ngrok http 5000
```

Copy the HTTPS URL and set it in the [Telnyx Portal](https://portal.telnyx.com):

- **Messaging → Messaging Profiles** → your profile → **Inbound Settings** → Webhook URL → `https://<id>.ngrok.io/webhooks/message`

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Trigger the webhook:**

Text an image to your Telnyx number from your phone. Watch the app logs — you should see a `Received MMS from ... with N attachments` line, and the media file appears under `./media/`.

```bash
curl http://localhost:5000/messages
```

Because the webhook signature is enforced, you cannot meaningfully test `/webhooks/message` with a hand-crafted curl request — send a real MMS so Telnyx signs the event.

## Going to Production

This example stores downloaded files on local disk. For production:

- **Storage** — write media to object storage (S3, GCS, Telnyx Cloud Storage) and message metadata to a database.
- **Async processing** — acknowledge the webhook fast and download media in a worker (e.g. Celery) so a slow download never blocks the 200 response.
- **Idempotency** — dedupe on `data.id`; Telnyx may retry deliveries.
- **Monitoring** — add structured logging and alerting on `/health`.
- **Keep signatures enforced** — never disable `unwrap()`; it is your only proof an event came from Telnyx.

## Resources

- [Source code and reference](./README.md)
- [Typed endpoint reference](./API.md)
- [Receive a message — API reference](https://developers.telnyx.com/api-reference/messages/receive-a-message)
- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Webhook signing & verification](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx Portal](https://portal.telnyx.com)
