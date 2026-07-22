---
name: adventure-game
title: "AI Adventure Game"
description: "AI Adventure Game — a text-based choose-your-own-adventure game where every scene and choice is generated in real time by Telnyx AI Inference."
language: python
framework: flask
telnyx_products: [AI Inference]
---

# AI Adventure Game

AI Adventure Game — a text-based choose-your-own-adventure game where every scene and choice is generated in real time by Telnyx AI Inference. Pick a genre, make choices, and the LLM spins a unique branching story with tracked inventory, health, and location.

## Telnyx API Endpoints Used

- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Architecture

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

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | Telnyx AI Inference model name | [Portal](https://developers.telnyx.com/docs/inference/models) |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/adventure-game-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

## API Reference

### `POST /game/start`

Start a new adventure. Pick a genre and name your character.

```bash
curl -X POST http://localhost:5000/game/start \
  -H "Content-Type: application/json" \
  -d '{
    "genre": "fantasy",
    "player_name": "Aria"
  }'
```

**Response:**

```json
{
  "game_id": "game-1750280400",
  "scene": "Aria awakens beneath the twisted boughs of the Eldergrove...",
  "choices": [
    "Approach the crumbling tower through the mist",
    "Follow the luminescent mushroom path deeper into the grove",
    "Turn toward the howl and prepare to face whatever hunts in the dark"
  ],
  "state": {
    "location": "Eldergrove",
    "health": 100,
    "inventory": [],
    "turn": 1
  },
  "status": "ongoing"
}
```

**Genres:** `fantasy`, `sci-fi`, `mystery`, `horror`, `cyberpunk`, `post-apocalyptic`

### `POST /game/<id>/choose`

Make a choice (1, 2, or 3) and get the next scene.

```bash
curl -X POST http://localhost:5000/game/game-1750280400/choose \
  -H "Content-Type: application/json" \
  -d '{"choice": 1}'
```

**Response:**

```json
{
  "game_id": "game-1750280400",
  "scene": "The path leads to a crumbling stone bridge over a bottomless chasm...",
  "choices": [
    "Cross the bridge carefully",
    "Search beneath it",
    "Turn back to the clearing"
  ],
  "state": {
    "location": "Stone Bridge",
    "health": 100,
    "inventory": ["tattered map", "silver key"],
    "turn": 2
  },
  "status": "ongoing"
}
```

### `GET /game/<id>`

View the current game state.

```bash
curl http://localhost:5000/game/game-1750280400
```

### `GET /games`

List all recent games.

```bash
curl http://localhost:5000/games
```

### `GET /health`

Returns service health.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok",
  "games": 1,
  "version": "1.0.0"
}
```

## How It Works

1. **Start** — The LLM generates an opening scene based on the genre and 3 choices.
2. **Choose** — The player picks 1, 2, or 3. The app sends the full story history to the LLM for continuity.
3. **State** — Each turn tracks location, health (0–100), inventory, and turn count.
4. **Endings** — The game ends with `status: "won"`, `"lost"`, or `"escaped"`. The LLM won't kill the player before turn 5.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Invalid or missing API key | Verify `TELNYX_API_KEY` in `.env` matches your key in the [Portal](https://portal.telnyx.com/api-keys) |
| `400 game is won/lost` | The game has ended | Start a new game with `POST /game/start` |
| `400 choice must be between 1 and 3` | Invalid choice number | Use 1, 2, or 3 |
| Slow / empty response | Wrong model name | Verify `AI_MODEL` at [developers.telnyx.com](https://developers.telnyx.com/docs/inference/models) |
| `raw` returned instead of JSON | Model didn't return parseable JSON | Retry or pin a stronger model |

## Related Examples

- [AI Changelog Generator (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/changelog-generator-python/README.md)
- [AI Error Explainer (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/error-explainer-python/README.md)
- [AI SQL Natural Language (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sql-natural-language-python/README.md)
- [Semantic Search for Support Tickets (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/semantic-search-python/README.md)

## Resources

- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Chat Completions API Reference](https://developers.telnyx.com/api/inference/chat-completions)
- [Available Inference Models](https://developers.telnyx.com/docs/inference/models)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network.
