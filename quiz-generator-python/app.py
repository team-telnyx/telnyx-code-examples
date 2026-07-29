#!/usr/bin/env python3
"""AI Quiz Generator — turn any article, URL, or text into a multiple-choice quiz with answer key and explanations via Telnyx AI Inference."""
import os, json, time, re, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
quizzes = {}

def fetch_url_text(url):
    """Fetch a URL and extract plain text. Strips HTML tags, handles markdown, gists, and raw text."""
    try:
        resp = requests.get(url, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
        resp.raise_for_status()
        content_type = resp.headers.get("Content-Type", "")
        text = resp.text
        if "html" in content_type.lower() or text.strip().lower().startswith("<!doctype") or text.strip().startswith("<html"):
            text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.DOTALL | re.IGNORECASE)
            text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL | re.IGNORECASE)
            text = re.sub(r"<[^>]+>", " ", text)
            text = re.sub(r"\s+", " ", text).strip()
        return text
    except Exception as e:
        raise ValueError(f"failed to fetch URL: {e}")

def call_inference(messages, max_tokens=6000):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.4}, timeout=120)
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

SYSTEM_PROMPT = """You are a quiz generator. Create multiple-choice quizzes from provided text. Each quiz has 5 questions with 4 choices each, one correct answer, and a short explanation.

Return JSON only with this shape:
{
  "title": "a short quiz title",
  "description": "one sentence describing the quiz topic",
  "questions": [
    {
      "id": 1,
      "question": "the question text",
      "choices": {"A": "choice A", "B": "choice B", "C": "choice C", "D": "choice D"},
      "correct_answer": "A",
      "explanation": "why this answer is correct"
    }
  ]
}

Rules:
- Generate exactly 5 questions.
- Questions should test understanding, not just memorization.
- Only one correct answer per question.
- Explanations should be 1-2 sentences.
- Make distractors plausible but clearly wrong."""

def build_quiz_prompt(text, num_questions=5, difficulty="medium"):
    return f"""Generate a {difficulty} difficulty quiz with {num_questions} multiple-choice questions from this text:

{text[:6000]}

Return JSON only."""

@app.route("/quiz/generate", methods=["POST"])
def generate_quiz():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    text = data.get("text", "").strip()
    url = data.get("url", "").strip()
    if not text and not url:
        return jsonify({"error": "either text or url field is required"}), 400
    source = "text"
    if url and not text:
        try:
            text = fetch_url_text(url)
            source = url
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
    if not text or len(text) < 50:
        return jsonify({"error": "text is too short to generate a quiz (minimum 50 characters)"}), 400
    num_questions = data.get("num_questions", 5)
    if num_questions < 1 or num_questions > 20:
        return jsonify({"error": "num_questions must be between 1 and 20"}), 400
    difficulty = data.get("difficulty", "medium")
    if difficulty not in ("easy", "medium", "hard"):
        return jsonify({"error": "difficulty must be easy, medium, or hard"}), 400
    title = data.get("title")
    prompt = build_quiz_prompt(text, num_questions, difficulty)
    try:
        result = call_inference([
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ])
        quiz = json.loads(result)
        quiz_id = f"quiz-{int(time.time())}"
        quiz["id"] = quiz_id
        quiz["difficulty"] = difficulty
        quiz["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
        quiz["text_length"] = len(text)
        quiz["source"] = source
        quizzes[quiz_id] = quiz
        return jsonify(quiz), 201
    except json.JSONDecodeError:
        return jsonify({"raw": result}), 200
    except Exception:
        app.logger.exception("quiz generation failed")
        return jsonify({"error": "internal error"}), 500

@app.route("/quizzes", methods=["GET"])
def list_quizzes():
    results = []
    for qid, q in list(quizzes.items())[-50:]:
        results.append({
            "id": qid,
            "title": q.get("title"),
            "description": q.get("description"),
            "difficulty": q.get("difficulty"),
            "question_count": len(q.get("questions", [])),
            "generated_at": q.get("generated_at"),
        })
    return jsonify({"quizzes": results}), 200

@app.route("/quizzes/<quiz_id>", methods=["GET"])
def get_quiz(quiz_id):
    quiz = quizzes.get(quiz_id)
    if not quiz:
        return jsonify({"error": "quiz not found"}), 404
    return jsonify(quiz), 200

@app.route("/quizzes/<quiz_id>/answers", methods=["GET"])
def get_answers(quiz_id):
    quiz = quizzes.get(quiz_id)
    if not quiz:
        return jsonify({"error": "quiz not found"}), 404
    answers = []
    for q in quiz.get("questions", []):
        answers.append({
            "id": q.get("id"),
            "correct_answer": q.get("correct_answer"),
            "explanation": q.get("explanation"),
        })
    return jsonify({"quiz_id": quiz_id, "answers": answers}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "quizzes": len(quizzes), "version": "1.0.0"}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
