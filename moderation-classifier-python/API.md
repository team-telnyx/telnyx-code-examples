## `POST /blocklist/index`

Build the embeddings index from the bundled sample blocklist (or a provided list).

### Request (optional)

```json
{
  "entries": [
    {"id": "BLK-1", "text": "...", "category": "spam"}
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `entries` | `array[object]` | no | Custom blocklist entries. If omitted, uses bundled `sample_blocklist.json` |

### Response `200`

```json
{
  "status": "indexed",
  "blocklist_count": 10,
  "indexed_at": "2026-07-22T14:48:52Z"
}
```

**Try it:**

```bash
curl -X POST http://localhost:5000/blocklist/index
```

---

## `POST /moderate`

Classify a single piece of user-generated content.

### Request

```json
{
  "content": "You people are all the same, go back to where you came from",
  "source": "comment",
  "author_id": "user-123"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | `string` | **yes** | The UGC text to classify (max 4000 chars) |
| `source` | `string` | no | Content source (comment, review, message, post) |
| `author_id` | `string` | no | Author identifier |

### Response `200`

```json
{
  "id": "mod-1750280400",
  "content": "You people are all the same...",
  "category": "hate",
  "confidence": 0.99,
  "flags": ["blocklist_match:hate"],
  "blocklist_match": true,
  "blocklist_score": 0.99,
  "recommended_action": "remove",
  "reason": "Content matched a known hate entry in the blocklist with 0.99 similarity.",
  "source": "comment",
  "author_id": "user-123",
  "generated_at": "2026-07-22T14:30:00Z"
}
```

**Try it:**

```bash
curl -X POST http://localhost:5000/moderate \
  -H "Content-Type: application/json" \
  -d '{"content":"Great product!","source":"review"}'
```

---

## `POST /moderate/batch`

Classify up to 20 content items in one request.

### Request

```json
{
  "items": [
    {"content": "Great product!", "source": "review"},
    {"content": "Buy cheap followers now!", "source": "message"}
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `items` | `array[object]` | **yes** | List of content items (max 20) |

### Response `200`

```json
{
  "results": [
    {"id": "mod-...", "category": "safe", "recommended_action": "allow"},
    {"id": "mod-...", "category": "spam", "recommended_action": "remove"}
  ],
  "summary": {
    "total": 2,
    "by_category": {"safe": 1, "spam": 1},
    "remove": 1,
    "flag": 0,
    "allow": 1,
    "escalate": 0
  }
}
```

**Try it:**

```bash
curl -X POST http://localhost:5000/moderate/batch \
  -H "Content-Type: application/json" \
  -d '{"items":[{"content":"Great!"},{"content":"You are worthless"}]}'
```

---

## `POST /blocklist`

Add a new entry to the blocklist.

### Request

```json
{
  "text": "Known scam pattern here",
  "category": "spam",
  "id": "BLK-CUSTOM-1"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | `string` | **yes** | The blocklist entry text |
| `category` | `string` | no | Category (default `spam`) |
| `id` | `string` | no | Custom ID (auto-generated if omitted) |

### Response `201`

```json
{
  "status": "added",
  "id": "BLK-CUSTOM-1"
}
```

**Try it:**

```bash
curl -X POST http://localhost:5000/blocklist \
  -H "Content-Type: application/json" \
  -d '{"text":"New scam pattern","category":"spam"}'
```

---

## `GET /blocklist`

List all blocklist entries.

### Response `200`

```json
{
  "blocklist": [
    {"id": "BLK-001", "text": "...", "category": "spam", "added_at": "2025-01-01T00:00:00Z"}
  ],
  "count": 10
}
```

**Try it:**

```bash
curl http://localhost:5000/blocklist
```

---

## `GET /moderations`

List recent moderation decisions (most recent 50).

### Query Parameters

| Param | Type | Description |
|-------|------|-------------|
| `category` | `string` | Filter by category (safe, spam, abuse, hate, harassment, self_harm) |

### Response `200`

```json
{
  "moderations": [
    {"id": "mod-...", "category": "spam", "recommended_action": "remove"}
  ]
}
```

**Try it:**

```bash
curl http://localhost:5000/moderations
curl "http://localhost:5000/moderations?category=hate"
```

---

## `GET /moderations/<id>`

Fetch a specific moderation decision.

### Response `200`

```json
{
  "id": "mod-1750280400",
  "content": "...",
  "category": "hate",
  "confidence": 0.99,
  "recommended_action": "remove"
}
```

### Response `404`

```json
{"error": "moderation not found"}
```

**Try it:**

```bash
curl http://localhost:5000/moderations/mod-1750280400
```

---

## `GET /stats`

Moderation statistics.

### Response `200`

```json
{
  "total_moderations": 5,
  "blocklist_count": 10,
  "by_category": {"safe": 2, "spam": 2, "hate": 1},
  "by_action": {"allow": 2, "remove": 3},
  "blocklist_indexed": true,
  "indexed_at": "2026-07-22T14:48:52Z"
}
```

**Try it:**

```bash
curl http://localhost:5000/stats
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "moderations": 5,
  "blocklist_count": 10,
  "blocklist_indexed": true,
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
  "error": "invalid request body"
}
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `201` | Created (blocklist entry added) |
| `400` | Bad request — missing or invalid fields, or index not built |
| `404` | Moderation not found |
| `500` | Server error |
