#!/usr/bin/env python3
"""Extract structured JSON from unstructured text with Telnyx AI Inference."""

import json
import os
import re
from copy import deepcopy

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"

DEFAULT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "company": {"type": "string"},
        "category": {
            "type": "string",
            "enum": ["authentication", "rate_limit", "billing", "bug", "feature_request", "general"],
        },
        "priority": {"type": "string", "enum": ["low", "medium", "high", "urgent"]},
        "summary": {"type": "string"},
        "affected_environment": {"type": "string"},
        "affected_region": {"type": "string"},
        "customer_impact": {"type": "string"},
        "error_codes": {"type": "array", "items": {"type": "string"}},
        "suspected_cause": {"type": "string"},
        "requested_action": {"type": "string"},
    },
    "required": [
        "company",
        "category",
        "priority",
        "summary",
        "affected_environment",
        "affected_region",
        "customer_impact",
        "error_codes",
        "suspected_cause",
        "requested_action",
    ],
}

SAMPLE_TEXT = """Subject: URGENT - checkout failures after key rotation??

Hey support,

We rotated our Telnyx API key yesterday around 6:15pm ET as part of a security cleanup.
Since then, some of our backend jobs are failing when they try to send verification messages.

The weird part: our staging environment works fine, but production is throwing 401s.
We also saw a few 429s earlier this morning, but those might be from our retry loop going crazy.

Impact: new users can't complete signup because they never receive the verification code.
This started around 9:30am ET today and is affecting our US traffic only as far as we can tell.

Can someone check whether our old key is still cached somewhere, or if we missed a permission
on the new key? Happy to jump on a call. This is urgent because paid acquisition is live today.

Account: Acme Health
Request ID examples: req_7K2... and req_9Q1...
"""


def _require_api_key() -> None:
    if not TELNYX_API_KEY:
        raise RuntimeError("Set TELNYX_API_KEY in your environment or .env file.")


def _strip_json_fences(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def extract_json(text: str, schema: dict | None = None, model: str | None = None) -> dict:
    """Ask Telnyx AI Inference to return structured JSON for the provided text."""
    _require_api_key()
    schema = schema or DEFAULT_SCHEMA

    response = requests.post(
        INFERENCE_URL,
        headers={
            "Authorization": f"Bearer {TELNYX_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "model": model or AI_MODEL,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Extract structured information from the user's text. "
                        "Return only one valid JSON object. Do not include Markdown, "
                        "code fences, commentary, or extra fields."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        "Use this JSON Schema as the target shape:\n"
                        f"{json.dumps(schema, indent=2)}\n\n"
                        "Text to extract:\n"
                        f"{text}"
                    ),
                },
            ],
            "temperature": 0,
            "response_format": {"type": "json_object"},
        },
        timeout=60,
    )
    response.raise_for_status()

    raw_content = response.json()["choices"][0]["message"]["content"]
    return json.loads(_strip_json_fences(raw_content))


@app.route("/extract", methods=["POST"])
def extract_endpoint():
    data = request.get_json(silent=True) or {}
    text = data.get("text")
    if not isinstance(text, str) or not text.strip():
        return jsonify({"error": "Request body must include a non-empty 'text' string."}), 400

    schema = data.get("schema") or DEFAULT_SCHEMA
    if not isinstance(schema, dict):
        return jsonify({"error": "'schema' must be a JSON object when provided."}), 400

    try:
        result = extract_json(text=text, schema=schema, model=data.get("model"))
        return jsonify({"model": data.get("model") or AI_MODEL, "result": result}), 200
    except json.JSONDecodeError:
        return jsonify({"error": "Model response was not valid JSON."}), 502
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else 502
        return jsonify({"error": "Telnyx AI Inference request failed.", "status": status}), status
    except RuntimeError as exc:
        app.logger.exception("Runtime error during /extract request: %s", exc)
        return jsonify({"error": "An internal error occurred."}), 500


@app.route("/sample", methods=["GET"])
def sample_endpoint():
    return jsonify({"text": SAMPLE_TEXT, "schema": deepcopy(DEFAULT_SCHEMA)}), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "model": AI_MODEL}), 200


if __name__ == "__main__":
    app.run(
        debug=os.getenv("FLASK_DEBUG", "false").lower() == "true",
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", 5000)),
    )
