# Build an AI Moderation Classifier

AI Moderation Classifier — classify user-generated content as safe/spam/abuse/hate/harassment/self-harm using a two-stage pipeline: embeddings pre-filter against a known-bad blocklist, then LLM judgment for nuanced cases via Telnyx AI Inference.

## How It Works

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

## Telnyx Products Used

- **AI Inference (Embeddings)** — Generate embedding vectors for blocklist similarity matching
- **AI Inference (Chat Completions)** — LLM judgment for nuanced content classification

## API Endpoints

- **AI Embeddings**: `POST /v2/ai/openai/embeddings` — [API reference](https://developers.telnyx.com/api/inference/create-embeddings)
- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/moderation-classifier-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py`. Here's what each piece does.

### Two-Stage Pipeline

**Stage 1 — Embeddings pre-filter:**
- Content is embedded via the Telnyx embeddings API
- Cosine similarity is computed against the blocklist vector store
- If similarity ≥ 0.95, the content is auto-flagged with the blocklist entry's category
- This skips the LLM call entirely — fast and cheap for known spam/abuse patterns

**Stage 2 — LLM judgment:**
- If no blocklist match (or score < 0.95), the content is sent to the LLM
- The LLM classifies it as safe, spam, abuse, hate, harassment, or self_harm
- Returns confidence, flags, recommended action, and a human-readable reason

### Helper Functions

- **`call_inference()`** — Sends the moderation prompt to Telnyx AI Inference. Handles reasoning models with large `max_tokens` and fence stripping.
- **`get_embeddings()`** — Sends text to the Telnyx embeddings API and returns vector representations. Batches requests for efficiency.
- **`cosine_similarity()`** — Computes cosine similarity between a content vector and all blocklist vectors.
- **`check_blocklist()`** — Embeds the content, checks against the blocklist, returns the matched category and score (or None if no match).

### Sample Blocklist

The bundled `sample_blocklist.json` contains 10 known-bad entries:
- **spam** (4) — gift card scams, work-from-home, fake followers, iPhone giveaway
- **abuse** (2) — personal attacks, insults
- **hate** (2) — xenophobic, discriminatory
- **harassment** (2) — threats, stalking

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/blocklist/index` | Build the embeddings index |
| `POST` | `/moderate` | Classify single content |
| `POST` | `/moderate/batch` | Classify up to 20 items |
| `POST` | `/blocklist` | Add a blocklist entry |
| `GET` | `/blocklist` | List blocklist entries |
| `GET` | `/moderations` | List moderation decisions |
| `GET` | `/moderations/<id>` | Get a specific decision |
| `GET` | `/stats` | Moderation statistics |
| `GET` | `/health` | Health check |

The moderation endpoint runs the two-stage pipeline:

```python
@app.route("/moderate", methods=["POST"])
def moderate_content():
    content = data.get("content", "").strip()
    # Stage 1: check blocklist
    matched_category, blocklist_score = check_blocklist(content)
    if matched_category:
        result = {"category": matched_category, "confidence": blocklist_score, ...}
    else:
        # Stage 2: LLM judgment
        result = call_inference([system_prompt, user_prompt])
        result = json.loads(result)
    return jsonify(result)
```

## Step 3: Run It

```bash
python app.py
```

Server starts on `http://localhost:5000`.

## Step 4: Test It

**Build the blocklist index (required before moderating):**

```bash
curl -X POST http://localhost:5000/blocklist/index
```

**Moderate content (blocklist match — skips LLM):**

```bash
curl -X POST http://localhost:5000/moderate \
  -H "Content-Type: application/json" \
  -d '{"content":"Congratulations! You won a $1000 gift card. Click here to claim your prize now!","source":"comment"}' | python3 -m json.tool
```

**Moderate content (LLM judgment — no blocklist match):**

```bash
curl -X POST http://localhost:5000/moderate \
  -H "Content-Type: application/json" \
  -d '{"content":"Great product, really enjoyed using it. Would recommend to friends.","source":"review"}' | python3 -m json.tool
```

**Batch moderation:**

```bash
curl -X POST http://localhost:5000/moderate/batch \
  -H "Content-Type: application/json" \
  -d '{"items":[{"content":"Great product!"},{"content":"You are a worthless loser"},{"content":"Buy cheap followers now!"}]}' | python3 -m json.tool
```

**Add a custom blocklist entry:**

```bash
curl -X POST http://localhost:5000/blocklist \
  -H "Content-Type: application/json" \
  -d '{"text":"New scam pattern to block","category":"spam"}'
```

**Check stats:**

```bash
curl http://localhost:5000/stats | python3 -m json.tool
```

## Going to Production

This example uses in-memory storage for simplicity. For production:

- **Database** — persist blocklist entries and moderation decisions in PostgreSQL or Redis
- **Async processing** — use a queue (Celery, SQS) for batch moderation of large volumes
- **Human review queue** — surface `flag` and `escalate` items to a moderation dashboard
- **Feedback loop** — let moderators correct false positives/negatives and feed them back into the blocklist
- **Rate limiting** — protect your endpoints from abuse
- **Multi-language** — tune the LLM prompt for non-English content
- **Threshold tuning** — adjust `SPAM_THRESHOLD` and `AMBIGUOUS_THRESHOLD` based on your false positive rate

## Run

```bash
pip install -r requirements.txt
python app.py
```

## Resources

- [Source code and reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/moderation-classifier-python/README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
