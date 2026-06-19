#!/usr/bin/env python3
"""Missions AI Task Runner — AI-driven task execution within the Telnyx Missions framework. AI decides next steps based on task results."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
API = "https://api.telnyx.com/v2"
INFERENCE_URL = f"{API}/ai/chat/completions"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}
task_runs = []

AVAILABLE_ACTIONS = {
    "send_sms": {"endpoint": "/v2/messages", "method": "POST"},
    "make_call": {"endpoint": "/v2/calls", "method": "POST"},
    "lookup_number": {"endpoint": "/v2/number_lookup/{number}", "method": "GET"},
    "search_numbers": {"endpoint": "/v2/available_phone_numbers", "method": "GET"},
    "check_balance": {"endpoint": "/v2/balance", "method": "GET"},
}

def call_inference(messages, max_tokens=400):
    resp = requests.post(INFERENCE_URL, headers=headers,
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.2}, timeout=20)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

@app.route("/run", methods=["POST"])
def run_ai_task():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    objective = data.get("objective", "")
    context = data.get("context", {})
    max_steps = data.get("max_steps", 5)
    steps = []
    conversation = [{"role": "system", "content": f"You are a task execution AI. Available actions: {json.dumps(list(AVAILABLE_ACTIONS.keys()))}. Given an objective, plan and execute steps. For each step return JSON: action (string), params (object), reasoning (string). Return action='done' when objective is met."},
        {"role": "user", "content": f"Objective: {objective}\nContext: {json.dumps(context)}"}]
    for i in range(max_steps):
        try:
            response = call_inference(conversation)
            step = json.loads(response)
            steps.append(step)
            if step.get("action") == "done":
                break
            action_config = AVAILABLE_ACTIONS.get(step.get("action"))
            if action_config:
                endpoint = action_config["endpoint"].format(**step.get("params", {}))
                if action_config["method"] == "GET":
                    api_resp = requests.get(f"{API}{endpoint}", headers=headers, timeout=15)
                else:
                    api_resp = requests.post(f"{API}{endpoint}", headers=headers, json=step.get("params", {}), timeout=15)
                step["result"] = api_resp.json() if api_resp.ok else {"error": api_resp.text[:200]}
            conversation.append({"role": "assistant", "content": response})
            conversation.append({"role": "user", "content": f"Step {i+1} result: {json.dumps(step.get('result', 'executed'))}"})
        except Exception as e:
            app.logger.exception("task step execution failed")
            steps.append({"error": "step execution failed", "step": i + 1})
            break
    run = {"objective": objective, "steps": steps, "completed": steps[-1].get("action") == "done" if steps else False,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
    task_runs.append(run)
    return jsonify(run), 200

@app.route("/runs", methods=["GET"])
def list_runs():
    return jsonify({"runs": task_runs[-20:]}), 200

@app.route("/actions", methods=["GET"])
def list_actions():
    return jsonify({"actions": AVAILABLE_ACTIONS}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "runs": len(task_runs)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
