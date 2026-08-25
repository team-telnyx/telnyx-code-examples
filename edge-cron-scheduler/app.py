import os
import json
import time
import uuid
import sqlite3
from datetime import datetime, timedelta
from functools import wraps

from dotenv import load_dotenv
from flask import Flask, request, jsonify
import telnyx
import requests

load_dotenv()

app = Flask(__name__)

# Configure Telnyx
telnyx.api_key = os.getenv("TELNYX_API_KEY")

# Job registry stored in KV (in-memory dict simulating KV store)
JOB_REGISTRY = {}
JOB_REGISTRY_KEY = "job_registry"

# SQLite database for execution logs
DB_PATH = os.getenv("DB_PATH", "execution_logs.db")

def init_db():
    """Initialize SQLite database for execution logs."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS execution_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL,
            job_name TEXT NOT NULL,
            job_type TEXT NOT NULL,
            executed_at TEXT NOT NULL,
            status TEXT NOT NULL,
            details TEXT
        )
    """)
    conn.commit()
    conn.close()

def log_execution(job_id, job_name, job_type, status, details=None):
    """Log job execution to SQLite database."""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO execution_logs (job_id, job_name, job_type, executed_at, status, details) VALUES (?, ?, ?, ?, ?, ?)",
            (job_id, job_name, job_type, datetime.utcnow().isoformat(), status, json.dumps(details) if details else None)
        )
        conn.commit()
        conn.close()
    except Exception as e:
        app.logger.exception("Failed to log execution to database")

def send_sms_failure_notification(job_id, job_name, error_message):
    """Send SMS notification when a job fails."""
    try:
        to_number = os.getenv("FAILURE_NOTIFICATION_NUMBER")
        from_number = os.getenv("TELNYX_FROM_NUMBER")
        if not to_number or not from_number:
            app.logger.warning("Failure notification numbers not configured, skipping SMS")
            return
        
        message = f"Job {job_name} ({job_id}) failed: {error_message}"
        telnyx.Message.create(
            from_=from_number,
            to=to_number,
            text=message
        )
        app.logger.info(f"Failure notification SMS sent for job {job_id}")
    except Exception as e:
        app.logger.exception("Failed to send failure notification SMS")

def execute_job(job):
    """Execute a job based on its type."""
    job_type = job.get("type")
    job_id = job.get("id")
    job_name = job.get("name")
    
    try:
        if job_type == "call":
            # Execute a call job
            to_number = job.get("to_number")
            from_number = job.get("from_number") or os.getenv("TELNYX_FROM_NUMBER")
            if not to_number or not from_number:
                raise ValueError("Call job requires to_number and from_number")
            
            call = telnyx.Call.create(
                to=to_number,
                from_=from_number,
                connection_id=os.getenv("TELNYX_CONNECTION_ID"),
                timeout_secs=30
            )
            log_execution(job_id, job_name, job_type, "success", {"call_id": call.id})
            return {"status": "success", "call_id": call.id}
            
        elif job_type == "sms":
            # Execute an SMS job
            to_number = job.get("to_number")
            from_number = job.get("from_number") or os.getenv("TELNYX_FROM_NUMBER")
            message_text = job.get("message")
            if not to_number or not from_number or not message_text:
                raise ValueError("SMS job requires to_number, from_number, and message")
            
            message = telnyx.Message.create(
                from_=from_number,
                to=to_number,
                text=message_text
            )
            log_execution(job_id, job_name, job_type, "success", {"message_id": message.id})
            return {"status": "success", "message_id": message.id}
            
        elif job_type == "webhook":
            # Execute a webhook job
            webhook_url = job.get("webhook_url")
            payload = job.get("payload", {})
            if not webhook_url:
                raise ValueError("Webhook job requires webhook_url")
            
            response = requests.post(
                webhook_url,
                json=payload,
                timeout=30,
                headers={"Content-Type": "application/json"}
            )
            response.raise_for_status()
            log_execution(job_id, job_name, job_type, "success", {"status_code": response.status_code})
            return {"status": "success", "status_code": response.status_code}
        else:
            raise ValueError(f"Unknown job type: {job_type}")
            
    except Exception as e:
        app.logger.exception(f"Job {job_id} ({job_name}) failed")
        log_execution(job_id, job_name, job_type, "failed", str(e))
        send_sms_failure_notification(job_id, job_name, str(e))
        return {"status": "failed", "error": "Job execution failed"}

class CronScheduler:
    """Cron-like scheduler using this.every() pattern."""
    
    def __init__(self):
        self.jobs = {}
        self.running = False
    
    def every(self, interval, unit="seconds"):
        """Schedule a job to run every interval."""
        scheduler = self
        class JobBuilder:
            def __init__(self, scheduler, interval, unit):
                self.scheduler = scheduler
                self.interval = interval
                self.unit = unit
            
            def do(self, job):
                """Register the job to run at the specified interval."""
                job_id = job.get("id") or f"job_{len(self.scheduler.jobs) + 1}"
                job["id"] = job_id
                job["interval"] = self.interval
                job["unit"] = self.unit
                job["next_run"] = datetime.utcnow()
                self.scheduler.jobs[job_id] = job
                JOB_REGISTRY[job_id] = job
                return job_id
        
        return JobBuilder(self, interval, unit)
    
    def run_pending(self):
        """Check and execute any jobs that are due."""
        now = datetime.utcnow()
        for job_id, job in list(self.jobs.items()):
            if job.get("next_run") and now >= job["next_run"]:
                app.logger.info(f"Executing job {job_id}: {job.get('name')}")
                result = execute_job(job)
                app.logger.info(f"Job {job_id} result: {result}")
                
                # Calculate next run time
                interval = job.get("interval", 60)
                unit = job.get("unit", "seconds")
                if unit == "seconds":
                    next_run = now + timedelta(seconds=interval)
                elif unit == "minutes":
                    next_run = now + timedelta(minutes=interval)
                elif unit == "hours":
                    next_run = now + timedelta(hours=interval)
                elif unit == "days":
                    next_run = now + timedelta(days=interval)
                else:
                    next_run = now + timedelta(seconds=interval)
                
                job["next_run"] = next_run
                JOB_REGISTRY[job_id] = job

# Initialize scheduler
scheduler = CronScheduler()

# Initialize database
init_db()

# Register sample jobs
def register_sample_jobs():
    """Register sample jobs for demonstration."""
    # Call job - call a number every 5 minutes
    scheduler.every(5, "minutes").do({
        "name": "Daily Check-in Call",
        "type": "call",
        "to_number": os.getenv("SAMPLE_CALL_TO_NUMBER", ""),
        "from_number": os.getenv("TELNYX_FROM_NUMBER", "")
    })
    
    # SMS job - send a message every hour
    scheduler.every(1, "hours").do({
        "name": "Hourly Reminder SMS",
        "type": "sms",
        "to_number": os.getenv("SAMPLE_SMS_TO_NUMBER", ""),
        "from_number": os.getenv("TELNYX_FROM_NUMBER", ""),
        "message": "This is a scheduled reminder from your edge cron scheduler."
    })
    
    # Webhook job - hit a webhook every 30 minutes
    scheduler.every(30, "minutes").do({
        "name": "Webhook Health Check",
        "type": "webhook",
        "webhook_url": os.getenv("SAMPLE_WEBHOOK_URL", ""),
        "payload": {"source": "edge-cron-scheduler", "timestamp": datetime.utcnow().isoformat()}
    })

# Register sample jobs on startup
register_sample_jobs()

@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint."""
    return jsonify({"status": "healthy", "timestamp": datetime.utcnow().isoformat()})

@app.route("/jobs", methods=["GET"])
def list_jobs():
    """List all registered jobs."""
    jobs = []
    for job_id, job in JOB_REGISTRY.items():
        jobs.append({
            "id": job_id,
            "name": job.get("name"),
            "type": job.get("type"),
            "interval": job.get("interval"),
            "unit": job.get("unit"),
            "next_run": job.get("next_run").isoformat() if job.get("next_run") else None
        })
    return jsonify({"jobs": jobs})

@app.route("/jobs", methods=["POST"])
def create_job():
    """Create a new job."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request body"}), 400
    
    required_fields = ["name", "type", "interval", "unit"]
    for field in required_fields:
        if field not in data:
            return jsonify({"error": f"Missing required field: {field}"}), 400
    
    job_type = data["type"]
    if job_type not in ["call", "sms", "webhook"]:
        return jsonify({"error": "Invalid job type. Must be 'call', 'sms', or 'webhook'"}), 400
    
    job = {
        "name": data["name"],
        "type": job_type,
        "interval": data["interval"],
        "unit": data["unit"]
    }
    
    # Add type-specific fields
    if job_type == "call":
        job["to_number"] = data.get("to_number")
        job["from_number"] = data.get("from_number")
    elif job_type == "sms":
        job["to_number"] = data.get("to_number")
        job["from_number"] = data.get("from_number")
        job["message"] = data.get("message")
    elif job_type == "webhook":
        job["webhook_url"] = data.get("webhook_url")
        job["payload"] = data.get("payload", {})
    
    # Validate type-specific required fields
    if job_type == "call" and not job.get("to_number"):
        return jsonify({"error": "Call jobs require to_number"}), 400
    if job_type == "sms" and (not job.get("to_number") or not job.get("message")):
        return jsonify({"error": "SMS jobs require to_number and message"}), 400
    if job_type == "webhook" and not job.get("webhook_url"):
        return jsonify({"error": "Webhook jobs require webhook_url"}), 400
    
    job_id = scheduler.every(data["interval"], data["unit"]).do(job)
    return jsonify({"id": job_id, "message": "Job created successfully"}), 201

@app.route("/jobs/<job_id>", methods=["DELETE"])
def delete_job(job_id):
    """Delete a job."""
    if job_id not in scheduler.jobs:
        return jsonify({"error": "Job not found"}), 404
    
    del scheduler.jobs[job_id]
    if job_id in JOB_REGISTRY:
        del JOB_REGISTRY[job_id]
    
    return jsonify({"message": "Job deleted successfully"})

@app.route("/jobs/<job_id>/run", methods=["POST"])
def run_job_now(job_id):
    """Run a job immediately."""
    if job_id not in scheduler.jobs:
        return jsonify({"error": "Job not found"}), 404
    
    job = scheduler.jobs[job_id]
    result = execute_job(job)
    return jsonify(result)

@app.route("/executions", methods=["GET"])
def list_executions():
    """List execution logs."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM execution_logs ORDER BY executed_at DESC LIMIT 100")
    rows = cursor.fetchall()
    conn.close()
    
    executions = []
    for row in rows:
        executions.append({
            "id": row[0],
            "job_id": row[1],
            "job_name": row[2],
            "job_type": row[3],
            "executed_at": row[4],
            "status": row[5],
            "details": json.loads(row[6]) if row[6] else None
        })
    
    return jsonify({"executions": executions})

@app.route("/webhooks/telnyx", methods=["POST"])
def telnyx_webhook():
    """Handle Telnyx webhooks."""
    try:
        # Verify the webhook signature
        event = telnyx.webhooks.unwrap(request.data, request.headers.get("Telnyx-Signature-Ed25519"), request.headers.get("Telnyx-Timestamp"))
        
        # Process the event
        event_type = event.get("data", {}).get("event_type")
        payload = event.get("data", {}).get("payload", {})
        
        app.logger.info(f"Received Telnyx webhook: {event_type}")
        
        # Handle specific event types
        if event_type == "message.received":
            # Handle incoming message
            message_text = payload.get("text")
            from_number = payload.get("from", {}).get("phone_number")
            app.logger.info("Received inbound message")
        
        return jsonify({"status": "received"}), 200
    except Exception as e:
        app.logger.exception("Failed to process webhook")
        return jsonify({"error": "Invalid webhook signature"}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Resource not found"}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "Internal server error"}), 500

if __name__ == "__main__":
    # Run the scheduler in a background thread
    import threading
    import time
    
    def run_scheduler():
        while True:
            try:
                scheduler.check_pending()
            except Exception as e:
                app.logger.exception("Scheduler error")
            time.sleep(1)
    
    scheduler_thread = threading.Thread(target=run_scheduler, daemon=True)
    scheduler_thread.start()
    
    # Run the Flask app
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)), debug=False)
