# List AI Assistants with Python and Flask

## What Does This Example Do?

Build a production-ready Flask endpoint that lists all your AI Assistants using the Telnyx Python SDK. This tutorial covers the client-based initialization pattern, proper serialization of SDK response objects, and comprehensive error handling for a robust API layer over Telnyx AI Assistants.

By the end, you'll have a running Flask server with a `GET /assistants` endpoint that returns a clean JSON array of your AI Assistants — ready to power a dashboard, admin panel, or integration workflow.

## Who Is This For?

- **Python developers** building ai features with Flask.
- **Backend engineers** integrating telephony or messaging into existing applications.
- **DevOps teams** looking for containerized, production-ready telecom examples.
- **Startups and enterprises** replacing legacy telecom providers with a modern API-first platform.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform that gives developers a single API for voice, messaging, SIP, AI, and IoT — no Frankenstack required.

- **Integrated platform** — Voice, SMS, SIP trunking, AI assistants, and IoT SIM management under one roof. No stitching together multiple vendors.
- **Global private network** — Calls and messages traverse the Telnyx-owned IP network for lower latency and higher reliability than the public internet.
- **Developer-first** — SDKs for Python, Node.js, Go, Ruby, Java, and PHP. Comprehensive webhook event model. Sandbox environment for testing.
- **Competitive pricing** — Pay-as-you-go with no minimums, contracts, or per-seat fees.

## Prerequisites

- Python 3.8 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- At least one AI Assistant created in the Telnyx Portal (so the list endpoint returns data).
- pip (Python package manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/list-ai-assistants-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/list-ai-assistants-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and start by initializing the Telnyx client. Define a helper function that calls the API and returns a plain list of dictionaries — SDK response objects are **not** JSON-serializable, so you must extract fields explicitly:

```python
import os
import telnyx
from dotenv import load_dotenv

load_dotenv()

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def fetch_assistants() -> list[dict]:
    """Retrieve all AI Assistants and return JSON-serializable data."""
    response = client.ai_assistants.list()

    # SDK objects are NOT JSON-serializable — always unpack to plain dicts
    return [
        {
            "id": assistant.id,
            "name": assistant.name,
            "model": assistant.model,
            "instructions": assistant.instructions,
            "enabled_features": assistant.enabled_features,
            "created_at": assistant.created_at,
        }
        for assistant in response.data
    ]
```

Key points about this helper:

- It uses `client.ai_assistants.list()` — note the flat namespace (`ai_assistants`, **not** `ai.assistants`).
- Each assistant object is unpacked into a plain dictionary so Flask's `jsonify` can serialize it.
- No exception handling here — errors bubble up to the route handler where they belong.

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces, surrounding quotes, or newline characters. If the key was recently regenerated, update your `.env` file and restart the Flask server. |
| Empty Array Returned | The endpoint returns `[]` even though you expect assistants to exist. | Confirm that AI Assistants have been created under the same Telnyx account whose API key you are using. Log in to the [Telnyx Portal](https://portal.telnyx.com), navigate to the AI Assistants section, and verify at least one assistant exists. If you have multiple API keys (e.g., test vs. production), ensure you are using the correct one. |
| Environment Variable Not Loaded | The application crashes with `None` passed as the API key, or you see an `AuthenticationError` immediately on startup. | Confirm your `.env` file exists in the same directory where you run `python app.py` and is named exactly `.env` (not `.env.txt` or `env`). The `load_dotenv()` call must execute before `telnyx.Telnyx()` is instantiated — verify the import and call order at the top of your file. |
| Connection Error (503) | The endpoint returns `{"error": "Network error connecting to Telnyx"}` with HTTP 503. | Check your internet connection and verify that outbound HTTPS traffic to `api.telnyx.com` is not blocked by a firewall or proxy. If you are behind a corporate network, you may need to configure proxy settings for the Python process. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this AI example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What Python version do I need?**

Python 3.8 or higher. Python 3.12+ is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [AI Assistants Guide](https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant)
- [Assistants API Reference](https://developers.telnyx.com/api-reference/assistants/create-an-assistant)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx AI Assistants](https://telnyx.com/ai-assistants)
- [Voice AI Agents](https://telnyx.com/products/voice-ai-agents)

## Related Examples

- [Get an AI Assistant](/tutorials/ai/python/get-ai-assistant).
- [Create an AI Assistant](/tutorials/ai/python/create-ai-assistant).
- [Chat with an AI Assistant](/tutorials/ai/python/chat-with-ai-assistant).
