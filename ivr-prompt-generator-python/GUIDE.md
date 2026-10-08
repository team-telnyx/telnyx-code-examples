# Build an IVR Prompt Generator

Generate professional IVR/phone system prompts. AI writes caller-friendly scripts from business descriptions, TTS renders in multiple voices, test via live Telnyx call playback.

## How It Works

```
  Inbound Phone Call
        │
        ▼
  ┌──────────────────┐
  │ Answer + Greet    │ ── TTS welcome message
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ Listen for Input  │
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ AI Inference      │
  │ • Business logic   │
  └────────┬─────────┘
           │ ◄──── conversation loop
           │
           ├──► Voice response
           ├──► Email
           └──► Cloud Storage
```

## Telnyx Products Used

- **Voice** — programmatic call control with webhooks for every call state change
- **AI Inference** — LLM inference with OpenAI-compatible API, runs on Telnyx infrastructure
- **Cloud Storage** — S3-compatible object storage for recordings and media

## API Endpoints

- **AI Inference (script writing)**: `POST /v2/ai/chat/completions` -- [ref](https://developers.telnyx.com/api/inference/chat-completions)
- **TTS Generate**: `POST /v2/text-to-speech/speech` -- [ref](https://developers.telnyx.com/api-reference/text-to-speech-commands/list-available-voices)
- **Create Call (preview)**: `POST /v2/calls` -- [ref](https://developers.telnyx.com/api/call-control/create-call)
- **Speak (playback)**: `POST /v2/calls/{id}/actions/speak` -- [ref](https://developers.telnyx.com/api/call-control/speak)
- **Cloud Storage (S3-compatible)**: `s3.put_object(...)` via boto3 against `https://{region}.telnyxcloudstorage.com`, then a presigned GET URL -- [docs](https://developers.telnyx.com/docs/cloud-storage/quick-start)

Telnyx Cloud Storage is S3-compatible, so rendered TTS audio is uploaded with the AWS SDK (boto3) — not a REST API. The boto3 client is pointed at the region-scoped endpoint `https://{region}.telnyxcloudstorage.com`, and your Telnyx API key is used as **both** the access key and the secret key:

```python
s3 = boto3.client(
    "s3",
    endpoint_url=f"https://{REGION}.telnyxcloudstorage.com",
    aws_access_key_id=TELNYX_API_KEY,
    aws_secret_access_key=TELNYX_API_KEY,
    region_name=REGION,
    config=Config(signature_version="s3v4"),
)
```

`upload_to_storage()` calls `s3.put_object(...)` to store the audio, then returns a time-limited presigned GET URL (valid 1 hour) via `s3.generate_presigned_url("get_object", ...)`. That URL drops straight into a Call Control `speak`/`playback_audio` command or a TeXML `<Play>` verb.

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
cd telnyx-code-examples/ivr-prompt-generator-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (268 lines). Here's what each piece does.

### Handling Webhooks

This is the core of the app — a state machine driven by Telnyx webhook events. Each event triggers the next step:

**`handle_voice()`** — The voice webhook handler — the core state machine. Each Telnyx event triggers the next action in the call flow.

### Business Logic

- **`inference()`** — Makes an API call and processes the response.
- **`tts_generate()`** — Makes an API call and processes the response.
- **`telnyx_post()`** — Makes an API call and processes the response.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/prompts/generate` | Generate Prompts |
| `POST` | `/prompts/<set_id>/preview` | Preview Prompt |
| `POST` | `/webhooks/voice` | Telnyx webhook handler |
| `GET` | `/prompts/<set_id>` | Get Prompt Set |
| `GET` | `/prompt-types` | Get Prompt Types |
| `GET` | `/health` | Health check |

The webhook handler is the core state machine. Each Telnyx event triggers the next action:

```python

    if event_type == "call.answered":
        client_state = {}
        try:
            raw = ep.get("client_state", "")
            if raw:
                client_state = json.loads(bytes.fromhex(raw).decode())
        except Exception:
            pass

        if client_state.get("action") == "preview":
            script = client_state.get("script", "This is a test prompt.")
            try:
                telnyx_post(f"calls/{call_id}/actions/speak", {
```

The trigger endpoint kicks off the workflow:

```python
def generate_prompts():
    """Generate a full IVR prompt set for a business.

    AI writes caller-friendly scripts, TTS renders each prompt.
    """
    data = request.get_json() or {}
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    business_name = data.get("business_name", "")
    business_type = data.get("business_type", "")
    hours = data.get("hours", "Monday-Friday 9am-5pm")
    departments = data.get("departments", ["Sales", "Support", "Billing"])
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
curl -X POST http://localhost:5000/prompts/generate \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125559999"
  }'
```

Or call your Telnyx number from any phone to trigger the full voice workflow.

**Check results:**

```bash
curl http://localhost:5000/prompts/<set_id> | python3 -m json.tool
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

- [Source code and reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ivr-prompt-generator-python/README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Call Control quickstart](https://developers.telnyx.com/docs/voice/call-control)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
