# Build a TeXML Dynamic Call Router

TeXML Dynamic Call Router — time-of-day and caller-based routing with TeXML responses.

## How It Works

```
Inbound SMS ──► Webhook ──► Your App
                                │
                           Process Message
                                │
                           Reply SMS
```

## Telnyx Products Used

- **Migration**
- **Number Porting** — phone number search, purchase, and configuration
- **Voice** — programmatic call control with webhooks for every call state change

## API Endpoints

- **TeXML Webhooks**: Telnyx sends HTTP requests to your TeXML endpoints — [TeXML docs](https://developers.telnyx.com/docs/voice/texml)
- **TeXML Dial**: Route calls to SIP, PSTN, or conference — [reference](https://developers.telnyx.com/docs/voice/texml/verbs/dial)
- **TeXML Gather**: Collect DTMF or speech input — [reference](https://developers.telnyx.com/docs/voice/texml/verbs/gather)
- **TeXML Say**: Text-to-speech — [reference](https://developers.telnyx.com/docs/voice/texml/verbs/say)

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
cd telnyx-code-examples/texml-dynamic-call-router-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (57 lines). Here's what each piece does.

### Business Logic

- **`route_call()`** — Handles the route call logic.
- **`handle_recording()`** — Handles the handle recording logic.
- **`add_vip()`** — Handles the add vip logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/texml/route` | Route Call |
| `POST` | `/texml/recording` | Handle Recording |
| `POST` | `/vip` | Add Vip |
| `GET` | `/calls` | List Calls |
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
curl -X POST http://localhost:5000/texml/route \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125559999"
  }'
```

Or call your Telnyx number from any phone to trigger the full voice workflow.

**Check results:**

```bash
curl http://localhost:5000/calls | python3 -m json.tool
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
docker build -t texml-dynamic-call-router-python .
docker run --env-file .env -p 5000:5000 texml-dynamic-call-router-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Call Control quickstart](https://developers.telnyx.com/docs/voice/call-control)
- [Telnyx Portal](https://portal.telnyx.com)
