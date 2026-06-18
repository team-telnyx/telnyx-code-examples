# Build a SMS Trivia Game Tournament

SMS Trivia Game Tournament — multi-player trivia via SMS. Players join, answer timed questions, scores tracked on a live leaderboard.

## How It Works

```
Inbound SMS
      │
      ▼
Parse Message ──► AI Inference
                  (understand intent)
      │
      ▼
Take Action ──► Reply SMS
```

## Telnyx Products Used

- **SMS/MMS** — send and receive messages with delivery receipts
- **AI Inference** — LLM inference with OpenAI-compatible API, runs on Telnyx infrastructure

## API Endpoints

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api/messaging/send-message)
- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Webhook Events

Telnyx delivers inbound messages and status updates via webhooks to your server.

This app handles these webhook events ([Messaging docs](https://developers.telnyx.com/docs/api/v2/messaging)):
- `message.received` — Inbound SMS/MMS received

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) with messaging enabled
- [Messaging Profile](https://portal.telnyx.com/messaging/profiles) with webhook URL
- [ngrok](https://ngrok.com) for exposing your local server to Telnyx webhooks

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-trivia-game-tournament-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (106 lines). Here's what each piece does.

### Starting the Workflow

**`create_tournament()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
data = request.get_json()
    tid = f"T-{int(time.time())}"
    tournaments[tid] = {"name": data.get("name", "Trivia Night"), "category": data.get("category", "general"),
        "rounds": data.get("rounds", 5), "current_round": 0, "current_question": None, "players": {}, "status": "lobby"}
    return jsonify({"tournament_id": tid, "join_code": tid}), 200
@app.route("/webhooks/messaging", methods=["POST"])
```

### Handling Webhooks

Webhook handlers process events from Telnyx:

**`handle_sms()`** — Processes inbound SMS messages. Parses the customer's reply and routes to the appropriate business logic.

### Helper Functions

- **`send_sms()`** — Sends an SMS via the Telnyx Messaging API. Wraps the `POST /v2/messages` call with error handling.

### Business Logic

- **`generate_question()`** — Makes an API call and processes the response.
- **`next_round()`** — Handles the next round logic.
- **`leaderboard()`** — Handles the leaderboard logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/tournament/create` | Create Tournament |
| `POST` | `/webhooks/messaging` | Telnyx webhook handler |
| `POST` | `/tournament/<tid>/next` | Next Round |
| `GET` | `/tournament/<tid>/leaderboard` | Leaderboard |
| `GET` | `/health` | Health check |

## Step 3: Run It

```bash
python app.py
```

Server starts on `http://localhost:5000`.

In a separate terminal, expose your server for webhooks:

```bash
ngrok http 5000
```

Copy the HTTPS URL and set it in the [Telnyx Portal](https://portal.telnyx.com):

- **Messaging Profile** → Inbound Webhook → `https://<id>.ngrok.io/webhooks/sms`

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Trigger the workflow:**

```bash
curl -X POST http://localhost:5000/tournament/create \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125559999"
  }'
```

Or text your Telnyx number to trigger the SMS workflow.

**Check results:**

```bash
curl http://localhost:5000/tournament/<tid>/leaderboard | python3 -m json.tool
```

## Going to Production

This example uses in-memory storage for simplicity. For production:

- **Database** — replace the in-memory dict/list with PostgreSQL or Redis
- **Authentication** — add API key validation on your endpoints
- **Webhook verification** — validate Telnyx webhook signatures ([docs](https://developers.telnyx.com/docs/api/v2/overview#webhook-signing))
- **Prompt engineering** — tune the AI prompts for your specific domain and tone
- **Monitoring** — add structured logging and health check alerts
- **Rate limiting** — protect your endpoints from abuse

## Deploy

```bash
# Docker
docker build -t sms-trivia-game-tournament-python .
docker run --env-file .env -p 5000:5000 sms-trivia-game-tournament-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Messaging quickstart](https://developers.telnyx.com/docs/messaging)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
