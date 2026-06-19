# Schedule SMS Messages with Telnyx and Python

Build a Flask service that accepts a message plus a future timestamp, queues it with an in-process scheduler, and sends it through the Telnyx Messaging API when the time arrives — with endpoints to inspect and cancel pending jobs.

## How It Works

```
  POST /sms/schedule  ──►  Flask stores job metadata + registers an APScheduler DateTrigger
                                                     │
                          (run_date reached)         ▼
                          APScheduler calls send_scheduled_sms ──► POST /v2/messages ──► SMS delivered
```

There are no inbound webhooks. The scheduler lives in the same process as the Flask app, so the app must stay running for queued jobs to fire.

## Telnyx Products Used

- **Messaging** — outbound SMS via `POST /v2/messages`, called through the Python SDK's `client.messages.create(...)`.

## API Endpoints

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)

## Prerequisites

- Python 3.8+ (3.12+ recommended)
- A [Telnyx account](https://portal.telnyx.com/sign-up) with a funded balance
- A [Telnyx API key](https://portal.telnyx.com/api-keys)
- A [Telnyx phone number](https://portal.telnyx.com/numbers/my-numbers) enabled for outbound SMS

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/schedule-sms-messages-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` and set `TELNYX_API_KEY` and `TELNYX_PHONE_NUMBER`.

## Step 2: Understand the Code

Everything lives in `app.py`. There are four parts.

### Initialization

The Telnyx SDK client and an APScheduler `BackgroundScheduler` are created at startup. Job metadata is kept in an in-memory dict:

```python
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

scheduler = BackgroundScheduler()
scheduler.start()

scheduled_jobs = {}
```

### The scheduled worker

`send_scheduled_sms` is what APScheduler runs at the chosen time. It sends the message and updates the stored status, catching auth, API, rate-limit, and network errors so a single failure never crashes the scheduler thread:

```python
def send_scheduled_sms(job_id: str, to_number: str, message: str) -> None:
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    try:
        response = client.messages.create(from_=from_number, to=to_number, text=message)
        if job_id in scheduled_jobs:
            scheduled_jobs[job_id]["status"] = "sent"
            scheduled_jobs[job_id]["message_id"] = response.data.id
            scheduled_jobs[job_id]["sent_at"] = datetime.utcnow().isoformat()
    except telnyx.AuthenticationError:
        ...
```

### Scheduling endpoint

`POST /sms/schedule` validates the body, requires an E.164 `to`, parses `send_at`, rejects past times, then registers a one-shot `DateTrigger` job and records metadata:

```python
scheduled_time = datetime.fromisoformat(send_at.replace("Z", "+00:00"))
if scheduled_time <= datetime.utcnow():
    return jsonify({"error": "Scheduled time must be in the future"}), 400

job_id = f"sms_{int(datetime.utcnow().timestamp() * 1000)}"
scheduler.add_job(
    send_scheduled_sms,
    trigger=DateTrigger(run_date=scheduled_time),
    args=[job_id, to_number, message],
    id=job_id,
    replace_existing=False,
)
```

### Inspection and cancellation

`GET /sms/scheduled/<job_id>` and `GET /sms/scheduled` read the metadata store; `DELETE /sms/scheduled/<job_id>` removes the job from the scheduler (unless it has already `sent`/`failed`).

## Step 3: Run It

```bash
python app.py
```

The server starts on `http://localhost:5000`. Keep it running so queued jobs can fire.

## Step 4: Test It

Schedule a message a minute or two out (use a UTC ISO 8601 timestamp):

```bash
curl -X POST http://localhost:5000/sms/schedule \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+15559876543",
    "message": "Hello from the future",
    "send_at": "2026-06-18T14:30:00Z"
  }'
```

Check its status:

```bash
curl http://localhost:5000/sms/scheduled/<job_id>
```

Cancel it before it sends:

```bash
curl -X DELETE http://localhost:5000/sms/scheduled/<job_id>
```

## Going to Production

This example uses in-memory storage for simplicity. For production:

- **Persistent job store** — replace the in-memory dict and default APScheduler store with a database-backed job store (SQLAlchemy) or a task queue (Celery + Redis), so jobs survive restarts.
- **Authentication** — add API-key validation on the scheduling endpoints.
- **Multiple workers** — the in-process scheduler does not coordinate across processes; pick a shared store before scaling horizontally.
- **Monitoring** — add structured logging and alerting on failed jobs.
- **Rate limiting** — protect the endpoints from abuse.

## Resources

- [Source code and reference](./README.md)
- [Typed endpoint reference](./API.md)
- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send a Message — API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
