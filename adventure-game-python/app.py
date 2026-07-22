#!/usr/bin/env python3
"""AI Adventure Game — a text-based choose-your-own-adventure game powered by Telnyx AI Inference."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
games = {}
MAX_HISTORY = 20
MAX_TURNS = 3
VALID_GENRES = ["fantasy", "sci-fi", "mystery", "horror", "cyberpunk", "post-apocalyptic"]

def call_inference(messages, max_tokens=4000):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.8}, timeout=40)
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

SYSTEM_PROMPT = """You are a game master for a text-based choose-your-own-adventure game. You generate immersive, branching stories one scene at a time.

Rules:
- Each turn, write ONE scene (2-4 sentences) that advances the story based on the player's choice.
- Always provide exactly 3 choices the player can pick from next.
- Track game state: location, health (0-100), inventory, and turn count.
- The player can find items, take damage, heal, or change location based on choices.
- Do not kill the player before turn 3. On turn 3, the game MUST end — resolve the story with status "won" (player succeeded), "lost" (player failed or died), or "escaped" (player found a way out). Do not offer choices on the final turn.
- Keep the tone consistent with the genre.
- Return JSON only with this shape:
  {
    "scene": "the scene description (2-4 sentences)",
    "choices": ["choice 1", "choice 2", "choice 3"],
    "state": {"location": "...", "health": int, "inventory": ["..."], "turn": int},
    "status": "ongoing" | "won" | "lost" | "escaped"
  }
- On the final turn (turn 3), set "choices" to an empty array and "status" to "won", "lost", or "escaped".
"""

def build_game_prompt(genre, player_name, history, choice_index=None):
    intro = f"Genre: {genre}. Player name: {player_name}."
    if not history:
        return f"{intro}\n\nStart a new adventure. Generate the opening scene and 3 choices."
    prompt_parts = [intro, "\nStory so far (most recent first):"]
    for entry in reversed(history[-MAX_HISTORY:]):
        prompt_parts.append(f"\nTurn {entry['state']['turn']}:")
        prompt_parts.append(f"Scene: {entry['scene']}")
        prompt_parts.append(f"Choices: {entry['choices']}")
        if entry.get("player_choice"):
            prompt_parts.append(f"Player chose: {entry['player_choice']}")
    if choice_index is not None:
        last = history[-1]
        choices = last.get("choices", [])
        if 1 <= choice_index <= len(choices):
            prompt_parts.append(f"\nThe player chose option {choice_index}: {choices[choice_index - 1]}")
            next_turn = last.get("state", {}).get("turn", 0) + 1
            if next_turn >= MAX_TURNS:
                prompt_parts.append(f"This is turn {next_turn} — the FINAL turn. Resolve the story with status \"won\", \"lost\", or \"escaped\". Do not offer choices.")
            else:
                prompt_parts.append("Continue the story based on this choice. Generate the next scene and 3 new choices.")
    return "\n".join(prompt_parts)

@app.route("/game/start", methods=["POST"])
def start_game():
    data = request.get_json() or {}
    genre = data.get("genre", "fantasy").lower().strip()
    if genre not in VALID_GENRES:
        return jsonify({"error": f"genre must be one of: {', '.join(VALID_GENRES)}"}), 400
    player_name = data.get("player_name", "Adventurer").strip() or "Adventurer"
    prompt = build_game_prompt(genre, player_name, [])
    try:
        result = call_inference([
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ])
        turn = json.loads(result)
        game_id = f"game-{int(time.time())}"
        turn["player_choice"] = None
        history = [turn]
        games[game_id] = {
            "game_id": game_id,
            "genre": genre,
            "player_name": player_name,
            "history": history,
            "current": turn,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        return jsonify({
            "game_id": game_id,
            "scene": turn.get("scene"),
            "choices": turn.get("choices"),
            "state": turn.get("state"),
            "status": turn.get("status", "ongoing"),
        }), 201
    except json.JSONDecodeError:
        return jsonify({"raw": result}), 200
    except Exception:
        app.logger.exception("game start failed")
        return jsonify({"error": "internal error"}), 500

@app.route("/game/<game_id>/choose", methods=["POST"])
def make_choice(game_id):
    game = games.get(game_id)
    if not game:
        return jsonify({"error": "game not found"}), 404
    if game["current"].get("status", "ongoing") != "ongoing":
        return jsonify({"error": f"game is {game['current']['status']} — start a new game"}), 400
    current_turn = game["current"].get("state", {}).get("turn", 0)
    if current_turn >= MAX_TURNS:
        return jsonify({"error": f"game ended after {MAX_TURNS} turns — start a new game"}), 400
    data = request.get_json() or {}
    choice = data.get("choice")
    if choice is None or not isinstance(choice, int):
        return jsonify({"error": "choice must be an integer (1, 2, or 3)"}), 400
    choices = game["current"].get("choices", [])
    if choice < 1 or choice > len(choices):
        return jsonify({"error": f"choice must be between 1 and {len(choices)}"}), 400
    game["history"][-1]["player_choice"] = choices[choice - 1]
    prompt = build_game_prompt(game["genre"], game["player_name"], game["history"], choice)
    try:
        result = call_inference([
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ])
        turn = json.loads(result)
        turn["player_choice"] = None
        game["history"].append(turn)
        if len(game["history"]) > MAX_HISTORY:
            game["history"] = game["history"][-MAX_HISTORY:]
        game["current"] = turn
        return jsonify({
            "game_id": game_id,
            "scene": turn.get("scene"),
            "choices": turn.get("choices"),
            "state": turn.get("state"),
            "status": turn.get("status", "ongoing"),
        }), 200
    except json.JSONDecodeError:
        return jsonify({"raw": result}), 200
    except Exception:
        app.logger.exception("game turn failed")
        return jsonify({"error": "internal error"}), 500

@app.route("/game/<game_id>", methods=["GET"])
def get_game(game_id):
    game = games.get(game_id)
    if not game:
        return jsonify({"error": "game not found"}), 404
    return jsonify({
        "game_id": game_id,
        "genre": game["genre"],
        "player_name": game["player_name"],
        "scene": game["current"].get("scene"),
        "choices": game["current"].get("choices"),
        "state": game["current"].get("state"),
        "status": game["current"].get("status", "ongoing"),
        "turn": len(game["history"]),
        "created_at": game["created_at"],
    }), 200

@app.route("/games", methods=["GET"])
def list_games():
    results = []
    for gid, g in list(games.items())[-20:]:
        results.append({
            "game_id": gid,
            "genre": g["genre"],
            "player_name": g["player_name"],
            "status": g["current"].get("status", "ongoing"),
            "turn": len(g["history"]),
        })
    return jsonify({"games": results}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "games": len(games), "version": "1.0.0"}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
