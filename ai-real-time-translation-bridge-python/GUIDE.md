# Build an Ai Real Time Translation Bridge



## How It Works

```
Inbound/Outbound Call
        │
        ▼
  Call Answered ──► TTS Greeting
        │
        ▼
  Gather Input ──► AI Inference
  (speech/DTMF)    (process + decide)
        │
        ▼
  Take Action ──► SMS Notification
  (speak/transfer)
        │
        ▼
  Call Ends ──► Log & Notify
```

## API Endpoints

- **Call Control: Hangup**: `POST /v2/calls/{id}/actions/hangup` — [API reference](https://developers.telnyx.com/api/call-control/hangup)
- **Create Call**: `POST /v2/calls` — [API reference](https://developers.telnyx.com/api/call-control/create-call)
- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Webhook Events

Your app receives webhook events from Telnyx as things happen.

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):
- `call.answered` — Call connected — app begins interaction
- `call.gather.ended` — Caller input received (speech transcription or DTMF digits)
- `call.hangup` — Call ended — app cleans up session, triggers post-call processing
- `call.speak.ended` — TTS playback finished — app transitions to next action (gather, transfer, etc.)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-real-time-translation-bridge-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (100 lines). Here's what each piece does.

### Starting the Workflow

**`create_bridge()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
data = request.get_json()
    bid = f"BR-{int(time.time())}"
    bridges[bid] = {"caller_a": data.get("number_a"), "lang_a": data.get("lang_a", "English"),
        "caller_b": data.get("number_b"), "lang_b": data.get("lang_b", "Spanish"), "state": "initiating", "ccids": {}}
    try:
        resp = requests.post("https://api.telnyx.com/v2/calls", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"to": data["number_a"], "from": BRIDGE_NUMBER, "connection_id": CONNECTION_ID,
                "client_state": json.dumps({"bid": bid, "side": "a"}).encode().hex()}, timeout=10)
```

### Handling Webhooks

Webhook handlers process events from Telnyx:

**`handle_voice()`** — The voice webhook handler — the core state machine. Each Telnyx event triggers the next action in the call flow.

### Business Logic

- **`translate()`** — Makes an API call and processes the response.
- **`list_bridges()`** — Manages the conference bridge — adding participants, muting, and tracking active speakers.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/bridge` | Create Bridge |
| `POST` | `/webhooks/voice` | Telnyx webhook handler |
| `GET` | `/bridges` | List Bridges |
| `GET` | `/health` | Health check |

## Step 3: Run It

```bash
python app.py
```

Server starts on `http://localhost:5000`.

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Trigger the workflow:**

```bash
curl -X POST http://localhost:5000/bridge \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125559999"
  }'
```

**Check results:**

```bash
curl http://localhost:5000/bridges | python3 -m json.tool
```

## Going to Production

This example uses in-memory storage for simplicity. For production:

- **Database** — replace the in-memory dict/list with PostgreSQL or Redis
- **Authentication** — add API key validation on your endpoints
- **Webhook verification** — validate Telnyx webhook signatures ([docs](https://developers.telnyx.com/docs/api/v2/overview#webhook-signing))
- **Monitoring** — add structured logging and health check alerts
- **Rate limiting** — protect your endpoints from abuse

## Deploy

```bash
# Docker
docker build -t ai-real-time-translation-bridge-python .
docker run --env-file .env -p 5000:5000 ai-real-time-translation-bridge-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
