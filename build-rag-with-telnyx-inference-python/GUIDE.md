# Build RAG with Telnyx Inference

This example builds a small retrieval-augmented generation API. It embeds a sample knowledge base, retrieves the most relevant documents for a question, and asks Telnyx AI Inference to answer from that context.

## How It Works

```
Question -> embedding -> document retrieval -> chat completion -> grounded answer
```

The sample app stores documents and embeddings in memory so the flow is easy to inspect. In production, you would usually store vectors in a database or search service.

## Prerequisites

- Python 3.10+
- Telnyx account
- Telnyx API key

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-rag-with-telnyx-inference-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` and set `TELNYX_API_KEY`.

## Step 2: Run the App

```bash
python app.py
```

The server starts on `http://localhost:5000`.

## Step 3: Inspect the Knowledge Base

```bash
curl http://localhost:5000/documents
```

The app includes a small support-document set for authentication, rate limits, webhooks, verification message delivery, and billing.

## Step 4: Ask a Grounded Question

```bash
curl -X POST http://localhost:5000/rag/ask \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Users cannot receive verification codes after an API key rotation. Logs show 401 errors. What should we check?"
  }'
```

The response includes the answer and the source titles used by the model.

## Step 5: Extend the Example

- Replace `DOCUMENTS` in `app.py` with your own docs.
- Split long docs into smaller chunks before embedding.
- Store embeddings in a vector database instead of memory.
- Add authentication before exposing the API publicly.

## Resources

- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Chat completions API](https://developers.telnyx.com/api/inference/chat-completions)
- [Telnyx Portal](https://portal.telnyx.com)
