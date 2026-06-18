#!/usr/bin/env python3
"""Maintenance Request Dispatch - tenant texts issue, AI categorizes and estimates cost, auto-dispatches vendor for routine work, manager approves orders over $500 via SMS reply."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
MAIN_NUMBER = os.getenv("MAIN_NUMBER")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
MANAGER_NUMBER = os.getenv("MANAGER_NUMBER", "")
MANAGER_SLACK = os.getenv("MANAGER_SLACK_WEBHOOK", "")
API = "https://api.telnyx.com/v2"
INFERENCE_URL = f"{API}/ai/chat/completions"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}
APPROVAL_THRESHOLD = 500

vendors = {
    "plumbing": {"name": "Quick Plumb Co", "phone": "+15551234001"},
    "electrical": {"name": "Spark Electric", "phone": "+15551234002"},
    "hvac": {"name": "Cool Air HVAC", "phone": "+15551234003"},
    "pest": {"name": "No Bug Zone", "phone": "+15551234004"},
    "general": {"name": "HandyPro Services", "phone": "+15551234005"},
}
tenants = {"+15559001234": {"name": "Sarah Johnson", "unit": "4B", "building": "Oak Manor"}}
work_orders = []

def send_sms(to, text):
    requests.post(f"{API}/messages", headers=headers, json={"from": MAIN_NUMBER, "to": to, "text": text}, timeout=10)

def ai_categorize(text):
    try:
        resp = requests.post(INFERENCE_URL, headers=headers,
            json={"model": AI_MODEL, "messages": [
                {"role": "system", "content": "Categorize this maintenance request. Reply JSON only: {\"category\": \"plumbing|electrical|hvac|pest|general\", \"urgency\": \"emergency|routine\", \"estimated_cost\": number, \"summary\": \"brief\"}"},
                {"role": "user", "content": text}], "max_tokens": 100, "temperature": 0.1}, timeout=15)
        return json.loads(resp.json()["choices"][0]["message"]["content"].strip().strip("`").replace("json\n",""))
    except Exception:
        return {"category": "general", "urgency": "routine", "estimated_cost": 200, "summary": text[:100]}

def dispatch_vendor(category, wo):
    vendor = vendors.get(category, vendors["general"])
    send_sms(vendor["phone"], f"WORK ORDER #{wo['id']}: {wo['summary']} at {wo['building']} Unit {wo['unit']}. Urgency: {wo['urgency']}. Tenant: {wo['tenant_phone']}")
    return vendor

@app.route("/webhooks/sms", methods=["POST"])
def handle_sms():
    payload = request.get_json()
    data = payload.get("data", {}).get("payload", {})
    sender = data.get("from", {}).get("phone_number", "")
    text = data.get("text", "")

    if sender == MANAGER_NUMBER and text.strip().upper().startswith(("APPROVE", "DENY")):
        parts = text.strip().split()
        if len(parts) >= 2:
            try:
                idx = int(parts[1].replace("#",""))
                wo = next((w for w in work_orders if w["id"] == idx), None)
                if wo:
                    if "APPROVE" in parts[0].upper():
                        wo["status"] = "approved"
                        vendor = dispatch_vendor(wo["category"], wo)
                        send_sms(wo["tenant_phone"], f"Oak Manor: Maintenance approved. {vendor['name']} will contact you.")
                        send_sms(MANAGER_NUMBER, f"WO #{idx} approved. {vendor['name']} dispatched.")
                    else:
                        wo["status"] = "denied"
                        send_sms(wo["tenant_phone"], "Oak Manor: We need to discuss your maintenance request. We'll call you.")
            except (ValueError, IndexError): pass
        return jsonify({"status": "ok"}), 200

    tenant = tenants.get(sender, {"name": "Unknown Tenant", "unit": "?", "building": "Oak Manor"})
    result = ai_categorize(text)
    wo = {"id": len(work_orders), "tenant_name": tenant["name"], "tenant_phone": sender,
        "unit": tenant["unit"], "building": tenant["building"], "category": result["category"],
        "urgency": result["urgency"], "estimated_cost": result.get("estimated_cost", 200),
        "summary": result["summary"], "original_text": text, "status": "new",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
    work_orders.append(wo)

    if result["urgency"] == "emergency":
        wo["status"] = "dispatched"
        vendor = dispatch_vendor(result["category"], wo)
        send_sms(sender, f"EMERGENCY: {vendor['name']} dispatched immediately to Unit {wo['unit']}.")
        if MANAGER_SLACK:
            try: requests.post(MANAGER_SLACK, json={"text": f"EMERGENCY WO #{wo['id']}: {wo['summary']} Unit {wo['unit']}"}, timeout=5)
            except Exception: pass
    elif result.get("estimated_cost", 0) > APPROVAL_THRESHOLD:
        wo["status"] = "pending_approval"
        send_sms(MANAGER_NUMBER, f"APPROVE? WO #{wo['id']}: {wo['summary']}, Unit {wo['unit']}, ~${wo['estimated_cost']}. Reply APPROVE {wo['id']} or DENY {wo['id']}")
        send_sms(sender, f"Oak Manor: Request #{wo['id']} logged. Manager review required. We'll update you shortly.")
    else:
        wo["status"] = "dispatched"
        vendor = dispatch_vendor(result["category"], wo)
        send_sms(sender, f"Oak Manor: Request #{wo['id']} received. {vendor['name']} will contact you to schedule.")

    return jsonify({"status": "ok", "work_order": wo["id"]}), 200

@app.route("/work-orders", methods=["GET"])
def list_work_orders():
    return jsonify({"work_orders": work_orders}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "total": len(work_orders), "pending": sum(1 for w in work_orders if w["status"] == "pending_approval")}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
