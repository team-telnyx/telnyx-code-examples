#!/usr/bin/env python3
"""AI Moderation Classifier — classify user-generated content as safe/spam/abuse/hate/harassment/self-harm via embeddings pre-filter + LLM judgment."""
import os, json, time, requests, numpy as np
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "thenlper/gte-large")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
EMBEDDINGS_URL = "https://api.telnyx.com/v2/ai/openai/embeddings"
SAMPLE_BLOCKLIST_PATH = os.path.join(os.path.dirname(__file__), "sample_blocklist.json")
moderations = {}
blocklist = {}
blocklist_vectors = None
blocklist_ids = []
indexed_at = None
SPAM_THRESHOLD = 0.95
AMBIGUOUS_THRESHOLD = 0.85

SYSTEM_PROMPT = """You are a content moderation classifier. Classify user-generated content into one of these categories:
- safe: no issues, allow the content
- spam: promotional, repetitive, irrelevant, scam, phishing
- abuse: personal attacks, insults, name-calling
- hate: hate speech (racism, sexism, xenophobia, homophobia, discrimination based on identity)
- harassment: targeted harassment, threats, stalking, intimidation
- self_harm: content indicating risk of self-harm or suicide

Also assign:
- confidence (0.0 to 1.0): how confident you are in the classification
- flags (array of strings): specific issues found, e.g. ["xenophobic", "personal_attack", "promotional"]
- recommended_action: one of "allow", "flag" (hold for human review), "remove" (auto-remove), "escalate" (urgent human review)
- reason (string): one sentence explaining the decision

Return JSON only:
{
  "category": "safe" | "spam" | "abuse" | "hate" | "harassment" | "self_harm",
  "confidence": float,
  "flags": ["..."],
  "recommended_action": "allow" | "flag" | "remove" | "escalate",
  "reason": "..."
}"""

def call_inference(messages, max_tokens=4000):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.2}, timeout=40)
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"].get("content")
    if content is None:
        raise ValueError("model returned no content (try a larger max_tokens or a non-reasoning model)")
    content = content.strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[1] if "\n" in content else content
        content = content.rsplit("```", 1)[0]
        content = content.strip()
    return content

def get_embeddings(texts, batch_size=8):
    all_embeddings = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        resp = requests.post(EMBEDDINGS_URL,
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"input": batch, "model": EMBEDDING_MODEL}, timeout=40)
        resp.raise_for_status()
        data = resp.json().get("data", [])
        all_embeddings.extend([d["embedding"] for d in data])
    return all_embeddings

def cosine_similarity(vec, matrix):
    if matrix is None or matrix.size == 0:
        return np.array([])
    vec_norm = vec / (np.linalg.norm(vec) + 1e-10)
    matrix_norm = matrix / (np.linalg.norm(matrix, axis=1, keepdims=True) + 1e-10)
    return np.dot(matrix_norm, vec_norm)

def load_sample_blocklist():
    with open(SAMPLE_BLOCKLIST_PATH, "r") as f:
        return json.load(f)

def build_blocklist_index(entries):
    global blocklist, blocklist_vectors, blocklist_ids, indexed_at
    texts = [e["text"] for e in entries]
    embeddings = get_embeddings(texts)
    blocklist_vectors = np.array(embeddings, dtype=np.float32)
    blocklist_ids = [e["id"] for e in entries]
    blocklist = {e["id"]: e for e in entries}
    indexed_at = time.strftime("%Y-%m-%dT%H:%M:%SZ")

def check_blocklist(content_text):
    """Returns (matched_category, score) or (None, best_score) if no match."""
    global blocklist_vectors, blocklist_ids, blocklist
    if blocklist_vectors is None or not blocklist:
        return None, 0.0
    query_vec = np.array(get_embeddings([content_text])[0], dtype=np.float32)
    scores = cosine_similarity(query_vec, blocklist_vectors)
    if scores.size == 0:
        return None, 0.0
    best_idx = int(np.argmax(scores))
    best_score = float(round(scores[best_idx], 4))
    if best_score >= SPAM_THRESHOLD:
        entry_id = blocklist_ids[best_idx]
        entry = blocklist[entry_id]
        return entry["category"], best_score
    return None, best_score

@app.route("/moderate", methods=["POST"])
def moderate_content():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    content = data.get("content", "").strip()
    if not content:
        return jsonify({"error": "content field is required"}), 400
    source = data.get("source", "unknown")
    author_id = data.get("author_id")
    try:
        matched_category, blocklist_score = check_blocklist(content)
        if matched_category:
            result = {
                "category": matched_category,
                "confidence": blocklist_score,
                "flags": [f"blocklist_match:{matched_category}"],
                "recommended_action": "remove" if matched_category in ("spam", "abuse", "hate", "harassment") else "escalate",
                "reason": f"Content matched a known {matched_category} entry in the blocklist with {blocklist_score:.2f} similarity.",
            }
        else:
            prompt = f"Classify this user-generated content for moderation:\n\n\"{content[:4000]}\"\n\nSource: {source}"
            llm_result = call_inference([
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ])
            result = json.loads(llm_result)
        mod_id = f"mod-{int(time.time())}"
        result["id"] = mod_id
        result["content"] = content
        result["source"] = source
        result["author_id"] = author_id
        result["blocklist_match"] = matched_category is not None
        result["blocklist_score"] = blocklist_score
        result["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
        moderations[mod_id] = result
        return jsonify(result), 200
    except json.JSONDecodeError as e:
        return jsonify({"raw": str(e), "error": "failed to parse LLM response"}), 200
    except Exception:
        app.logger.exception("moderation failed")
        return jsonify({"error": "internal error"}), 500

@app.route("/moderate/batch", methods=["POST"])
def moderate_batch():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    items = data.get("items", [])
    if not items:
        return jsonify({"error": "items field is required"}), 400
    results = []
    for item in items[:20]:
        content = item.get("content", "").strip()
        if not content:
            results.append({"error": "content is required"})
            continue
        try:
            matched_category, blocklist_score = check_blocklist(content)
            if matched_category:
                result = {
                    "category": matched_category,
                    "confidence": blocklist_score,
                    "flags": [f"blocklist_match:{matched_category}"],
                    "recommended_action": "remove",
                    "reason": f"Blocklist match ({blocklist_score:.2f})",
                    "blocklist_match": True,
                    "blocklist_score": blocklist_score,
                }
            else:
                prompt = f"Classify this user-generated content for moderation:\n\n\"{content[:4000]}\""
                llm_result = call_inference([
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ])
                result = json.loads(llm_result)
                result["blocklist_match"] = False
                result["blocklist_score"] = blocklist_score
            result["content"] = content
            result["source"] = item.get("source", "unknown")
            result["author_id"] = item.get("author_id")
            result["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
            mod_id = f"mod-{int(time.time() * 1000) % 1000000}"
            result["id"] = mod_id
            moderations[mod_id] = result
            results.append(result)
        except Exception as e:
            results.append({"content": content, "error": str(e)})
    summary = {
        "total": len(results),
        "by_category": {},
        "remove": 0,
        "flag": 0,
        "allow": 0,
        "escalate": 0,
    }
    for r in results:
        cat = r.get("category", "unknown")
        summary["by_category"][cat] = summary["by_category"].get(cat, 0) + 1
        action = r.get("recommended_action", "allow")
        if action in summary:
            summary[action] += 1
    return jsonify({"results": results, "summary": summary}), 200

@app.route("/blocklist", methods=["POST"])
def add_to_blocklist():
    global blocklist_vectors, blocklist_ids, blocklist
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    text = data.get("text", "").strip()
    if not text:
        return jsonify({"error": "text field is required"}), 400
    category = data.get("category", "spam")
    entry_id = data.get("id") or f"BLK-{int(time.time())}"
    entry = {
        "id": entry_id,
        "text": text,
        "category": category,
        "added_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    if blocklist_vectors is None:
        return jsonify({"error": "blocklist index not built — call POST /blocklist/index first"}), 400
    try:
        embedding = get_embeddings([text])[0]
        new_vec = np.array([embedding], dtype=np.float32)
        blocklist_vectors = np.vstack([blocklist_vectors, new_vec])
        blocklist_ids.append(entry_id)
        blocklist[entry_id] = entry
        return jsonify({"status": "added", "id": entry_id}), 201
    except Exception:
        app.logger.exception("add to blocklist failed")
        return jsonify({"error": "internal error"}), 500

@app.route("/blocklist", methods=["GET"])
def list_blocklist():
    return jsonify({"blocklist": list(blocklist.values()), "count": len(blocklist)}), 200

@app.route("/blocklist/index", methods=["POST"])
def index_blocklist():
    data = request.get_json(silent=True) or {}
    entries = data.get("entries")
    if not entries:
        entries = load_sample_blocklist()
    try:
        build_blocklist_index(entries)
        return jsonify({
            "status": "indexed",
            "blocklist_count": len(blocklist),
            "indexed_at": indexed_at,
        }), 200
    except Exception:
        app.logger.exception("blocklist indexing failed")
        return jsonify({"error": "internal error"}), 500

@app.route("/moderations", methods=["GET"])
def list_moderations():
    category = request.args.get("category")
    results = list(moderations.values())[-50:]
    if category:
        results = [m for m in results if m.get("category") == category]
    return jsonify({"moderations": results}), 200

@app.route("/moderations/<mod_id>", methods=["GET"])
def get_moderation(mod_id):
    mod = moderations.get(mod_id)
    if not mod:
        return jsonify({"error": "moderation not found"}), 404
    return jsonify(mod), 200

@app.route("/stats", methods=["GET"])
def stats():
    by_category = {}
    by_action = {}
    for m in moderations.values():
        cat = m.get("category", "unknown")
        by_category[cat] = by_category.get(cat, 0) + 1
        action = m.get("recommended_action", "allow")
        by_action[action] = by_action.get(action, 0) + 1
    return jsonify({
        "total_moderations": len(moderations),
        "blocklist_count": len(blocklist),
        "by_category": by_category,
        "by_action": by_action,
        "blocklist_indexed": blocklist_vectors is not None,
        "indexed_at": indexed_at,
    }), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "moderations": len(moderations),
        "blocklist_count": len(blocklist),
        "blocklist_indexed": blocklist_vectors is not None,
        "version": "1.0.0",
    }), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
