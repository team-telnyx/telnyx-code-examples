```python
"""
Edge-Deployed LLM Semantic Cache with KV
Flask app exposing POST /chat that embeds prompts via Telnyx Inference,
runs cosine-similarity search against a KV-backed vector index, and
falls back to a full chat completion on a similarity miss.
"""

import os
import time
import math
import json
import logging
from typing import List, Dict, Any, Optional, Tuple

from flask import Flask, request, jsonify
from dotenv import load_dotenv
import telnyx

load_dotenv()

app = Flask(__name__)
app.logger.setLevel(logging.INFO)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
KV_REST_URL = os.getenv("KV_REST_URL")
KV_REST_TOKEN = os.getenv("KV_REST_TOKEN")
SIMILARITY_THRESHOLD = float(os.getenv("SIMILARITY_THRESHOLD", "0.85"))
CACHE_TTL_SECONDS = int(os.getenv("CACHE_TTL_SECONDS", "300"))
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
CHAT_MODEL = os.getenv("CHAT_MODEL", "gpt-3.5-turbo")
KV_INDEX_KEY = os.getenv("KV_INDEX_KEY", "semantic_cache_index")

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
def _validate_env() -> Optional[str]:
    """Return an error message if required env vars are missing."""
    if not TELNYX_API_KEY:
        return "TELNYX_API_KEY environment variable is required."
    if not KV_REST_URL or not KV_REST_TOKEN:
        return "KV_REST_URL and KV_REST_TOKEN environment variables are required for KV store access."
    return None

# ---------------------------------------------------------------------------
# KV client (REST-based KV store, e.g. Vercel KV / Upstash)
# ---------------------------------------------------------------------------
import urllib.request

def _kv_get(key: str) -> Optional[str]:
    """Fetch a value from KV."""
    url = f"{KV_REST_URL}/get/{key}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {KV_REST_TOKEN}"})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            return data.get("result")
    except Exception as e:
        app.logger.exception(f"KV GET failed for key {key}: {e}")
        return None

def _kv_set(key: str, value: str, ttl: int) -> bool:
    """Set a value in KV with a TTL."""
    url = f"{KV_REST_URL}/set/{key}"
    payload = json.dumps({"value": value, "ex": ttl}).encode()
    req = urllib.request.Request(url, data=payload, headers={
        "Authorization": f"Bearer {KV_REST_TOKEN}",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status == 200
    except Exception as e:
        app.logger.exception(f"KV SET failed for key {key}: {e}")
        return False

# ---------------------------------------------------------------------------
# Embeddings via Telnyx Inference
# ---------------------------------------------------------------------------
def get_embedding(prompt: str) -> List[float]:
    """Call Telnyx Inference embeddings API and return the embedding vector."""
    try:
        telnyx.api_key = TELNYX_API_KEY
        response = telnyx.Embedding.create(
            model=EMBEDDING_MODEL,
            input=prompt,
        )
        # The SDK returns a list of embedding objects
        if hasattr(response, 'data') and response.data:
            return response.data[0].embedding
        elif isinstance(response, dict) and response.get('data'):
            return response['data'][0]['embedding']
        else:
            raise ValueError("Unexpected embedding response format")
    except Exception as e:
        app.logger.exception(f"Embedding API call failed: {e}")
        raise

# ---------------------------------------------------------------------------
# Chat completion fallback via Telnyx Inference
# ---------------------------------------------------------------------------
def get_chat_completion(prompt: str) -> str:
    """Call Telnyx Inference chat completion API and return the response text."""
    try:
        telnyx.api_key = TELNYX_API_KEY
        response = telnyx.ChatCompletion.create(
            model=CHAT_MODEL,
            messages=[{"role": "user", "content": prompt}],
        )
        if hasattr(response, 'choices') and response.choices:
            return response.choices[0].message.content
        elif isinstance(response, dict) and response.get('choices'):
            return response['choices'][0]['message']['content']
        else:
            raise ValueError("Unexpected chat completion response format")
    except Exception as e:
        app.logger.exception(f"Chat completion API call failed: {e}")
        raise

# ---------------------------------------------------------------------------
# Cosine similarity
# ---------------------------------------------------------------------------
def cosine_similarity(vec_a: List[float], vec_b: List[float]) -> float:
    """Compute cosine similarity between two vectors."""
    if len(vec_a) != len(vec_b):
        raise ValueError("Vectors must have the same dimension")
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)

# ---------------------------------------------------------------------------
# KV vector index operations
# ---------------------------------------------------------------------------
def load_index() -> List[Dict[str, Any]]:
    """Load the vector index from KV. Returns a list of entries."""
    raw = _kv_get(KV_INDEX_KEY)
    if raw is None:
        return []
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        app.logger.warning("Index in KV is corrupted, starting fresh.")
        return []

def save_index(index: List[Dict[str, Any]]) -> bool:
    """Save the vector index to KV with the configured TTL."""
    return _kv_set(KV_INDEX_KEY, json.dumps(index), CACHE_TTL_SECONDS)

def search_cache(prompt_embedding: List[float]) -> Tuple[Optional[Dict[str, Any]], float]:
    """Search the KV vector index for the most similar cached entry.
    Returns (entry, similarity_score) or (None, 0.0) if no match above threshold.
    """
    index = load_index()
    best_entry = None
    best_score = 0.0
    for entry in index:
        score = cosine_similarity(prompt_embedding, entry["embedding"])
        if score > best_score:
            best_score = score
            best_entry = entry
    if best_entry and best_score >= SIMILARITY_THRESHOLD:
        return best_entry, best_score
    return None, best_score

def upsert_cache(prompt: str, prompt_embedding: List[float], response: str) -> bool:
    """Add or update a cache entry in the KV vector index."""
    index = load_index()
    # Check if an exact prompt match exists (update in place)
    for entry in index:
        if entry["prompt"] == prompt:
            entry["embedding"] = prompt_embedding
            entry["response"] = response
            entry["timestamp"] = time.time()
            break
    else:
        index.append({
            "prompt": prompt,
            "embedding": prompt_embedding,
            "response": response,
            "timestamp": time.time(),
        })
    return save_index(index)

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.route("/chat", methods=["POST"])
def chat():
    """POST /chat — semantic cache lookup with Inference fallback."""
    start_time = time.time()

    # Validate environment
    env_error = _validate_env()
    if env_error:
        app.logger.error(env_error)
        return jsonify({"error": env_error}), 500

    # Parse request
    body = request.get_json(silent=True)
    if not body or "prompt" not in body:
        return jsonify({"error": "Request body must contain a 'prompt' field."}), 400

    prompt = body["prompt"]
    if not isinstance(prompt, str) or not prompt.strip():
        return jsonify({"error": "'prompt' must be a non-empty string."}), 400

    try:
        # Step 1: Embed the prompt
        prompt_embedding = get_embedding(prompt)

        # Step 2: Search KV vector index
        cached_entry, similarity = search_cache(prompt_embedding)

        if cached_entry:
            # Cache hit — return cached response
            latency_ms = int((time.time() - start_time) * 1000)
            return jsonify({
                "cache_hit": True,
                "similarity": round(similarity, 4),
                "response": cached_entry["response"],
                "latency_ms": latency_ms,
                "model": CHAT_MODEL,
            }), 200

        # Step 3: Cache miss — fall back to full chat completion
        chat_response = get_chat_completion(prompt)

        # Step 4: Write back to KV
        upsert_cache(prompt, prompt_embedding, chat_response)

        latency_ms = int((time.time() - start_time) * 1000)
        return jsonify({
            "cache_hit": False,
            "similarity": round(similarity, 4),
            "response": chat_response,
            "latency_ms": latency_ms,
            "model": CHAT_MODEL,
        }), 200

    except Exception as e:
        app.logger.exception(f"Unhandled error in /chat: {e}")
        return jsonify({"error": "An internal error occurred. Please try again later."}), 500

@app.route("/health", methods=["GET"])
def health():
    """GET /health — simple health check."""
    return jsonify({"status": "ok"}), 200

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 8080)))
```
