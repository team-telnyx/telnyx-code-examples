# Edge Cron Scheduler — Developer Guide

This guide walks through the `edge-cron-scheduler` example, a Flask application that demonstrates how to build a cron-like job scheduler using Telnyx's communication APIs. You'll learn how the application schedules jobs, executes them, logs results, and sends failure notifications via SMS.

## Prerequisites

Before you begin, make sure you have:

- **Python 3.8+** installed
- A **Telnyx account** with an API key
- A **Telnyx phone number** (for SMS and call jobs)
- A **Telnyx Connection ID** (for call jobs)
- A **webhook endpoint** (for webhook jobs — you can use a service like webhook.site for testing)

## Project Structure

```
edge-cron-scheduler/
├── app.py              # Main application
├── requirements.txt    # Python dependencies
├── .env.example        # Environment variable template
├── README.md           # Project overview and setup
├── API.md              # API reference
└── GUIDE.md            # This guide
```

## Environment Setup

First, copy the `.env.example` file to `.env` and fill in your values:

```bash
cp .env.example .env
```

The application requires the following environment variables:

| Variable | Description |
|----------|-------------|
| `TELNYX_API_KEY` | Your Telnyx API key |
| `TELNYX_FROM_NUMBER` | Your Telnyx phone number (E.164 format) |
| `TELNYX_CONNECTION_ID` | Your Telnyx connection ID for call jobs |
| `FAILURE_NOTIFICATION_NUMBER` | Phone number to receive failure SMS alerts |
| `SAMPLE_CALL_TO_NUMBER` | Number to call for the sample call job |
| `SAMPLE_SMS_TO_NUMBER` | Number to receive the sample SMS job |
| `SAMPLE_WEBHOOK_URL` | URL for the sample webhook job |
| `DB_PATH` | (Optional) Path to SQLite database file |
| `PORT` | (Optional) Port for the Flask server (default: 5000) |

## Installation

Install the required dependencies:

```bash
pip install -r requirements.txt
```

## Running the Application

Start the application:

```bash
python app.py
```

The server will start on `http://localhost:5000` (or your configured `PORT`).

## How It Works

### 1. Application Initialization

The application starts by loading environment variables and configuring the Telnyx SDK:

```python
load_dotenv()
telnyx.api_key = os.getenv("TELNYX_API_KEY")
```

It then initializes a SQLite database for storing execution logs and creates a `CronScheduler` instance.

### 2. The Cron Scheduler

The `CronScheduler` class implements a cron-like scheduling pattern using a fluent `every()` method. This is the heart of the application:

```python
scheduler.every(5, "minutes").do({
    "name": "Daily Check-in Call",
    "type": "call",
    "to_number": os.getenv("SAMPLE_CALL_TO_NUMBER"),
    "from_number": os.getenv("TELNYX_FROM_NUMBER")
})
```

The `every()` method returns a `JobBuilder` that allows you to chain the `.do()` method to register a job. Each job is stored in two places:

- **In-memory job registry** (`JOB_REGISTRY`): Simulates a KV store for quick access
- **Scheduler's job dictionary** (`scheduler.jobs`): Used for the scheduling loop

### 3. Job Scheduling Loop

When the application starts, it launches a background thread that continuously checks for pending jobs:

```python
def run_scheduler():
    while True:
        try:
            scheduler.check_pending()
        except Exception as e:
            app.logger.exception("Scheduler error")
        time.sleep(1)
```

The `check_pending()` method (called `run_pending()` in the class) iterates through all registered jobs and executes any that are due based on their `next_run` timestamp.

### 4. Job Types

The application supports three job types, each demonstrating a different Telnyx API:

#### Call Jobs

Call jobs use the Telnyx Call API to initiate outbound calls:

```python
call = telnyx.Call.create(
    to=to_number,
    from_=from_number,
    connection_id=os.getenv("TELNYX_CONNECTION_ID"),
    timeout_secs=30
)
```

This creates a call through your Telnyx connection. The `timeout_secs` parameter controls how long Telnyx will attempt to connect the call.

#### SMS Jobs

SMS jobs use the Telnyx Messaging API to send text messages:

```python
message = telnyx.Message.create(
    from_=from_number,
    to=to_number,
    text=message_text
)
```

The `Message.create()` method sends an SMS through Telnyx's messaging infrastructure.

#### Webhook Jobs

Webhook jobs make HTTP POST requests to a specified URL:

```python
response = requests.post(
    webhook_url,
    json=payload,
    timeout=30,
    headers={"Content-Type": "application/json"}
)
```

These are useful for triggering external services or integrations.

### 5. Execution Logging

Every job execution is logged to a SQLite database:

```python
def log_execution(job_id, job_name, job_type, status, details=None):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO execution_logs (job_id, job_name, job_type, executed_at, status, details) VALUES (?, ?, ?, ?, ?, ?)",
        (job_id, job_name, job_type, datetime.utcnow().isoformat(), status, json.dumps(details) if details else None)
    )
    conn.commit()
    conn.close()
```

This provides a persistent record of all job executions, including success/failure status and any relevant details (like call IDs or message IDs).

### 6. Failure Notifications

When a job fails, the application sends an SMS notification to a configured number:

```python
def send_sms_failure_notification(job_id, job_name, error_message):
    message = f"Job {job_name} ({job_id}) failed: {error_message}"
    telnyx.Message.create(
        from_=from_number,
        to=to_number,
        text=message
    )
```

This ensures you're immediately alerted when something goes wrong with your scheduled jobs.

### 7. REST API Endpoints

The application exposes several REST endpoints for managing jobs:

- **`GET /health`** — Health check endpoint
- **`GET /jobs`** — List all registered jobs
- **`POST /jobs`** — Create a new job
- **`DELETE /jobs/<job_id>`** — Delete a job
- **`POST /jobs/<job_id>/run`** — Run a job immediately
- **`GET /executions`** — View execution logs
- **`POST /webhooks/telnyx`** — Handle Telnyx webhooks

### 7. Creating Jobs via API

You can create new jobs dynamically via the API. For example, to create a new SMS job:

```bash
curl -X POST http://localhost:5000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Weekly Report",
    "type": "sms",
    "interval": 7,
    "unit": "days",
    "to_number": "+15551234567",
    "message": "Your weekly report is ready!"
  }'
```

The API validates the job type and required fields before registering it with the scheduler.

### 8. Telnyx Webhook Handling

The application includes a webhook endpoint for receiving Telnyx events. It verifies the Ed25519 signature to ensure the request is genuinely from Telnyx:

```python
event = telnyx.webhooks.unwrap(
    request.data,
    request.headers.get("Telnyx-Signature-Ed25519"),
    request.headers.get("Telnyx-Timestamp")
)
```

This is crucial for security — it prevents attackers from sending fake webhook events to your application.

## Sample Jobs

The application registers three sample jobs on startup:

1. **Daily Check-in Call** — Calls a number every 5 minutes
2. **Hourly Reminder SMS** — Sends a reminder text every hour
3. **Webhook Health Check** — Hits a webhook every 30 minutes

These demonstrate the three job types and give you a starting point for creating your own.

## Testing the Application

### Test the Health Endpoint

```bash
curl http://localhost:5000/health
```

### List Registered Jobs

```bash
curl http://localhost:5000/jobs
```

### Run a Job Immediately

```bash
curl -X POST http://localhost:5000/jobs/job_1/run
```

### View Execution Logs

```bash
curl http://localhost:5000/executions
```

## Troubleshooting

### Jobs aren't executing

- Check that the scheduler thread is running (look for "Scheduler error" in logs)
- Verify your Telnyx API key is valid
- Check that job intervals are set correctly

### SMS messages aren't sending

- Verify `TELNYX_FROM_NUMBER` is a valid Telnyx number
- Check that `SAMPLE_SMS_TO_NUMBER` is in E.164 format (e.g., `+15551234567`)
- Review the execution logs for error details

### Call jobs fail

- Ensure `TELNYX_CONNECTION_ID` is correct
- Verify the phone numbers are in E.164 format
- Check that your Telnyx account has sufficient balance

## Next Steps

Now that you understand how the edge cron scheduler works, here are some ideas for extending it:

- **Add more job types** — Integrate other Telnyx APIs like TeXML or Fax
- **Implement persistent KV storage** — Replace the in-memory registry with Redis or another KV store
- **Add authentication** — Protect the REST API with API keys or JWT tokens
- **Add retry logic** — Automatically retry failed jobs with exponential backoff
- **Create a dashboard** — Build a UI to visualize job execution history

## Resources

- [Telnyx API Documentation](https://developers.telnyx.com/docs/api/v2/overview)
- [Telnyx Messaging API](https://developers.telnyx.com/docs/api/v2/messaging)
- [Telnyx Call Control API](https://developers.telnyx.com/docs/api/v2/call-control)
- [Telnyx Webhooks](https://developers.telnyx.com/docs/api/v2/webhooks)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)

---

This example demonstrates how to build a production-ready cron scheduler using Telnyx's communication APIs. The combination of scheduled jobs, execution logging, and failure notifications makes it easy to build reliable automation workflows.
