# Build a Cloud Storage Call Archive

Cloud Storage Call Archive — archive call recordings to Telnyx Cloud Storage with searchable metadata.

## How It Works

```
Inbound Call ──► Webhook ──► Your App
                                │
                           Process Call
                           (TTS/DTMF/Transfer)
                                │
                           Call Ends ──► Log
```

## Telnyx Products Used

- **Cloud Storage** — S3-compatible object storage for recordings and media
- **Migration**
- **Number Porting** — phone number search, purchase, and configuration
- **Voice** — programmatic call control with webhooks for every call state change

## API Endpoints

- **Call Control: Answer**: `POST /v2/calls/{id}/actions/answer` — [API reference](https://developers.telnyx.com/api/call-control/answer-call)

## Webhook Events

Telnyx uses webhooks for call control — you don't poll for state. Each event tells you what happened, and your response tells Telnyx what to do next.

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):
- `call.recording.saved` — Call recording saved — URL available for download/processing

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
cd telnyx-code-examples/cloud-storage-call-archive-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (91 lines). Here's what each piece does.

### Starting the Workflow

**`create_bucket()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
try:
        resp = requests.post(f"{STORAGE_API}/buckets", headers=headers,
            json={"name": BUCKET_NAME, "region": "us-central-1"}, timeout=15)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500
@app.route("/buckets", methods=["GET"])
```

### Handling Webhooks

This is the core of the app — a state machine driven by Telnyx webhook events. Each event triggers the next step:

**`handle_recording_webhook()`** — Handles Telnyx webhook events. Routes each event type to the appropriate handler.

### Business Logic

- **`list_buckets()`** — Makes an API call and processes the response.
- **`archive_recording()`** — Makes an API call and processes the response.
- **`list_archive()`** — Handles the list archive logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/buckets` | Create Bucket |
| `POST` | `/buckets` | List Buckets |
| `POST` | `/archive` | Archive Recording |
| `POST` | `/webhooks/recording` | Telnyx webhook handler |
| `POST` | `/archive` | List Archive |
| `GET` | `/archive/search` | Search Archive |
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

- **Call Control Application** → Webhook URL → `https://<id>.ngrok.io/webhooks/voice`

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Trigger the workflow:**

```bash
curl -X POST http://localhost:5000/buckets \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125559999"
  }'
```

Or call your Telnyx number from any phone to trigger the full voice workflow.

**Check results:**

```bash
curl http://localhost:5000/archive/search | python3 -m json.tool
```

## Going to Production

This example uses in-memory storage for simplicity. For production:

- **Database** — replace the in-memory dict/list with PostgreSQL or Redis
- **Authentication** — add API key validation on your endpoints
- **Webhook verification** — validate Telnyx webhook signatures ([docs](https://developers.telnyx.com/docs/api/v2/overview#webhook-signing))
- **Error recovery** — handle call failures gracefully with retry or SMS fallback
- **Monitoring** — add structured logging and health check alerts
- **Rate limiting** — protect your endpoints from abuse

## Deploy

```bash
# Docker
docker build -t cloud-storage-call-archive-python .
docker run --env-file .env -p 5000:5000 cloud-storage-call-archive-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Call Control quickstart](https://developers.telnyx.com/docs/voice/call-control)
- [Telnyx Portal](https://portal.telnyx.com)
