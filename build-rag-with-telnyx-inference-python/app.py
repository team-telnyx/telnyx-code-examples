#!/usr/bin/env python3
"""Build a simple RAG API with Telnyx AI Inference."""

import math
import os
from typing import Iterable

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "thenlper/gte-large")
API_BASE = "https://api.telnyx.com/v2/ai"

DOCUMENTS = [
    {
        "title": "API Key Authentication",
        "text": (
            "Telnyx API requests require a valid API key. If a request returns a 401 error, "
            "check that the API key is active, correctly copied, and has the required permissions. "
            "After rotating an API key, make sure production services are using the new key and "
            "that no old key is cached in environment variables or deployment secrets."
        ),
    },
    {
        "title": "Rate Limits",
        "text": (
            "A 429 error means too many requests were sent in a short period of time. "
            "Applications should use exponential backoff and avoid retry loops that immediately "
            "resend failed requests."
        ),
    },
    {
        "title": "Webhook Troubleshooting",
        "text": (
            "Webhook delivery issues can happen when endpoint URLs are incorrect, authentication "
            "headers are missing, or downstream services reject requests. Check request logs, "
            "response codes, and recent configuration changes."
        ),
    },
    {
        "title": "Verification Message Delivery",
        "text": (
            "If users are not receiving verification messages, check message delivery logs, "
            "provider response codes, destination formatting, and whether the signup flow depends "
            "on a backend job that may be failing."
        ),
    },
    {
        "title": "Billing Support",
        "text": (
            "For duplicate charges or invoice questions, collect the account name, invoice IDs, "
            "charge dates, charge amounts, and billing contact. Billing issues are usually not "
            "urgent unless they block account access or service usage."
        ),
    },
]

DOCUMENT_EMBEDDINGS: list[list[float]] | None = None


def _require_api_key() -> None:
    if not TELNYX_API_KEY:
        raise RuntimeError("Set TELNYX_API_KEY in your environment or .env file.")


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {TELNYX_API_KEY}",
        "Content-Type": "application/json",
    }


def create_embeddings(inputs: str | list[str]) -> list[list[float]]:
    _require_api_key()
    response = requests.post(
        f"{API_BASE}/embeddings",
        headers=_headers(),
        json={"model": EMBEDDING_MODEL, "input": inputs},
        timeout=60,
    )
    response.raise_for_status()
    return [item["embedding"] for item in response.json()["data"]]


def cosine_similarity(left: Iterable[float], right: Iterable[float]) -> float:
    left_values = list(left)
    right_values = list(right)
    dot = sum(a * b for a, b in zip(left_values, right_values))
    left_norm = math.sqrt(sum(a * a for a in left_values))
    right_norm = math.sqrt(sum(b * b for b in right_values))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return dot / (left_norm * right_norm)


def ensure_document_embeddings() -> list[list[float]]:
    global DOCUMENT_EMBEDDINGS
    if DOCUMENT_EMBEDDINGS is None:
        DOCUMENT_EMBEDDINGS = create_embeddings([doc["text"] for doc in DOCUMENTS])
    return DOCUMENT_EMBEDDINGS


def retrieve(query: str, top_k: int = 3) -> list[dict]:
    query_embedding = create_embeddings(query)[0]
    document_embeddings = ensure_document_embeddings()

    scored = []
    for doc, embedding in zip(DOCUMENTS, document_embeddings):
        scored.append({
            "title": doc["title"],
            "text": doc["text"],
            "score": cosine_similarity(query_embedding, embedding),
        })

    return sorted(scored, key=lambda item: item["score"], reverse=True)[:top_k]


def answer_with_context(question: str, sources: list[dict], model: str | None = None) -> str:
    context = "\n\n".join(
        f"Source: {source['title']}\n{source['text']}"
        for source in sources
    )

    response = requests.post(
        f"{API_BASE}/chat/completions",
        headers=_headers(),
        json={
            "model": model or AI_MODEL,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a helpful support assistant. Answer the user's question "
                        "using only the provided context. If the context does not contain "
                        "the answer, say you do not know."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Context:\n{context}\n\n"
                        f"Question:\n{question}\n\n"
                        "Answer with a short answer and the most relevant source titles."
                    ),
                },
            ],
            "temperature": 0.2,
        },
        timeout=60,
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]


@app.route("/rag/ask", methods=["POST"])
def rag_ask():
    data = request.get_json(silent=True) or {}
    question = data.get("question")
    if not isinstance(question, str) or not question.strip():
        return jsonify({"error": "Request body must include a non-empty 'question' string."}), 400

    top_k = int(data.get("top_k", 3))
    top_k = max(1, min(top_k, len(DOCUMENTS)))

    try:
        sources = retrieve(question, top_k=top_k)
        answer = answer_with_context(question, sources, model=data.get("model"))
        return jsonify({
            "answer": answer,
            "model": data.get("model") or AI_MODEL,
            "embedding_model": EMBEDDING_MODEL,
            "sources": [
                {"title": source["title"], "score": round(source["score"], 4)}
                for source in sources
            ],
        }), 200
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else 502
        return jsonify({"error": "Telnyx AI Inference request failed.", "status": status}), status
    except RuntimeError as exc:
        app.logger.exception("Runtime error while processing /rag/ask request")
        return jsonify({"error": "An internal server error occurred."}), 500


@app.route("/documents", methods=["GET"])
def documents():
    return jsonify({"documents": [{"title": doc["title"], "text": doc["text"]} for doc in DOCUMENTS]}), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "model": AI_MODEL,
        "embedding_model": EMBEDDING_MODEL,
        "documents": len(DOCUMENTS),
    }), 200


if __name__ == "__main__":
    app.run(
        debug=os.getenv("FLASK_DEBUG", "false").lower() == "true",
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", 5000)),
    )
