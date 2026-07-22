## `POST /game/start`

Start a new adventure game.

### Request

```json
{
  "genre": "fantasy",
  "player_name": "Aria"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `genre` | `string` | no | Game genre (default `fantasy`). Valid: `fantasy`, `sci-fi`, `mystery`, `horror`, `cyberpunk`, `post-apocalyptic` |
| `player_name` | `string` | no | Character name (default `Adventurer`) |

### Response `201`

```json
{
  "game_id": "game-1750280400",
  "scene": "Aria awakens beneath the twisted boughs...",
  "choices": ["choice 1", "choice 2", "choice 3"],
  "state": {
    "location": "Eldergrove",
    "health": 100,
    "inventory": [],
    "turn": 1
  },
  "status": "ongoing"
}
```

**Try it:**

```bash
curl -X POST http://localhost:5000/game/start \
  -H "Content-Type: application/json" \
  -d '{"genre":"sci-fi","player_name":"Rex"}'
```

---

## `POST /game/<id>/choose`

Make a choice and get the next scene.

### Request

```json
{
  "choice": 1
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `choice` | `integer` | **yes** | Which choice to pick (1, 2, or 3) |

### Response `200`

```json
{
  "game_id": "game-1750280400",
  "scene": "The path leads to a crumbling stone bridge...",
  "choices": ["Cross the bridge", "Search beneath it", "Turn back"],
  "state": {
    "location": "Stone Bridge",
    "health": 100,
    "inventory": ["tattered map", "silver key"],
    "turn": 2
  },
  "status": "ongoing"
}
```

### Response `400`

```json
{"error": "game is won — start a new game"}
```

**Try it:**

```bash
curl -X POST http://localhost:5000/game/game-1750280400/choose \
  -H "Content-Type: application/json" \
  -d '{"choice":2}'
```

---

## `GET /game/<id>`

View the current game state.

### Response `200`

```json
{
  "game_id": "game-1750280400",
  "genre": "fantasy",
  "player_name": "Aria",
  "scene": "The path leads to a crumbling stone bridge...",
  "choices": ["Cross the bridge", "Search beneath it", "Turn back"],
  "state": {
    "location": "Stone Bridge",
    "health": 100,
    "inventory": ["tattered map", "silver key"],
    "turn": 2
  },
  "status": "ongoing",
  "turn": 2,
  "created_at": "2026-07-22T10:06:01Z"
}
```

### Response `404`

```json
{"error": "game not found"}
```

**Try it:**

```bash
curl http://localhost:5000/game/game-1750280400
```

---

## `GET /games`

List all recent games (most recent 20).

### Response `200`

```json
{
  "games": [
    {
      "game_id": "game-1750280400",
      "genre": "fantasy",
      "player_name": "Aria",
      "status": "ongoing",
      "turn": 2
    }
  ]
}
```

**Try it:**

```bash
curl http://localhost:5000/games
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "games": 1,
  "version": "1.0.0"
}
```

**Try it:**

```bash
curl http://localhost:5000/health
```

---

## Error Handling

All endpoints return JSON. On error:

```json
{
  "error": "game not found"
}
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `201` | Game created |
| `400` | Bad request — invalid choice, game ended, or invalid genre |
| `404` | Game not found |
| `500` | Server error |
