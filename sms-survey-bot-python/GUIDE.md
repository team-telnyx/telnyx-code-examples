# Build an SMS Survey Bot with Telnyx and Python

Run multi-question SMS surveys over the Telnyx Messaging API. The bot sends a
participant each question in turn, validates their replies through a signed
inbound webhook, tracks progress per participant, and exposes the collected
results over HTTP.

## How It Works

```
  POST /survey/start ──┐
                       ▼
              ┌──────────────────┐
              │  Flask app        │
              │  (survey state)   │──► POST /v2/messages ──► participant
              └────────┬─────────┘
                       ▲
   participant reply ──┘
   (message.received) ──► POST /webhook/sms (signature verified)
                       │
                       └──► advance question / complete / reject
```

You kick off a survey with `POST /survey/start` (or a participant texting `START`).
The app stores per-participant state and sends question one. Each reply arrives as
a signed `message.received` webhook; the app validates the answer, records it, and
either sends the next question or the completion message.

## Telnyx Products Used

- **Messaging** — send survey questions and receive participant replies with delivery webhooks.

## API Endpoints

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- **Inbound message webhook** (`message.received`) — [Webhook reference](https://developers.telnyx.com/api-reference/inbound-message-webhook)

## Prerequisites

- Python 3.8 or higher.
- A [Telnyx account](https://portal.telnyx.com/sign-up) with a funded balance.
- A Telnyx [API key](https://portal.telnyx.com/api-keys).
- Your Telnyx **Public Key** (Portal account page) for webhook signature verification.
- A Telnyx [phone number](https://portal.telnyx.com/numbers/my-numbers) enabled for SMS.
- A [Messaging Profile](https://portal.telnyx.com/messaging/profiles) with an inbound webhook URL.
- [ngrok](https://ngrok.com) (or similar) to expose your local server to Telnyx webhooks.

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-survey-bot-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your credentials:

```bash
TELNYX_API_KEY=KEY_your_telnyx_api_key_here
TELNYX_PUBLIC_KEY=your_telnyx_public_key_here
TELNYX_PHONE_NUMBER=+15551234567
FLASK_DEBUG=false
```

`TELNYX_PUBLIC_KEY` is required: the webhook rejects any request whose signature
does not verify against it.

## Step 2: Understand the Code

Everything lives in `app.py`. Here are the pieces that matter.

### Client initialization with signature verification

The SDK client is created with both the API key (to send messages) and the public
key (to verify inbound webhooks):

```python
client = telnyx.Telnyx(
    api_key=os.getenv("TELNYX_API_KEY"),
    public_key=os.getenv("TELNYX_PUBLIC_KEY"),
)
```

### Survey definition and state

`SURVEY_QUESTIONS` is a list of questions, each with an `id`, prompt `text`, and the
set of `valid_responses` accepted for that question. Per-participant progress lives in
the in-memory `survey_responses` dict — fine for a demo, but swap it for a database in
production so state survives restarts.

### Starting a survey

`start_survey(to_number)` validates the E.164 format, initializes state, and sends
the first question with `client.messages.create(...)`.

### Processing a reply

`process_survey_response(from_number, message_text)` looks up the participant's state,
validates the reply against the current question's `valid_responses`, records valid
answers, and either advances to the next question or sends the completion message.

### The signed webhook

Inbound replies arrive at `/webhook/sms`. The first thing the handler does — before
parsing anything — is verify the Telnyx signature:

```python
@app.route("/webhook/sms", methods=["POST"])
def webhook_sms():
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
    except Exception:
        return jsonify({"error": "invalid signature"}), 401

    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"error": "No payload"}), 400

    data = payload.get("data", {})
    event_type = data.get("event_type")
    if event_type != "message.received":
        return jsonify({"status": "ignored"}), 200

    message_data = data.get("payload", {})
    from_number = message_data.get("from", {}).get("phone_number")
    message_text = message_data.get("text", "").strip()
    ...
```

Note the shape: `event_type` is read at the `data` level, but the event fields
(`from`, `text`) are nested under `data.payload`.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/survey/start` | Start a survey and send question one |
| `POST` | `/webhook/sms` | Receive participant replies (called by Telnyx) |
| `GET` | `/survey/results` | List progress for all participants |
| `GET` | `/survey/participant/<participant>` | Progress for one participant |

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

- **Messaging Profile** → Inbound Settings → Webhook URL → `https://<id>.ngrok.io/webhook/sms`

## Step 4: Test It

Start a survey:

```bash
curl -X POST http://localhost:5000/survey/start \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125551234"}'
```

The participant receives question one on their phone. As they reply, Telnyx posts each
message to your webhook and the bot advances them through the survey.

Inspect collected results at any time:

```bash
curl http://localhost:5000/survey/results
```

Replies are validated against the exact `valid_responses` for each question, so a reply
that is not in the allowed set causes the question to be resent.

## Going to Production

This example uses in-memory storage for simplicity. Before deploying:

- **Database** — replace the `survey_responses` dict with PostgreSQL or Redis so state survives restarts and scales across instances.
- **Webhook signatures** — already enforced here. Keep `TELNYX_PUBLIC_KEY` set; never disable the `unwrap()` check.
- **Authentication** — add API key or session auth on the `/survey/*` management endpoints.
- **Rate limiting** — add backoff and spacing when starting surveys in bulk to avoid `429`s.
- **Monitoring** — add structured logging and alerting on webhook failures.

## Resources

- [Source code and API reference](./README.md)
- [Endpoint reference](./API.md)
- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Receive webhooks and verify signatures](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx Portal](https://portal.telnyx.com)
