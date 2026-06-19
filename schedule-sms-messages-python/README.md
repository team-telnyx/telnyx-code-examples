# Scheduled SMS with Python and Flask

## What Does This Example Do?

Build a production-ready Flask application that schedules SMS messages to be sent at specific times using the Telnyx Python SDK. This tutorial demonstrates how to integrate a task scheduler with Telnyx's messaging API, manage scheduled jobs, and handle delivery confirmations via webhooks. You'll learn to queue messages, track their status, and gracefully handle failures in a real-world scheduling system.

## Who Is This For?

- **Python developers** building sms features with Flask.
- **Backend engineers** integrating telephony or messaging into existing applications.
- **DevOps teams** looking for containerized, production-ready telecom examples.
- **Startups and enterprises** replacing legacy telecom providers with a modern API-first platform.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform that gives developers a single API for [voice](https://telnyx.com/products/voice-ai-agents), [messaging](https://telnyx.com/products/sms-api), [SIP](https://telnyx.com/products/sip-trunks), [AI](https://telnyx.com/ai-assistants), and [IoT](https://telnyx.com/products/iot-sim-card) — no Frankenstack required.

- **Integrated platform** — [Voice](https://telnyx.com/products/voice-ai-agents), [SMS](https://telnyx.com/products/sms-api), [SIP trunking](https://telnyx.com/products/sip-trunks), [AI assistants](https://telnyx.com/ai-assistants), and [IoT SIM management](https://telnyx.com/products/iot-sim-card) under one roof. No stitching together multiple vendors.
- **Global private network** — Calls and messages traverse the Telnyx-owned IP network for lower latency and higher reliability than the public internet.
- **Developer-first** — SDKs for Python, Node.js, Go, Ruby, Java, and PHP. Comprehensive webhook event model. Sandbox environment for testing.
- **Competitive pricing** — Pay-as-you-go with no minimums, contracts, or per-seat fees.

## Prerequisites

- Python 3.8 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for outbound SMS.
- pip (Python package manager).
- Basic familiarity with Flask and background task scheduling.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/schedule-sms-messages-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/schedule-sms-messages-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` with the Flask application, Telnyx client initialization, and scheduled job management:

```python
import os
import telnyx
from datetime import datetime, timedelta
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.date import DateTrigger
import logging

load_dotenv()

app = Flask(__name__)

# Initialize Telnyx client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# Initialize APScheduler for background job execution
scheduler = BackgroundScheduler()
scheduler.start()

# In-memory store for scheduled jobs (use a database in production)
scheduled_jobs = {}

# Configure logging for debugging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def send_scheduled_sms(job_id: str, to_number: str, message: str) -> None:
    """
    Send SMS at scheduled time.
    
    This function is executed by the scheduler at the specified time.
    It updates the job status and handles errors gracefully.
    """
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    
    try:
        response = client.messages.create(
            from_=from_number,
            to=to_number,
            text=message,
        )
        
        # Update job status to sent
        if job_id in scheduled_jobs:
            scheduled_jobs[job_id]["status"] = "sent"
            scheduled_jobs[job_id]["message_id"] = response.data.id
            scheduled_jobs[job_id]["sent_at"] = datetime.utcnow().isoformat()
            logger.info(f"Scheduled SMS job {job_id} sent successfully")
        
    except telnyx.AuthenticationError:
        logger.error(f"Authentication failed for job {job_id}")
        if job_id in scheduled_jobs:
            scheduled_jobs[job_id]["status"] = "failed"
            scheduled_jobs[job_id]["error"] = "Authentication error"
            
    except telnyx.RateLimitError:
        logger.warning(f"Rate limit hit for job {job_id}, will retry")
        if job_id in scheduled_jobs:
            scheduled_jobs[job_id]["status"] = "rate_limited"
            
    except telnyx.APIStatusError as e:
        logger.error(f"API error for job {job_id}: {str(e)}")
        if job_id in scheduled_jobs:
            scheduled_jobs[job_id]["status"] = "failed"
            scheduled_jobs[job_id]["error"] = f"API error: {e.status_code}"
            
    except telnyx.APIConnectionError:
        logger.error(f"Connection error for job {job_id}")
        if job_id in scheduled_jobs:
            scheduled_jobs[job_id]["status"] = "failed"
            scheduled_jobs[job_id]["error"] = "Network connection error"


@app.route("/sms/schedule", methods=["POST"])
def schedule_sms():
    """
    Schedule an SMS to be sent at a future time.
    
    Request body:
    {
        "to": "+15559876543",
        "message": "Your scheduled message",
        "send_at": "2026-06-18T14:30:00Z"
    }
    """
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    to_number = data.get("to")
    message = data.get("message")
    send_at = data.get("send_at")
    
    if not to_number or not message or not send_at:
        return jsonify({
            "error": "Missing required fields: 'to', 'message', and 'send_at'"
        }), 400
    
    # Validate E.164 format
    if not to_number.startswith("+"):
        return jsonify({
            "error": "Phone number must be in E.164 format (e.g., +15551234567)"
        }), 400
    
    try:
        # Parse ISO 8601 datetime string
        scheduled_time = datetime.fromisoformat(send_at.replace("Z", "+00:00"))
        
        # Validate that scheduled time is in the future
        if scheduled_time <= datetime.utcnow():
            return jsonify({
                "error": "Scheduled time must be in the future"
            }), 400
        
        # Generate unique job ID
        job_id = f"sms_{int(datetime.utcnow().timestamp() * 1000)}"
        
        # Schedule the job using APScheduler
        scheduler.add_job(
            send_scheduled_sms,
            trigger=DateTrigger(run_date=scheduled_time),
            args=[job_id, to_number, message],
            id=job_id,
            replace_existing=False,
        )
        
        # Store job metadata in memory
        scheduled_jobs[job_id] = {
            "id": job_id,
            "to": to_number,
            "message": message,
            "scheduled_for": send_at,
            "status": "scheduled",
            "created_at": datetime.utcnow().isoformat(),
        }
        
        logger.info(f"SMS scheduled with job ID {job_id} for {send_at}")
        
        return jsonify({
            "job_id": job_id,
            "status": "scheduled",
            "scheduled_for": send_at,
            "to": to_number,
        }), 201
        
    except ValueError as e:
        return jsonify({
            "error": f"Invalid datetime format: {str(e)}"
        }), 400


@app.route("/sms/scheduled/<job_id>", methods=["GET"])
def get_scheduled_job(job_id: str):
    """Retrieve the status of a scheduled SMS job."""
    if job_id not in scheduled_jobs:
        return jsonify({"error": "Job not found"}), 404
    
    job = scheduled_jobs[job_id]
    return jsonify(job), 200


@app.route("/sms/scheduled", methods=["GET"])
def list_scheduled_jobs():
    """List all scheduled SMS jobs."""
    jobs_list = [
        {
            "id": job["id"],
            "to": job["to"],
            "status": job["status"],
            "scheduled_for": job["scheduled_for"],
            "created_at": job["created_at"],
        }
        for job in scheduled_jobs.values()
    ]
    return jsonify(jobs_list), 200


@app.route("/sms/scheduled/<job_id>", methods=["DELETE"])
def cancel_scheduled_job(job_id: str):
    """Cancel a scheduled SMS job before it is sent."""
    if job_id not in scheduled_jobs:
        return jsonify({"error": "Job not found"}), 404
    
    job = scheduled_jobs[job_id]
    
    # Prevent cancellation of already-sent messages
    if job["status"] in ["sent", "failed"]:
        return jsonify({
            "error": f"Cannot cancel job with status '{job['status']}'"
        }), 400
    
    try:
        # Remove the job from the scheduler
        scheduler.remove_job(job_id)
        job["status"] = "cancelled"
        job["cancelled_at"] = datetime.utcnow().isoformat()
        
        logger.info(f"Scheduled SMS job {job_id} cancelled")
        
        return jsonify({
            "id": job_id,
            "status": "cancelled",
            "cancelled_at": job["cancelled_at"],
        }), 200
        
    except Exception as e:
        logger.error(f"Error cancelling job {job_id}: {str(e)}")
        return jsonify({"error": "Failed to cancel job"}), 500


@app.errorhandler(Exception)
def handle_error(error):
    """Global error handler for unhandled exceptions."""
    logger.error(f"Unhandled exception: {str(error)}")
    return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Job not executing at scheduled time | The scheduled SMS is not sent when the scheduled time arrives, and the job status remains "scheduled". | Verify that the Flask application is still running and the APScheduler background thread has not crashed. Check the application logs for errors. Ensure the scheduled time is in ISO 8601 format with timezone information (e.g., `2026-06-18T14:30:00Z`). For development, use a time within the next few minutes to test quickly. |
| "Scheduled time must be in the future" error | The endpoint returns a 400 error when scheduling an SMS, even though the provided time appears to be in the future. | Verify that your system clock is synchronized correctly. The server compares the scheduled time against `datetime.utcnow()`, so clock skew will cause validation failures. Use a time at least 1 minute in the future to account for processing delays. Ensure the datetime string includes timezone information (Z for UTC or ±HH:MM offset). |
| Job status shows "failed" with "Authentication error" | The scheduled SMS job executes but fails with an authentication error, and the job status is set to "failed". | Verify that your `TELNYX_API_KEY` in the `.env` file is correct and has not expired. Regenerate the API key in the [Telnyx Portal](https://portal.telnyx.com) if needed. Restart the Flask application after updating the `.env` file to ensure the new key is loaded. Check that the key has permissions for sending SMS messages. |
| APScheduler jobs persist after application restart | Scheduled jobs are lost when the Flask application is restarted because they are stored only in memory. | This is expected behavior with APScheduler's in-memory job store. For production systems, integrate a persistent job store such as SQLAlchemy (database-backed) or use a dedicated task queue like Celery with Redis. Implement a database schema to store scheduled jobs and restore them on application startup. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What Python version do I need?**

Python 3.8 or higher. Python 3.12+ is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)

## Related Examples

- [Send Bulk SMS Messages](/tutorials/sms/python/send-bulk-sms).
- [Receive SMS Webhooks with Python](/tutorials/sms/python/receive-sms-webhook).
- [Implement Two-Factor Authentication with SMS](/tutorials/sms/python/otp-2fa).
