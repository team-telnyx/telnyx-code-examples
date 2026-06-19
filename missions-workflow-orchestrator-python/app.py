#!/usr/bin/env python3
"""Missions Workflow Orchestrator — create and manage multi-step mission workflows using the Telnyx Missions API."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
API = "https://api.telnyx.com/v2"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}
local_missions = []

@app.route("/missions", methods=["POST"])
def create_mission():
    data = request.get_json()
    try:
        resp = requests.post(f"{API}/missions", headers=headers,
            json={"name": data.get("name"), "description": data.get("description"),
                "status": data.get("status", "draft"),
                "tasks": data.get("tasks", [])})
        result = resp.json()
        local_missions.append(result)
        return jsonify(result), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to create mission")
        return jsonify({"error": "could not create mission"}), 500

@app.route("/missions", methods=["GET"])
def list_missions():
    try:
        resp = requests.get(f"{API}/missions", headers=headers, timeout=15)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to list missions")
        return jsonify({"error": "could not list missions", "local": local_missions}), 500

@app.route("/missions/<mission_id>", methods=["GET"])
def get_mission(mission_id):
    try:
        resp = requests.get(f"{API}/missions/{mission_id}", headers=headers, timeout=15)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to get mission")
        return jsonify({"error": "could not retrieve mission"}), 500

@app.route("/missions/<mission_id>/tasks", methods=["POST"])
def add_task(mission_id):
    data = request.get_json()
    try:
        resp = requests.post(f"{API}/missions/{mission_id}/tasks", headers=headers,
            json={"name": data.get("name"), "type": data.get("type", "action"),
                "config": data.get("config", {}), "depends_on": data.get("depends_on", [])})
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to add task to mission")
        return jsonify({"error": "could not add task"}), 500

@app.route("/missions/<mission_id>/run", methods=["POST"])
def run_mission(mission_id):
    try:
        resp = requests.post(f"{API}/missions/{mission_id}/runs", headers=headers, json={}, timeout=15)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to run mission")
        return jsonify({"error": "could not start mission run"}), 500

@app.route("/missions/<mission_id>/runs", methods=["GET"])
def list_runs(mission_id):
    try:
        resp = requests.get(f"{API}/missions/{mission_id}/runs", headers=headers, timeout=15)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to list mission runs")
        return jsonify({"error": "could not list mission runs"}), 500

@app.route("/templates", methods=["GET"])
def mission_templates():
    return jsonify({"templates": [
        {"name": "Customer Onboarding", "tasks": [
            {"name": "provision_number", "type": "api_call", "config": {"endpoint": "/v2/number_orders"}},
            {"name": "send_welcome_sms", "type": "api_call", "config": {"endpoint": "/v2/messages"}, "depends_on": ["provision_number"]},
            {"name": "setup_voice", "type": "api_call", "config": {"endpoint": "/v2/calls"}, "depends_on": ["provision_number"]}]},
        {"name": "Number Migration", "tasks": [
            {"name": "submit_port", "type": "api_call", "config": {"endpoint": "/v2/porting_orders"}},
            {"name": "verify_status", "type": "webhook_wait", "depends_on": ["submit_port"]},
            {"name": "configure_routing", "type": "api_call", "depends_on": ["verify_status"]},
            {"name": "send_confirmation", "type": "api_call", "config": {"endpoint": "/v2/messages"}, "depends_on": ["configure_routing"]}]}
    ]}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "missions": len(local_missions)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
