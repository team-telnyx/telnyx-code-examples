# Build a Video Room AI Meeting Moderator

Video Room AI Meeting Moderator — create video rooms with AI-powered agenda tracking and time management.

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

- **Video Rooms**: `POST /v2/rooms` — [API reference](https://developers.telnyx.com/api/video/create-room)
- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/video-room-ai-meeting-moderator-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (79 lines). Here's what each piece does.

### Starting the Workflow

**`create_room()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
data = request.get_json()
    agenda = data.get("agenda", [])
    duration = data.get("duration_minutes", 30)
    try:
        resp = requests.post("https://api.telnyx.com/v2/rooms", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"unique_name": data.get("name", f"meeting-{int(time.time())}"), "max_participants": data.get("max_participants", 10), "enable_recording": True}, timeout=10)
        room_data = resp.json().get("data", {})
        room_id = room_data.get("id")
```

**`start_meeting()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
room = rooms.get(room_id)
    if not room:
        return jsonify({"error": "Room not found"}), 404
    room["start_time"] = time.time()
    if room["agenda"]:
        room["agenda"][0]["status"] = "active"
    return jsonify({"status": "started", "first_topic": room["agenda"][0]["topic"] if room["agenda"] else None}), 200
@app.route("/rooms/<room_id>/status", methods=["GET"])
```

### Helper Functions

- **`call_inference()`** — Sends conversation context to Telnyx AI Inference and returns the model's response. Uses the OpenAI-compatible chat completions endpoint.

### Business Logic

- **`meeting_status()`** — Handles the meeting status logic.
- **`next_topic()`** — Handles the next topic logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/rooms` | Create Room |
| `POST` | `/rooms/<room_id>/start` | Start Meeting |
| `GET` | `/rooms/<room_id>/status` | Meeting Status |
| `POST` | `/rooms/<room_id>/next` | Next Topic |
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
curl http://localhost:5000/rooms/<room_id>/status | python3 -m json.tool
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
docker build -t video-room-ai-meeting-moderator-python .
docker run --env-file .env -p 5000:5000 video-room-ai-meeting-moderator-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
