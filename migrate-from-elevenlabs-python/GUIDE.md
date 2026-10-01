# Migrate from ElevenLabs to Telnyx

Migrate from ElevenLabs — import ElevenLabs voice configurations to Telnyx TTS with voice mapping and cost comparison.

## How It Works

```
  ElevenLabs (source)
        │
        ▼
  ┌──────────────────┐     ┌───────────────────┐
  │ 1. Audit         │────►│ Inventory Report  │
  │    (numbers,     │     │ (numbers, configs,│
  │     configs)     │     │  webhooks, apps)  │
  └────────┬─────────┘     └───────────────────┘
           │
           ▼
  ┌──────────────────┐
  │ 2. Map Features  │ ── source capability → Telnyx equivalent
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐     ┌───────────────────┐
  │ 3. Provision     │────►│ Telnyx Platform   │
  │    on Telnyx     │     │ • Phone numbers   │
  └────────┬─────────┘     │ • SIP connections │
           │               │ • Messaging       │
           ▼               └───────────────────┘
  ┌──────────────────┐
  │ Migration Report │
  │ (success/fail    │
  │  per resource)   │
  └──────────────────┘
```

## Telnyx Products Used

- **AI Assistants** — LLM inference with OpenAI-compatible API, runs on Telnyx infrastructure
- **Migration**
- **Number Porting** — phone number search, purchase, and configuration

## API Endpoints

- **TTS Generate**: `POST /v2/text-to-speech/speech` — [API reference](https://developers.telnyx.com/api-reference/text-to-speech-commands/list-available-voices)
- **Chat Completions**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)
- **List Models**: `GET /v2/ai/models` — [API reference](https://developers.telnyx.com/api/inference/list-models)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) with voice enabled
- [Call Control Application](https://portal.telnyx.com/call-control/applications) configured with your webhook URL
- [ngrok](https://ngrok.com) for exposing your local server to Telnyx webhooks

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/migrate-from-elevenlabs-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (98 lines). Here's what each piece does.

### Business Logic

- **`audit_elevenlabs()`** — Makes an API call and processes the response.
- **`migrate_voice()`** — Processes migrate voice request and returns result.
- **`voice_mapping()`** — Maps voice names to TTS engine voice IDs.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/audit/elevenlabs` | Audit Elevenlabs |
| `POST` | `/migrate/voice-config` | Migrate Voice |
| `GET` | `/mapping/voices` | Voice Mapping |
| `GET` | `/cost-comparison` | Cost Comparison |
| `POST` | `/test-tts` | Test Tts |
| `GET` | `/migration-log` | Get Log |
| `GET` | `/health` | Health check |

The trigger endpoint kicks off the workflow:

```python
def migrate_voice():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    el_voice = data.get("elevenlabs_voice_name", "")
    mapping = VOICE_MAP.get(el_voice, {})
    if not mapping:
        return jsonify({"error": f"No auto-mapping for '{el_voice}'. Use /mapping/voices to find similar.",
            "suggestion": "en-US-Neural2-F (default female) or en-US-Neural2-D (default male)"}), 200
    telnyx_config = {"voice": {"provider": "telnyx",
        "settings": {"voice_id": mapping["telnyx"], "speed": data.get("speed", 1.0)}}}
    migration_log.append({"action": "voice_migration", "from": el_voice,
```

The main endpoint processes the request:

```python
def audit_elevenlabs():
    if not ELEVENLABS_API_KEY:
        return jsonify({"error": "ELEVENLABS_API_KEY not configured"}), 400
    try:
        resp = requests.get("https://api.elevenlabs.io/v1/voices",
            headers={"xi-api-key": ELEVENLABS_API_KEY}, timeout=15)
        voices = resp.json().get("voices", []) if resp.ok else []
        audit = []
        for v in voices:
            telnyx_match = VOICE_MAP.get(v.get("name"), {})
```

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

- **Call Control Application** → Webhook URL → `https://<id>.ngrok.io/webhooks/voice`

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Trigger the workflow:**

```bash
curl -X POST http://localhost:5000/migrate/voice-config \
  -H "Content-Type: application/json" \
  -d '{
    "source": "twilio",
    "account_sid": "AC...",
    "auth_token": "<value>"
  }'
```

Or call your Telnyx number from any phone to trigger the full voice workflow.

**Check results:**

```bash
curl http://localhost:5000/audit/elevenlabs | python3 -m json.tool
```

## Going to Production

This example uses in-memory storage for simplicity. For production:

- **Database** — replace the in-memory dict/list with PostgreSQL or Redis
- **Authentication** — add API key validation on your endpoints
- **Webhook verification** — validate Telnyx webhook signatures ([docs](https://developers.telnyx.com/docs/api/v2/overview#webhook-signing))
- **Error recovery** — handle call failures gracefully with retry or SMS fallback
- **Prompt engineering** — tune the AI prompts for your specific domain and tone
- **Monitoring** — add structured logging and health check alerts
- **Rate limiting** — protect your endpoints from abuse

## Run

```bash
pip install -r requirements.txt
python app.py
```

## Resources

- [Source code and reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/migrate-from-elevenlabs-python/README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Call Control quickstart](https://developers.telnyx.com/docs/voice/call-control)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
