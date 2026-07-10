#!/usr/bin/env python3
"""Fax-to-Structured-Data Pipeline — receive faxes, AI extracts structured data (invoices, orders, prescriptions) into JSON."""
import os, json, time, requests, telnyx, io
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
# public_key (from the Portal) lets the SDK verify inbound webhook signatures.
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"), public_key=os.getenv("TELNYX_PUBLIC_KEY"))
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
AI_MODEL = os.getenv("AI_MODEL", "MiniMaxAI/MiniMax-M3-MXFP8")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
fax_queue = []
extracted_data = []

def _extract_json(text):
    if not text:
        return None
    s = text.strip()
    if s.startswith("```"):
        s = s.split("```", 2)[1]
        if s.startswith("json"):
            s = s[4:]
        s = s.strip()
    start = s.find("{")
    end = s.rfind("}")
    if start != -1 and end != -1 and end > start:
        s = s[start:end + 1]
    return s

def parse_json_response(result):
    payload = _extract_json(result)
    if not payload:
        return None
    return json.loads(payload)

def call_inference(messages, max_tokens=1500):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.1}, timeout=120)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

def fetch_fax_media(fax_id):
    """Download the fax PDF from Telnyx and return raw bytes."""
    url = f"https://api.telnyx.com/v2/faxes/{fax_id}/media"
    resp = requests.get(url, headers={"Authorization": f"Bearer {TELNYX_API_KEY}"}, timeout=30)
    resp.raise_for_status()
    return resp.content

def extract_text_from_pdf(pdf_bytes):
    """Extract text from a PDF using pdfplumber. Returns empty string on failure."""
    try:
        import pdfplumber
        text_parts = []
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                text_parts.append(page.extract_text() or "")
        return "\n".join(text_parts).strip()
    except Exception as e:
        app.logger.exception("pdf text extraction failed: %s", e)
        return ""

DOC_PROMPTS = {
    "invoice": "Extract invoice data. Return JSON: vendor (string), invoice_number (string), date (string), due_date (string), line_items (list of {description, quantity, unit_price, total}), subtotal (number), tax (number), total (number), payment_terms (string).",
    "order": "Extract purchase order data. Return JSON: po_number (string), vendor (string), ship_to (string), items (list of {sku, description, quantity, unit_price}), total (number), delivery_date (string).",
    "prescription": "Extract prescription data. Return JSON: patient_name (string), prescriber (string), medication (string), dosage (string), frequency (string), quantity (number), refills (number), date (string).",
    "auto": "Identify this document type and extract all structured data. Return JSON: document_type (string), confidence (float), extracted_fields (object with all relevant key-value pairs).",
}

def run_extraction(text, doc_type="auto", fax_id=None):
    """Run AI extraction on text. Returns parsed JSON dict."""
    prompt = DOC_PROMPTS.get(doc_type, DOC_PROMPTS["auto"]) + " Return only JSON, no prose, no markdown fences."
    result = call_inference([{"role": "system", "content": prompt}, {"role": "user", "content": text}])
    parsed = parse_json_response(result)
    if parsed is None:
        return {"raw": result, "fax_id": fax_id, "text_preview": text[:500]}
    if fax_id:
        parsed["fax_id"] = fax_id
    parsed["extracted_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
    parsed["text_preview"] = text[:500]
    extracted_data.append(parsed)
    return parsed

def process_fax(fax_id, doc_type="auto"):
    """Fetch fax media from Telnyx, extract text from PDF, run AI extraction."""
    pdf_bytes = fetch_fax_media(fax_id)
    text = extract_text_from_pdf(pdf_bytes)
    if not text:
        app.logger.warning("no text extracted from fax %s (image-only? needs OCR)", fax_id)
        return None
    return run_extraction(text, doc_type, fax_id)

@app.route("/webhooks/fax", methods=["POST"])
def receive_fax():
    # Verify the Telnyx Ed25519 signature before trusting the event.
    # Skip verification when TELNYX_PUBLIC_KEY is not set (local dev only).
    if TELNYX_PUBLIC_KEY:
        try:
            client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
        except Exception:
            return jsonify({"error": "invalid signature"}), 401
    else:
        app.logger.warning("TELNYX_PUBLIC_KEY not set — skipping webhook signature verification (local dev only)")
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "invalid request body"}), 400
    data = payload.get("data", {})
    p = data.get("payload", {})
    event_type = data.get("event_type", "")
    if event_type == "fax.received":
        fax_entry = {"fax_id": p.get("fax_id"), "from": p.get("from"), "to": p.get("to"),
            "pages": p.get("page_count"), "media_url": p.get("media_url"), "status": "received",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
        fax_queue.append(fax_entry)
        # Auto-process: fetch the fax PDF, extract text, run AI extraction.
        try:
            result = process_fax(p.get("fax_id"))
            if result:
                fax_entry["status"] = "extracted"
                fax_entry["extraction"] = result
            else:
                fax_entry["status"] = "no_text"
        except Exception as e:
            app.logger.exception("auto-process fax %s failed: %s", p.get("fax_id"), e)
            fax_entry["status"] = "extraction_failed"
        return jsonify({"status": fax_entry["status"], "fax_id": fax_entry["fax_id"]}), 200
    return jsonify({"status": "ok"}), 200

@app.route("/process/<fax_id>", methods=["POST"])
def process_fax_endpoint(fax_id):
    """Manually trigger extraction for a queued fax."""
    doc_type = (request.get_json(silent=True) or {}).get("type", "auto")
    try:
        result = process_fax(fax_id, doc_type)
        if result is None:
            return jsonify({"fax_id": fax_id, "error": "no text extracted (image-only fax needs OCR)"}), 422
        return jsonify(result), 200
    except Exception:
        app.logger.exception("manual process fax %s failed", fax_id)
        return jsonify({"fax_id": fax_id, "error": "processing failed"}), 500

@app.route("/extract", methods=["POST"])
def extract_data():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    text = data.get("text", "")
    doc_type = data.get("type", "auto")
    if not text: return jsonify({"error": "text required"}), 400
    try:
        return jsonify(run_extraction(text, doc_type)), 200
    except Exception:
        app.logger.exception("extraction failed")
        return jsonify({"error": "extraction failed"}), 500

@app.route("/extract-pdf", methods=["POST"])
def extract_pdf():
    """Upload a local PDF file and run the full extraction pipeline on it."""
    if "file" not in request.files:
        return jsonify({"error": "file required (multipart upload)"}), 400
    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "no filename"}), 400
    doc_type = request.form.get("type", "auto")
    pdf_bytes = file.read()
    text = extract_text_from_pdf(pdf_bytes)
    if not text:
        return jsonify({"error": "no text extracted (image-only PDF needs OCR)"}), 422
    try:
        return jsonify(run_extraction(text, doc_type)), 200
    except Exception:
        app.logger.exception("PDF extraction failed")
        return jsonify({"error": "extraction failed"}), 500

@app.route("/faxes", methods=["GET"])
def list_faxes():
    return jsonify({"faxes": fax_queue[-50:]}), 200

@app.route("/extracted", methods=["GET"])
def list_extracted():
    return jsonify({"data": extracted_data[-50:]}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "faxes": len(fax_queue), "extracted": len(extracted_data)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
