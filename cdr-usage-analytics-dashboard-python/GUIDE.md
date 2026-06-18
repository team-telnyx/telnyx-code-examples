# Build a CDR Usage Analytics Dashboard

Pull Call Detail Records, build usage analytics with cost breakdowns, peak-hour analysis, and AI-powered insights.

## How It Works

```
  API Request
        │
        ▼
  ┌──────────────────┐
  │  Your App         │
  └────────┬─────────┘
           │
           ├──► Telnyx AI Inference (LLM)
           ├──► Telnyx Call Recording
           ├──► Telnyx Number Porting
           │
           ▼
     Report / export
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
cd telnyx-code-examples/cdr-usage-analytics-dashboard-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (113 lines). Here's what each piece does.

### Business Logic

- **`fetch_cdrs()`** — Makes an API call and processes the response.
- **`get_cdrs()`** — Handles the get cdrs logic.
- **`usage_summary()`** — Handles the usage summary logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/cdrs` | Get Cdrs |
| `GET` | `/analytics/summary` | Usage Summary |
| `GET` | `/analytics/peak-hours` | Peak Hours |
| `GET` | `/analytics/top-routes` | Top Routes |
| `GET` | `/analytics/ai-insights` | Ai Insights |
| `GET` | `/analytics/daily` | Daily Breakdown |
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

**Check results:**

```bash
curl http://localhost:5000/cdrs | python3 -m json.tool
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
docker build -t cdr-usage-analytics-dashboard-python .
docker run --env-file .env -p 5000:5000 cdr-usage-analytics-dashboard-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
