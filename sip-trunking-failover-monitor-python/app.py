#!/usr/bin/env python3
"""SIP Trunking Failover Monitor — health-check SIP connections, auto-failover, SMS alerts."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
ALERT_NUMBER = os.getenv("ALERT_NUMBER")
PRIMARY_SIP = os.getenv("PRIMARY_SIP_CONNECTION_ID")
BACKUP_SIP = os.getenv("BACKUP_SIP_CONNECTION_ID")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
health_log = []
current_active = "primary"

def check_connection(connection_id):
    try:
        resp = requests.get(f"https://api.telnyx.com/v2/credential_connections/{connection_id}",
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}"}, timeout=10)
        if resp.ok:
            data = resp.json().get("data", {})
            return {"id": connection_id, "status": "healthy", "active": data.get("active", False)}
    except Exception:
        pass
    return {"id": connection_id, "status": "unhealthy"}

def send_alert(text):
    try:
        requests.post("https://api.telnyx.com/v2/messages", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"from": ALERT_NUMBER, "to": ALERT_NUMBER, "text": text}, timeout=10)
    except Exception as e:
        app.logger.error(f"Alert failed: {e}")

@app.route("/check", methods=["POST"])
def health_check():
    global current_active
    primary = check_connection(PRIMARY_SIP)
    backup = check_connection(BACKUP_SIP)
    entry = {"primary": primary, "backup": backup, "active": current_active, "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
    health_log.append(entry)
    if primary["status"] == "unhealthy" and current_active == "primary":
        current_active = "backup"
        send_alert(f"SIP FAILOVER: Primary trunk down, switching to backup. Check connection {PRIMARY_SIP}")
        entry["action"] = "failover_to_backup"
    elif primary["status"] == "healthy" and current_active == "backup":
        current_active = "primary"
        send_alert(f"SIP RECOVERY: Primary trunk restored, switching back from backup.")
        entry["action"] = "failback_to_primary"
    return jsonify(entry), 200

@app.route("/status", methods=["GET"])
def get_status():
    return jsonify({"active_connection": current_active, "primary_id": PRIMARY_SIP, "backup_id": BACKUP_SIP, "recent_checks": health_log[-20:]}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "active_trunk": current_active, "checks": len(health_log)}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
