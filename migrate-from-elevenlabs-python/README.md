---
name: migrate-from-elevenlabs
title: "Migrate from ElevenLabs"
description: "Migrate from ElevenLabs — import ElevenLabs voice configurations to Telnyx TTS with voice mapping and cost comparison."
language: python
framework: flask
telnyx_products: [AI Assistants, Migration, Number Porting]
channel: [voice]
---

# Migrate from ElevenLabs

Migrate from ElevenLabs — import ElevenLabs voice configurations to Telnyx TTS with voice mapping and cost comparison.


## Telnyx API Endpoints Used

- **AI Inference**: `POST /v2/ai/chat/completions` -- [API reference](https://developers.telnyx.com/api/inference/chat-completions)


## Architecture

```text
┌─────────────┐     ┌────────────┐     ┌──────────────────────┐
│  Phone Call  │────►│   Telnyx   │────►│  POST /webhooks/voice│
└─────────────┘     │   Cloud    │     └──────────┬───────────┘
                    └────────────┘                │
                                                   │
                                                   ▼
                                          ┌─────────────────┐
                                          │ Response (SMS/  │
                                          │ Voice/Webhook)  │
                                          └─────────────────┘
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY...` | **yes** | Telnyx API v2 key | [→ link](https://portal.telnyx.com/api-keys) |
| `ELEVENLABS_API_KEY` | `string` | `...` | **yes** | elevenlabs api key | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/migrate-from-elevenlabs-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 5000
   ```

2. Copy the HTTPS URL and configure in [Telnyx Portal](https://portal.telnyx.com):

   - **Call Control Application** → Webhook URL → `https://<id>.ngrok.io/webhooks/voice`

### Docker

```bash
docker build -t migrate-from-elevenlabs .
docker run --env-file .env -p 5000:5000 migrate-from-elevenlabs
```

## API Reference

### `GET /audit/elevenlabs`

Handles `GET /audit/elevenlabs`.

**Request:**

```bash
curl http://localhost:5000/audit/elevenlabs
```

**Response:**

```json
{
  "elevenlabs_voices": "...",
  "total": 3,
  "auto_mappable": "..."
}
```

### `POST /migrate/voice-config`

Handles `POST /migrate/voice-config`.

**Request:**

```bash
curl -X POST http://localhost:5000/migrate/voice-config \
  -H "Content-Type: application/json" \
  -d '{
  "elevenlabs_voice_name": "Jane Doe",
  "speed": "1.0"
}'
```

**Response:**

```json
{
  "status": "ok"
}
```

### `GET /mapping/voices`

Handles `GET /mapping/voices`.

**Request:**

```bash
curl http://localhost:5000/mapping/voices
```

**Response:**

```json
{
  "mappings": "...",
  "custom_note": "..."
}
```

### `GET /cost-comparison`

Handles `GET /cost-comparison`.

**Request:**

```bash
curl http://localhost:5000/cost-comparison
```

**Response:**

```json
{
  "status": "ok"
}
```

### `POST /test-tts`

Handles `POST /test-tts`.

**Request:**

```bash
curl -X POST http://localhost:5000/test-tts \
  -H "Content-Type: application/json" \
  -d '{
  "voice_id": "en-US-Neural2-F"
}'
```

**Response:**

```json
{
  "status": "ok",
  "voice": "...",
  "note": "..."
}
```

### `GET /migration-log`

Returns log details.

**Request:**

```bash
curl http://localhost:5000/migration-log
```

**Response:**

```json
{
  "log": "..."
}
```

### `GET /health`

Returns service health and operational metrics.

**Request:**

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok"
}
```

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
