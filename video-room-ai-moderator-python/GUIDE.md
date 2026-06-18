# Build a Video Room AI Moderator

Video Room AI Moderator — create video rooms with AI-powered content moderation on chat and participant management.

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

- **AI Inference** — LLM inference with OpenAI-compatible API, runs on Telnyx infrastructure

## API Endpoints

- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/video-room-ai-moderator-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (94 lines). Here's what each piece does.

### Starting the Workflow

**`create_room()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
data = request.get_json()
    try:
        resp = requests.post(f"{API}/rooms", headers=headers,
            json={"unique_name": data.get("name", f"room-{int(time.time())}"),
                "max_participants": data.get("max_participants", 10),
                "enable_recording": data.get("record", False)}, timeout=15)
        result = resp.json()
        room_id = result.get("data", {}).get("id")
```

**`create_token()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
data = request.get_json()
    try:
        resp = requests.post(f"{API}/rooms/{room_id}/actions/generate_join_client_token",
            headers=headers, json={"refresh_token_ttl_secs": 3600,
                "token_ttl_secs": 600}, timeout=15)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500
```

### Business Logic

- **`list_rooms()`** — Makes an API call and processes the response.
- **`moderate_message()`** — Makes an API call and processes the response.
- **`get_log()`** — Handles the get log logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/rooms` | Create Room |
| `POST` | `/rooms` | List Rooms |
| `POST` | `/rooms/<room_id>/tokens` | Create Token |
| `POST` | `/moderate` | Moderate Message |
| `GET` | `/moderation-log` | Get Log |
| `DELETE` | `/rooms/<room_id>` | Delete Room |
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
curl -X POST http://localhost:5000/rooms \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125559999"
  }'
```

**Check results:**

```bash
curl http://localhost:5000/moderation-log | python3 -m json.tool
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
docker build -t video-room-ai-moderator-python .
docker run --env-file .env -p 5000:5000 video-room-ai-moderator-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
