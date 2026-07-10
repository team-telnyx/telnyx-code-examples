#!/usr/bin/env python3
"""AI Changelog Generator — turn git diffs and commit messages into a human-readable changelog via Telnyx AI Inference."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
changelogs = {}

def call_inference(messages, max_tokens=4000):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.3}, timeout=40)
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

def build_changelog_prompt(commits, version=None, repo_name=None):
    commit_block = "\n".join(f"- {c}" for c in commits)
    version_line = f" for version {version}" if version else ""
    repo_line = f" Project: {repo_name}." if repo_name else ""
    return f"""You are a release engineer. Generate a clean, human-readable changelog{version_line}.{repo_line}

Commit messages:
{commit_block}

Group entries under these headings when applicable: Features, Bug Fixes, Improvements, Breaking Changes, Documentation, Other.
Use concise bullet points written in the imperative mood (e.g. "Add retry logic to SMS send").
Drop merge commits and trivial chore entries.
Return JSON: version (string|null), date (ISO 8601), sections (array of {{heading, items[]}}), summary (one-sentence TL;DR)."""

@app.route("/generate", methods=["POST"])
def generate_changelog():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    commits = data.get("commits", [])
    if not commits:
        return jsonify({"error": "commits field is required"}), 400
    version = data.get("version")
    repo_name = data.get("repo_name")
    prompt = build_changelog_prompt(commits, version, repo_name)
    try:
        result = call_inference([
            {"role": "system", "content": "You generate developer-friendly changelogs from git history."},
            {"role": "user", "content": prompt},
        ])
        changelog = json.loads(result)
        changelog_id = f"cl-{int(time.time())}"
        changelog["id"] = changelog_id
        changelog["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
        changelog["commit_count"] = len(commits)
        changelogs[changelog_id] = changelog
        return jsonify(changelog), 200
    except json.JSONDecodeError:
        return jsonify({"raw": result}), 200
    except Exception:
        app.logger.exception("changelog generation failed")
        return jsonify({"error": "internal error"}), 500

@app.route("/generate/from-diff", methods=["POST"])
def generate_from_diff():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    diff = data.get("diff", "")
    if not diff.strip():
        return jsonify({"error": "diff field is required"}), 400
    version = data.get("version")
    prompt = f"""Summarize this git diff into a concise changelog. Group entries under: Features, Bug Fixes, Improvements, Breaking Changes, Documentation.{' Tag as version ' + version + '.' if version else ''}

Diff:
{diff[:8000]}

Return JSON: version (string|null), sections (array of {{heading, items[]}}), summary (one-sentence TL;DR)."""
    try:
        result = call_inference([
            {"role": "system", "content": "You generate developer-friendly changelogs from git diffs."},
            {"role": "user", "content": prompt},
        ], max_tokens=1500)
        changelog = json.loads(result)
        changelog_id = f"cl-{int(time.time())}"
        changelog["id"] = changelog_id
        changelog["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
        changelogs[changelog_id] = changelog
        return jsonify(changelog), 200
    except json.JSONDecodeError:
        return jsonify({"raw": result}), 200
    except Exception:
        app.logger.exception("diff changelog generation failed")
        return jsonify({"error": "internal error"}), 500

@app.route("/changelogs", methods=["GET"])
def list_changelogs():
    results = list(changelogs.values())[-50:]
    return jsonify({"changelogs": results}), 200

@app.route("/changelogs/<changelog_id>", methods=["GET"])
def get_changelog(changelog_id):
    changelog = changelogs.get(changelog_id)
    if not changelog:
        return jsonify({"error": "changelog not found"}), 404
    return jsonify(changelog), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "changelogs": len(changelogs), "version": "1.0.0"}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
