# Manage SMS Opt-Outs with Telnyx

Build a Flask service that keeps an auditable SMS opt-out list, automatically opts users out when they text `STOP`, and blocks outbound messages to anyone who has opted out — all on top of the Telnyx Messaging API.

## How It Works

```
  Inbound "STOP" SMS                  Outbound send request
        │                                     │
        ▼                                     ▼
  ┌─────────────────────┐            ┌──────────────────────┐
  │ POST /webhooks/sms  │            │ POST /sms/send       │
  │ verify signature    │            │ check opt-out list   │
  └─────────┬───────────┘            └──────────┬───────────┘
            │                                   │
            ▼                                   ▼
  ┌─────────────────────┐            opted out? ──► 400 (blocked)
  │ add to opt-out list │                   │
  │ (SQLite optouts)    │                   ▼
  └─────────────────────┘            POST /v2/messages ──► Telnyx
```

## Telnyx Products Used

- **Messaging** — send messages and receive inbound SMS with signed delivery webhooks

## API Endpoints

- **Send Message**: `POST /v2/messages` -- [API reference](https://developers.telnyx.com/api/messaging/send-message)
- **Inbound webhook**: `message.received` event delivered to your URL -- [Webhook reference](https://developers.telnyx.com/api-reference/messaging/receive-inbound-message)

## Prerequisites

- Python 3.8+ (3.12+ recommended)
- [Telnyx account](https://portal.telnyx.com/sign-up) with a funded balance
- [API key](https://portal.telnyx.com/api-keys) and the matching public key (same page)
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) with messaging enabled
- [Messaging Profile](https://portal.telnyx.com/messaging/profiles) with an inbound webhook URL
- [ngrok](https://ngrok.com) to expose your local server to Telnyx

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-opt-out-management-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` and set `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`, and `TELNYX_PHONE_NUMBER`. Both keys come from the [API Keys page](https://portal.telnyx.com/api-keys) in the portal.

## Step 2: Understand the Code

Everything lives in `app.py`. The Telnyx client is initialized with both an API key (for sending) and a public key (for verifying inbound webhooks):

```python
client = telnyx.Telnyx(
    api_key=os.getenv("TELNYX_API_KEY"),
    public_key=os.getenv("TELNYX_PUBLIC_KEY"),
)
```

Opt-out state is stored in SQLite. Two tables are created on startup: `optouts` (the opt-out list) and `message_log` (an audit trail of inbound and outbound messages).

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/sms/send` | Send an SMS, blocked if recipient is opted out |
| `POST` | `/optout/add` | Manually opt a number out |
| `POST` | `/optout/remove` | Re-opt a number in |
| `GET`  | `/optout/list` | List all opted-out numbers |
| `POST` | `/optout/check` | Check a single number |
| `POST` | `/webhooks/sms` | Inbound SMS webhook (auto opt-out on STOP) |

### Blocking opted-out recipients

`send_sms()` checks the opt-out list before calling Telnyx, so an opted-out number never receives a message:

```python
if is_opted_out(to_number):
    raise ValueError(f"Recipient {to_number} has opted out of SMS messages")

response = client.messages.create(from_=from_number, to=to_number, text=message)
```

### Verifying and handling inbound webhooks

The webhook route verifies the Telnyx signature against the raw request body **before** parsing anything. Event fields live under `data.payload`, while `event_type` is at the `data` level:

```python
@app.route("/webhooks/sms", methods=["POST"])
def handle_sms_webhook():
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
    except Exception:
        return jsonify({"error": "invalid signature"}), 401

    data = request.get_json(silent=True)
    event_type = data.get("data", {}).get("event_type")
    if event_type != "message.received":
        return jsonify({"status": "ignored"}), 200

    payload = data.get("data", {}).get("payload", {})
    from_number = payload.get("from", {}).get("phone_number")
    text = payload.get("text", "").upper().strip()

    if from_number and text in ["STOP", "UNSUBSCRIBE", "STOPALL", "QUIT"]:
        add_optout(from_number, reason=f"User replied with: {text}", source="webhook")
        return jsonify({"status": "opted_out", "phone_number": from_number}), 200

    return jsonify({"status": "processed"}), 200
```

Verifying the signature on every call means a forged request — for example, an attacker trying to opt someone out — is rejected with `401` before it touches the database.

## Step 3: Run It

```bash
python app.py
```

The server starts on `http://localhost:5000` and creates `optout.db` on first run.

In a separate terminal, expose it for webhooks:

```bash
ngrok http 5000
```

Copy the HTTPS URL and set it in the [Telnyx Portal](https://portal.telnyx.com):

- **Messaging Profile** → Inbound Webhook → `https://<id>.ngrok.io/webhooks/sms`

## Step 4: Test It

**Opt a number out manually:**

```bash
curl -X POST http://localhost:5000/optout/add \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+12125559999", "reason": "test"}'
```

**Confirm sends are now blocked:**

```bash
curl -X POST http://localhost:5000/sms/send \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125559999", "message": "Hi"}'
# → 400 {"error": "Invalid request"}
```

**Trigger an automatic opt-out** by texting `STOP` from your phone to your Telnyx number, then list the opt-outs:

```bash
curl http://localhost:5000/optout/list
```

You should see your number with `source: "webhook"`.

## Going to Production

- **Database** — SQLite is fine for a demo; move to PostgreSQL for concurrent writes.
- **Webhook verification** — already enforced here via `client.webhooks.unwrap()`. Keep `TELNYX_PUBLIC_KEY` set in every environment.
- **Compliance** — keep `opted_out_at`, `reason`, and `source` for your audit trail; honor opt-outs across all messaging campaigns.
- **Monitoring** — add structured logging and alerts on `4xx`/`5xx` rates.
- **Rate limiting** — protect the public endpoints from abuse.

## Resources

- [Source code and reference](./README.md)
- [Typed API reference](./API.md)
- [Messaging quickstart](https://developers.telnyx.com/docs/messaging)
- [Webhook signature verification](https://developers.telnyx.com/docs/messaging/messages/webhooks)
- [Telnyx Portal](https://portal.telnyx.com)
