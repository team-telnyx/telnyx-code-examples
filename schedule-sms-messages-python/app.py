#!/usr/bin/env python3
"""Production-ready Flask application for scheduling SMS via Telnyx."""

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
            "error": "Invalid datetime format"
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
