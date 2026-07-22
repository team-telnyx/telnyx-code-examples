---
name: moderation-classifier
title: "AI Moderation Classifier"
description: "AI Moderation Classifier — classify user-generated content as safe/spam/abuse/hate/harassment/self-harm using embeddings pre-filter + LLM judgment via Telnyx AI Inference."
language: python
framework: flask
telnyx_products: [AI Inference]
---

# AI Moderation Classifier

AI Moderation Classifier — classify user-generated content as safe/spam/abuse/hate/harassment/self-harm using a two-stage pipeline: embeddings pre-filter against a known-bad blocklist, then LLM judgment for nuanced cases via Telnyx AI Inference.

## Telnyx API Endpoints Used

- **AI Embeddings**: `POST /v2/ai/openai/embeddings` — [API reference](https://developers.telnyx.com/api/inference/create-embeddings)
- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Architecture

```
  User-generated content
        │
        ▼
  ┌──────────────────────────┐
  │ Stage 1: Embeddings       │
  │ (blocklist pre-filter)    │
  └────────┬─────────────────┘
           │
     score >= 0.95?
      ├── YES → auto-flag (spam/abuse/hate) — skip LLM
      └── NO  → Stage 2: LLM judgment
                    │
                    ▼
              category + confidence + flags + action
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | Telnyx AI Inference model name | [Portal](https://developers.telnyx.com/docs/inference/models) |
| `EMBEDDING_MODEL` | `string` | `thenlper/gte-large` | no | Telnyx embedding model name | [Available models](https://developers.telnyx.com/docs/inference/models) |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/moderation-classifier-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

## API Reference

### `POST /blocklist/index`

Build the embeddings index from the bundled sample blocklist (or a provided list). Must be called before moderating.

```bash
curl -X POST http://localhost:5000/blocklist/index
```

**Response:**

```json
{
  "status": "indexed",
  "blocklist_count": 10,
  "indexed_at": "2026-07-22T14:48:52Z"
}
```

### `POST /moderate`

Classify a single piece of user-generated content.

```bash
curl -X POST http://localhost:5000/moderate \
  -H "Content-Type: application/json" \
  -d '{
    "content": "You people are all the same, go back to where you came from",
    "source": "comment",
    "author_id": "user-123"
  }'
```

**Response (blocklist match — skips LLM):**

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

**Response (LLM judgment — no blocklist match):**

```json
{
  "id": "mod-1750280401",
  "content": "Great product, really enjoyed using it.",
  "category": "safe",
  "confidence": 1.0,
  "flags": [],
  "blocklist_match": false,
  "blocklist_score": 0.76,
  "recommended_action": "allow",
  "reason": "Benign positive product review with no policy violations.",
  "source": "review",
  "generated_at": "2026-07-22T14:30:01Z"
}
```

### `POST /moderate/batch`

Classify up to 20 content items in one request.

```bash
curl -X POST http://localhost:5000/moderate/batch \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"content": "Great product!", "source": "review"},
      {"content": "You are a worthless loser", "source": "comment"},
      {"content": "Buy cheap followers now!", "source": "message"}
    ]
  }'
```

**Response:**

```json
{
  "results": [...],
  "summary": {
    "total": 3,
    "by_category": {"safe": 1, "abuse": 1, "spam": 1},
    "remove": 2,
    "flag": 0,
    "allow": 1,
    "escalate": 0
  }
}
```

### `POST /blocklist`

Add a new entry to the blocklist.

```bash
curl -X POST http://localhost:5000/blocklist \
  -H "Content-Type: application/json" \
  -d '{"text":"Known scam pattern here","category":"spam"}'
```

### `GET /blocklist`

List all blocklist entries.

```bash
curl http://localhost:5000/blocklist
```

### `GET /moderations`

List recent moderation decisions (filter by `?category=spam`).

```bash
curl http://localhost:5000/moderations
curl "http://localhost:5000/moderations?category=hate"
```

### `GET /moderations/<id>`

Fetch a specific moderation decision.

```bash
curl http://localhost:5000/moderations/mod-1750280400
```

### `GET /stats`

Moderation statistics (counts by category and action).

```bash
curl http://localhost:5000/stats
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
  "moderations": 5,
  "blocklist_count": 10,
  "blocklist_indexed": true,
  "version": "1.0.0"
}
```

## Categories & Actions

| Category | Description | Default Action |
|----------|-------------|----------------|
| `safe` | No issues | `allow` |
| `spam` | Promotional, scam, phishing | `remove` |
| `abuse` | Personal attacks, insults | `remove` |
| `hate` | Hate speech, discrimination | `remove` |
| `harassment` | Threats, stalking | `remove` |
| `self_harm` | Self-harm risk | `escalate` |

| Action | Meaning |
|--------|---------|
| `allow` | Content is safe, publish it |
| `flag` | Borderline, hold for human review |
| `remove` | Clear violation, auto-remove |
| `escalate` | Urgent, escalate to human moderator immediately |

## How the Two-Stage Pipeline Works

1. **Stage 1 — Embeddings pre-filter**: The content is embedded and compared via cosine similarity against the blocklist vectors. If similarity ≥ 0.95 to any blocklist entry, the content is auto-flagged with that entry's category. This skips the LLM call entirely — fast and cheap.

2. **Stage 2 — LLM judgment**: If no blocklist match (or score is below threshold), the content is sent to the LLM with a moderation prompt. The LLM returns category, confidence, flags, recommended action, and reason. This catches novel abuse that the blocklist doesn't cover.

## Sample Blocklist

The bundled `sample_blocklist.json` contains 10 known-bad entries across spam, abuse, hate, and harassment categories. Use `POST /blocklist/index` to build the embeddings index, or `POST /blocklist` to add more entries at runtime.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Invalid or missing API key | Verify `TELNYX_API_KEY` in `.env` matches your key in the [Portal](https://portal.telnyx.com/api-keys) |
| `blocklist index not built` | Index not built | Call `POST /blocklist/index` before moderating |
| Slow moderation | LLM being called for every item | Add more blocklist entries to catch more spam without the LLM |
| `raw` returned instead of JSON | Model didn't return parseable JSON | Retry or pin a stronger model |
| `numpy` not installed | Missing dependency | Run `pip install -r requirements.txt` |

## Related Examples

- [Semantic Search for Support Tickets (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/semantic-search-python/README.md)
- [AI Changelog Generator (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/changelog-generator-python/README.md)
- [AI Error Explainer (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/error-explainer-python/README.md)
- [Extract Structured JSON with AI (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/extract-structured-json-with-ai-python/README.md)

## Resources

- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Chat Completions API Reference](https://developers.telnyx.com/api/inference/chat-completions)
- [Embeddings API Reference](https://developers.telnyx.com/api/inference/create-embeddings)
- [Available Inference Models](https://developers.telnyx.com/docs/inference/models)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network.
