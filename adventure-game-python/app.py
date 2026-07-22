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

SYSTEM_PROMPT = """You are a game master for a text-based choose-your-own-adventure game. You create immersive, branching stories with clear objectives and satisfying endings.

## Game Structure
The game runs for exactly 3 turns:
- Turn 1 (opening): Introduce the world, the player's character, and a clear OBJECTIVE they must pursue. Set the scene and give 3 choices that each move the player toward the objective in different ways.
- Turn 2 (middle): Advance the story based on the player's choice. Introduce a complication, discovery, or obstacle. The player should feel they're making progress (or facing setbacks) toward the objective. Give 3 choices.
- Turn 3 (finale): Resolve the story. The player either achieves the objective (status "won"), fails (status "lost"), or finds an alternate way out (status "escaped"). Write a dramatic, satisfying conclusion (4-6 sentences) that wraps up the narrative arc. Do NOT offer choices on turn 3.

## Rules
- Write vivid, immersive scenes. Turn 1 and 2: 3-5 sentences. Turn 3: 4-6 sentences.
- Track game state: location, health (0-100), inventory, and turn count.
- The player can find items, take damage, heal, or change location based on choices.
- Choices on turns 1 and 2 should be meaningful and distinct — each should clearly lead to different consequences.
- On turn 3, the ending must be a direct consequence of the player's choices and current state (health, inventory). A player with high health and good items should be more likely to win.
- Do not kill the player before turn 3. On turn 3, death is possible if the player made poor choices.
- Keep the tone consistent with the genre.

## Response Format
Return JSON only:

### Turns 1 and 2 (ongoing):
{
  "objective": "the player's quest/goal (same as turn 1, carry it forward)",
  "scene": "the scene description (3-5 sentences)",
  "choices": ["choice 1", "choice 2", "choice 3"],
  "state": {"location": "...", "health": int, "inventory": ["..."], "turn": int},
  "status": "ongoing"
}

### Turn 3 (finale):
{
  "objective": "the player's quest/goal",
  "scene": "the dramatic conclusion (4-6 sentences)",
  "outcome": "1-2 sentences explaining WHY the player won, lost, or escaped — tie it to their choices and state",
  "summary": "2-3 sentences recapping the adventure: what happened, key items found, final state",
  "choices": [],
  "state": {"location": "...", "health": int, "inventory": ["..."], "turn": 3},
  "status": "won" | "lost" | "escaped"
}
"""

def build_game_prompt(genre, player_name, history, choice_index=None):
    intro = f"Genre: {genre}. Player name: {player_name}."
    if not history:
        return f"{intro}\n\nStart a new adventure. Generate the opening scene with a clear objective, and 3 choices. Remember this is turn 1 of 3."
    prompt_parts = [intro, "\nStory so far (most recent first):"]
    for entry in reversed(history[-MAX_HISTORY:]):
        prompt_parts.append(f"\nTurn {entry.get('state', {}).get('turn', '?')}:")
        prompt_parts.append(f"Objective: {entry.get('objective', 'N/A')}")
        prompt_parts.append(f"Scene: {entry.get('scene', '')}")
        if entry.get("outcome"):
            prompt_parts.append(f"Outcome: {entry['outcome']}")
        if entry.get("summary"):
            prompt_parts.append(f"Summary: {entry['summary']}")
        prompt_parts.append(f"Choices: {entry.get('choices', [])}")
        prompt_parts.append(f"State: {json.dumps(entry.get('state', {}))}")
        if entry.get("player_choice"):
            prompt_parts.append(f"Player chose: {entry['player_choice']}")
    if choice_index is not None:
        last = history[-1]
        choices = last.get("choices", [])
        if 1 <= choice_index <= len(choices):
            prompt_parts.append(f"\nThe player chose option {choice_index}: {choices[choice_index - 1]}")
            next_turn = last.get("state", {}).get("turn", 0) + 1
            if next_turn >= MAX_TURNS:
                prompt_parts.append(f"\nThis is turn {next_turn} of {MAX_TURNS} — the FINALE. Resolve the story with a dramatic conclusion. Decide if the player wins, loses, or escapes based on their choices and current state. Include the 'outcome' and 'summary' fields. Set 'choices' to an empty array. Set 'status' to 'won', 'lost', or 'escaped'.")
            else:
                prompt_parts.append(f"\nThis is turn {next_turn} of {MAX_TURNS}. Continue the story based on the player's choice. Generate the next scene and 3 new choices. Remember the objective and keep the narrative moving toward a conclusion.")
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
        return jsonify(format_turn_response(turn, game_id)), 201
    except json.JSONDecodeError:
        return jsonify({"raw": result}), 200
    except Exception:
        app.logger.exception("game start failed")
        return jsonify({"error": "internal error"}), 500

def format_turn_response(turn, game_id):
    resp = {
        "game_id": game_id,
        "objective": turn.get("objective"),
        "scene": turn.get("scene"),
        "choices": turn.get("choices", []),
        "state": turn.get("state"),
        "status": turn.get("status", "ongoing"),
    }
    if turn.get("outcome"):
        resp["outcome"] = turn["outcome"]
    if turn.get("summary"):
        resp["summary"] = turn["summary"]
    return resp

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
        return jsonify(format_turn_response(turn, game_id)), 200
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
        "objective": game["current"].get("objective"),
        "scene": game["current"].get("scene"),
        "choices": game["current"].get("choices", []),
        "state": game["current"].get("state"),
        "status": game["current"].get("status", "ongoing"),
        "outcome": game["current"].get("outcome"),
        "summary": game["current"].get("summary"),
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
            "objective": g["current"].get("objective"),
            "status": g["current"].get("status", "ongoing"),
            "turn": len(g["history"]),
        })
    return jsonify({"games": results}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "games": len(games), "version": "1.0.0"}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
