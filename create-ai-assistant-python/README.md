# Create AI Assistant with Python and Flask

## What Does This Example Do?

Build a production-ready Flask endpoint that creates AI assistants using the Telnyx AI Assistants API. This tutorial demonstrates the client-based initialization pattern, proper error handling for AI services, and secure credential management via environment variables.

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
- pip (Python package manager).
- Basic understanding of REST APIs and JSON.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/create-ai-assistant-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/create-ai-assistant-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and initialize the Telnyx client using the new pattern. Define a helper function to handle assistant creation with proper validation:

```python
import os
import telnyx
from dotenv import load_dotenv

load_dotenv()

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def create_ai_assistant(name: str, instructions: str, model: str = "meta-llama/Meta-Llama-3.1-70B-Instruct", enabled_features: list = None) -> dict:
    """Create AI assistant via Telnyx and return JSON-serializable response data."""
    if not name or not instructions:
        raise ValueError("Name and instructions are required")
    
    # Default to messaging if no features specified
    if enabled_features is None:
        enabled_features = ["messaging"]
    
    # Validate enabled features
    valid_features = ["messaging", "telephony"]
    for feature in enabled_features:
        if feature not in valid_features:
            raise ValueError(f"Invalid feature: {feature}. Must be one of: {valid_features}")
    
    # Use client.ai_assistants.create() — NOT client.ai_assistants.create()
    response = client.ai_assistants.create(
        name=name,
        instructions=instructions,
        model=model,
        enabled_features=enabled_features,
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "id": response.data.id,
        "name": response.data.name,
        "model": response.data.model,
        "instructions": response.data.instructions,
        "enabled_features": response.data.enabled_features,
        "created_at": response.data.created_at,
    }
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Flask server. |
| Invalid Feature Error | You receive a 400 error stating "Invalid feature" when creating an assistant. | Ensure `enabled_features` contains only valid values: `["messaging"]`, `["telephony"]`, or `["messaging", "telephony"]`. Check your request payload for typos like "voice" instead of "telephony" or "sms" instead of "messaging". |
| Missing Instructions Error | The API returns an error about missing or empty instructions field. | Verify that the `instructions` field in your request contains meaningful content. Instructions define the assistant's personality and behavior—they cannot be empty or just whitespace. Provide clear guidance like "You are a helpful customer service representative." |

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

- [List AI Assistants](/tutorials/ai/python/list-ai-assistants).
- [Update an AI Assistant](/tutorials/ai/python/update-ai-assistant).
- [Chat with an AI Assistant](/tutorials/ai/python/chat-with-ai-assistant).
