# Build Structured JSON Extraction with Telnyx AI

This example turns messy text into validated JSON-shaped output with Telnyx AI Inference.

## How It Works

```
Text input -> Flask API -> Telnyx AI Inference -> parsed JSON
```

The app sends the user's text plus a JSON Schema to `POST /v2/ai/chat/completions` and asks the model to return only one JSON object.

## Prerequisites

- Python 3.10+
- Telnyx account
- Telnyx API key

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/extract-structured-json-with-ai-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` and set `TELNYX_API_KEY`.

## Step 2: Run the App

```bash
python app.py
```

The server starts on `http://localhost:5000`.

## Step 3: Try the Sample

```bash
curl http://localhost:5000/sample
```

Copy the sample text into the extraction endpoint:

```bash
curl -X POST http://localhost:5000/extract \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Account: Acme Health. Production verification jobs started failing after an API key rotation. Users cannot finish signup. Logs show 401 errors."
  }'
```

## Step 4: Use Your Own Schema

Send a custom schema when your application needs different fields:

```bash
curl -X POST http://localhost:5000/extract \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Lead from Northstar Logistics wants pricing for 20 numbers and SMS campaigns.",
    "schema": {
      "type": "object",
      "properties": {
        "company": {"type": "string"},
        "intent": {"type": "string"},
        "requested_products": {"type": "array", "items": {"type": "string"}}
      },
      "required": ["company", "intent", "requested_products"]
    }
  }'
```

## Going to Production

- Keep schemas small and specific.
- Validate the returned JSON before writing to a database.
- Add authentication to the local API before exposing it publicly.
- Log model failures without storing sensitive customer text.

## Resources

- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Chat completions API](https://developers.telnyx.com/api/inference/chat-completions)
- [Telnyx Portal](https://portal.telnyx.com)
