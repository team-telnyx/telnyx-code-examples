# Update AI Assistant with Python and FastAPI

## What Does This Example Do?

Build a production-ready FastAPI endpoint that updates AI assistants using the Telnyx Python SDK. This tutorial demonstrates how to modify assistant configurations (name, instructions, model, enabled features) with proper validation, error handling, and secure credential management via environment variables.

## Who Is This For?

- **Python developers** building ai features with FastAPI.
- **Backend engineers** integrating telephony or messaging into existing applications.
- **DevOps teams** looking for containerized, production-ready telecom examples.
- **Startups and enterprises** replacing legacy telecom providers with a modern API-first platform.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform that gives developers a single API for [voice](https://telnyx.com/products/voice-ai-agents), [messaging](https://telnyx.com/products/sms-api), [SIP](https://telnyx.com/products/sip-trunks), [AI](https://telnyx.com/ai-assistants), and [IoT](https://telnyx.com/products/iot-sim-card) — no Frankenstack required.

- **Integrated platform** — [Voice](https://telnyx.com/products/voice-ai-agents), [SMS](https://telnyx.com/products/sms-api), [SIP trunking](https://telnyx.com/products/sip-trunks), [AI assistants](https://telnyx.com/ai-assistants), and [IoT SIM management](https://telnyx.com/products/iot-sim-card) under one roof. No stitching together multiple vendors.
- **Global private network** — Calls and messages traverse the Telnyx-owned IP network for lower latency and higher reliability than the public internet.
- **Developer-first** — SDKs for Python, Node.js, Go, Ruby, Java, and PHP. Comprehensive webhook event model. Sandbox environment for testing.
- **Competitive pricing** — Pay-as-you-go with no minimums, contracts, or per-seat fees.

## Prerequisites

- Python 3.8 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- An existing AI assistant (see [Create an AI Assistant](/tutorials/ai/python/create-ai-assistant) if you need to create one first).
- pip (Python package manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/update-ai-assistant-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/update-ai-assistant-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and initialize the Telnyx client using the new pattern. Define a helper function to handle assistant updates with proper validation:

```python
import os
import telnyx
from dotenv import load_dotenv

load_dotenv()

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def update_assistant(
    assistant_id: str,
    name: str = None,
    instructions: str = None,
    model: str = None,
    enabled_features: list = None,
) -> dict:
    """Update an AI assistant and return JSON-serializable response data."""
    # Build update payload with only provided fields
    update_params = {}
    
    if name is not None:
        update_params["name"] = name
    if instructions is not None:
        update_params["instructions"] = instructions
    if model is not None:
        update_params["model"] = model
    if enabled_features is not None:
        update_params["enabled_features"] = enabled_features
    
    if not update_params:
        raise ValueError("At least one field must be provided for update")
    
    # Use client.ai_assistants.update() — NOT client.ai_assistants.update()
    response = client.ai_assistants.update(assistant_id, **update_params)
    
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
| Authentication Error (401) | The endpoint returns `{"detail": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the FastAPI server. |
| Assistant Not Found (404) | The API returns a 404 error indicating the assistant ID does not exist. | Confirm the `assistant_id` in your request URL is correct and matches an existing assistant. Use [List AI Assistants](/tutorials/ai/python/list-ai-assistants) to retrieve valid assistant IDs. Verify the assistant belongs to your Telnyx account. |
| No Fields Provided (400) | The endpoint returns `{"detail": "At least one field must be provided for update"}`. | Include at least one of the following fields in your request body: `name`, `instructions`, `model`, or `enabled_features`. An empty request body or all null values will trigger this validation error. |
| Invalid Model Name | The API returns an error about an unsupported or invalid model identifier. | Verify the `model` field uses a valid Telnyx-supported LLM identifier (e.g., `meta-llama/Meta-Llama-3.1-70B-Instruct`). Check the [Telnyx AI Assistants documentation](https://developers.telnyx.com/docs/api/ai-assistants) for the complete list of supported models. |
| Rate Limit Exceeded (429) | The endpoint returns `{"detail": "Rate limit exceeded. Please slow down."}` with HTTP 429. | Implement exponential backoff in your client code. Wait at least 1 second before retrying the request. If you consistently hit rate limits, contact Telnyx support to discuss your usage patterns and request higher limits. |

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
- [List AI Assistants](/tutorials/ai/python/list-ai-assistants).
- [Chat with an AI Assistant](/tutorials/ai/python/chat-with-ai-assistant).
