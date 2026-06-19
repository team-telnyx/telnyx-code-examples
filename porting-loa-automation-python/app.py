#!/usr/bin/env python3
"""Porting LOA Automation — automate Letter of Authorization generation and porting order submission."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
API = "https://api.telnyx.com/v2"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}
loa_records = []
porting_pipeline = []

LOA_TEMPLATE = """LETTER OF AUTHORIZATION

Date: {date}

I, {authorized_person}, hereby authorize Telnyx LLC to act as my agent
for the purpose of porting the following telephone number(s) from
{current_provider} to Telnyx:

Phone Numbers: {phone_numbers}

Billing Telephone Number: {billing_number}
Account Number: {account_number}
Service Address: {service_address}

I confirm that I am the authorized user of the above telephone number(s)
and have the authority to make this request.

Signature: {authorized_person}
Title: {title}
Company: {company}
"""

@app.route("/loa/generate", methods=["POST"])
def generate_loa():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    loa = LOA_TEMPLATE.format(
        date=time.strftime("%B %d, %Y"),
        authorized_person=data.get("authorized_person", ""),
        current_provider=data.get("current_provider", ""),
        phone_numbers=", ".join(data.get("phone_numbers", [])),
        billing_number=data.get("billing_number", ""),
        account_number=data.get("account_number", ""),
        service_address=data.get("service_address", ""),
        title=data.get("title", ""),
        company=data.get("company", ""))
    record = {"id": f"LOA-{int(time.time())}", "authorized_person": data.get("authorized_person"),
        "numbers": data.get("phone_numbers", []), "provider": data.get("current_provider"),
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"), "status": "generated"}
    loa_records.append(record)
    return jsonify({"loa_id": record["id"], "loa_text": loa, "record": record}), 200

@app.route("/loa/submit-and-port", methods=["POST"])
def submit_and_port():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    loa_id = f"LOA-{int(time.time())}"
    try:
        resp = requests.post(f"{API}/porting_orders", headers=headers,
            json={"phone_numbers": data.get("phone_numbers", []),
                "authorized_person": data.get("authorized_person"),
                "current_provider": data.get("current_provider"),
                "billing_phone_number": data.get("billing_number"),
                "customer_reference": loa_id}, timeout=15)
        result = resp.json()
        order_id = result.get("data", {}).get("id")
        pipeline_entry = {"loa_id": loa_id, "porting_order_id": order_id,
            "numbers": data.get("phone_numbers"), "status": "submitted",
            "submitted_at": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
        porting_pipeline.append(pipeline_entry)
        return jsonify({"loa_id": loa_id, "porting_order": result, "pipeline": pipeline_entry}), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to submit porting order")
        return jsonify({"error": "could not submit porting order"}), 500

@app.route("/loa/check-portability", methods=["POST"])
def check_portability():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    numbers = data.get("phone_numbers", [])
    results = []
    for num in numbers[:20]:
        try:
            resp = requests.get(f"{API}/portability_checks",
                headers=headers, params={"filter[phone_number]": num}, timeout=10)
            results.append({"number": num, "portability": resp.json()})
        except Exception:
            results.append({"number": num, "error": "check_failed"})
    return jsonify({"results": results}), 200

@app.route("/loa", methods=["GET"])
def list_loas():
    return jsonify({"loas": loa_records[-20:]}), 200

@app.route("/pipeline", methods=["GET"])
def pipeline_status():
    return jsonify({"pipeline": porting_pipeline[-20:]}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "loas": len(loa_records), "porting": len(porting_pipeline)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
