# Build an AI Adventure Game

AI Adventure Game — a text-based choose-your-own-adventure game where every scene and choice is generated in real time by Telnyx AI Inference. Pick a genre, make choices, and the LLM spins a unique branching story with tracked inventory, health, and location.

## How It Works

```
  Player picks genre
        │
        ▼
  ┌──────────────────┐
  │ Your App          │
  │ (game state)      │
  └────────┬─────────┘
           │
           ├──► Telnyx AI Inference
           │
           ├──► Scene + choices + state (JSON)
           │
           ▼
  Player picks 1/2/3 ──► Next scene ──► ... ──► win/lose/escape
```

## Telnyx Products Used

- **AI Inference** — LLM inference with OpenAI-compatible API, runs on Telnyx infrastructure

## API Endpoints

- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/adventure-game-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py`. Here's what each piece does.

### Helper Functions

- **`call_inference()`** — Sends the game prompt to Telnyx AI Inference and returns the model's response. Uses a higher temperature (0.8) for creative storytelling. Handles reasoning models with large `max_tokens` and strips markdown fences.
- **`build_game_prompt()`** — Constructs the prompt from the genre, player name, and story history. Passes the last 20 turns so the LLM has continuity context.

### Game State

Each game tracks:
- **`game_id`** — unique ID for the game session
- **`genre`** — fantasy, sci-fi, mystery, horror, cyberpunk, or post-apocalyptic
- **`player_name`** — the character's name
- **`history`** — list of all past turns (scenes, choices, player decisions)
- **`current`** — the latest scene, choices, and state

State fields per turn:
- **`location`** — where the player currently is
- **`health`** — 0–100, reaches 0 = game over
- **`inventory`** — items collected during the adventure
- **`turn`** — turn counter
- **`status`** — `ongoing`, `won`, `lost`, or `escaped`

### System Prompt

The system prompt enforces:
- One scene per turn (2–4 sentences)
- Exactly 3 choices per turn
- Tracked state (location, health, inventory, turn)
- No player death before turn 5
- JSON-only output

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/game/start` | Start a new game |
| `POST` | `/game/<id>/choose` | Make a choice |
| `GET` | `/game/<id>` | View game state |
| `GET` | `/games` | List games |
| `GET` | `/health` | Health check |

The inference helper sends the game prompt to Telnyx AI:

```python
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
```

The choose endpoint continues the story based on the player's pick:

```python
@app.route("/game/<game_id>/choose", methods=["POST"])
def make_choice(game_id):
    game = games.get(game_id)
    choice = data.get("choice")
    game["history"][-1]["player_choice"] = choices[choice - 1]
    prompt = build_game_prompt(game["genre"], game["player_name"], game["history"], choice)
    result = call_inference([
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ])
    turn = json.loads(result)
    game["history"].append(turn)
    game["current"] = turn
    return jsonify(turn)
```

## Step 3: Run It

```bash
python app.py
```

Server starts on `http://localhost:5000`.

## Step 4: Play It

**Start a fantasy adventure:**

```bash
curl -X POST http://localhost:5000/game/start \
  -H "Content-Type: application/json" \
  -d '{"genre":"fantasy","player_name":"Aria"}' | python3 -m json.tool
```

**Make a choice (pick 1, 2, or 3):**

```bash
curl -X POST http://localhost:5000/game/game-<id>/choose \
  -H "Content-Type: application/json" \
  -d '{"choice":1}' | python3 -m json.tool
```

**Check your game state:**

```bash
curl http://localhost:5000/game/game-<id> | python3 -m json.tool
```

**Try different genres:**

```bash
curl -X POST http://localhost:5000/game/start \
  -H "Content-Type: application/json" \
  -d '{"genre":"horror","player_name":"Sam"}'

curl -X POST http://localhost:5000/game/start \
  -H "Content-Type: application/json" \
  -d '{"genre":"cyberpunk","player_name":"Void"}'

curl -X POST http://localhost:5000/game/start \
  -H "Content-Type: application/json" \
  -d '{"genre":"post-apocalyptic","player_name":"Scout"}'
```

## Going to Production

This example uses in-memory storage for simplicity. For production:

- **Database** — persist game state in Redis or PostgreSQL so games survive restarts
- **Authentication** — add API key validation and per-user game isolation
- **Multiplayer** — allow multiple players in the same generated world
- **Streaming** — use streaming completions so scenes appear word-by-word
- **Image generation** — generate a scene illustration for each turn
- **Rate limiting** — protect your endpoints from abuse
- **Prompt engineering** — tune the system prompt for different narrative styles

## Run

```bash
pip install -r requirements.txt
python app.py
```

## Resources

- [Source code and reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/adventure-game-python/README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
