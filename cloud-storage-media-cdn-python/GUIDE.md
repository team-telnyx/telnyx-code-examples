# Build a Cloud Storage Media CDN

Cloud Storage Media CDN — use Telnyx Cloud Storage as a CDN for IVR prompts, hold music, and voice assets.

## How It Works

```
  API Request
        │
        ▼
  ┌──────────────────┐
  │  Your App         │
  └────────┬─────────┘
           │
           ├──► Telnyx Cloud Storage
           ├──► Telnyx Number Porting
           ├──► Telnyx TeXML
           │
           ▼
     Email notification
     Cloud Storage upload
```

## Telnyx Products Used

- **Cloud Storage** — S3-compatible object storage for recordings and media
- **Migration**
- **Number Porting** — phone number search, purchase, and configuration
- **Voice** — programmatic call control with webhooks for every call state change

## API Endpoints

- **Upload Object**: `PUT https://storage.telnyx.com/{bucket}/{key}` — [Cloud Storage docs](https://developers.telnyx.com/docs/cloud-storage)
- **Download Object**: `GET https://storage.telnyx.com/{bucket}/{key}` — [Cloud Storage docs](https://developers.telnyx.com/docs/cloud-storage)
- **List Objects**: `GET /v2/storage/buckets/{bucket}/objects` — [API reference](https://developers.telnyx.com/api/cloud-storage/list-objects)

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
cd telnyx-code-examples/cloud-storage-media-cdn-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (84 lines). Here's what each piece does.

### Business Logic

- **`setup_bucket()`** — Makes an API call and processes the response.
- **`upload_media()`** — Makes an API call and processes the response.
- **`list_media()`** — Handles the list media logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/setup` | Setup Bucket |
| `POST` | `/upload` | Upload Media |
| `GET` | `/media` | List Media |
| `GET` | `/media/<category>/<name>` | Get Media Url |
| `GET` | `/ivr-config` | Ivr Config |
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
curl -X POST http://localhost:5000/setup \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125559999"
  }'
```

Or call your Telnyx number from any phone to trigger the full voice workflow.

**Check results:**

```bash
curl http://localhost:5000/media | python3 -m json.tool
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
docker build -t cloud-storage-media-cdn-python .
docker run --env-file .env -p 5000:5000 cloud-storage-media-cdn-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Call Control quickstart](https://developers.telnyx.com/docs/voice/call-control)
- [Telnyx Portal](https://portal.telnyx.com)
