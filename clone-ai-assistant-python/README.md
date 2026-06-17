# Clone AI Assistant with Python and Flask

## What Does This Example Do?

Build a production-ready Flask application that clones an existing AI Assistant using the Telnyx AI Assistants API. This tutorial demonstrates how to duplicate an assistant's configuration, tools, and settings to create a new instance with customizable parameters. You'll learn the cloning workflow, proper error handling for API operations, and secure credential management.

## Who Is This For?

- **Python developers** building ai features with Flask.
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
- An existing AI Assistant to clone (or create one first using the Telnyx Portal or API).
- pip (Python package manager).
- curl or Postman for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/clone-ai-assistant-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/clone-ai-assistant-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and initialize the Telnyx client. Define helper functions to retrieve the source assistant and clone it with optional parameter overrides:

```python
import os
import telnyx
from dotenv import load_dotenv

load_dotenv()

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def get_assistant_details(assistant_id: str) -> dict:
    """Retrieve full details of an assistant for inspection before cloning."""
    response = client.ai_assistants.retrieve(assistant_id)
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "id": response.data.id,
        "name": response.data.name,
        "model": response.data.model,
        "instructions": response.data.instructions,
        "tools": response.data.tools if hasattr(response.data, "tools") else [],
        "enabled_features": response.data.enabled_features if hasattr(response.data, "enabled_features") else [],
        "created_at": response.data.created_at,
    }


def clone_assistant(source_assistant_id: str, new_name: str = None, new_instructions: str = None) -> dict:
    """Clone an existing assistant with optional parameter overrides."""
    if not source_assistant_id:
        raise ValueError("source_assistant_id is required")
    
    # Retrieve source assistant to validate it exists
    source = client.ai_assistants.retrieve(source_assistant_id)
    
    # Use provided overrides or fall back to source values
    clone_name = new_name if new_name else f"{source.data.name} (Clone)"
    clone_instructions = new_instructions if new_instructions else source.data.instructions
    
    # Build clone parameters — include tools and features from source
    clone_params = {
        "name": clone_name,
        "model": source.data.model,
        "instructions": clone_instructions,
    }
    
    # Preserve tools if they exist on the source
    if hasattr(source.data, "tools") and source.data.tools:
        clone_params["tools"] = source.data.tools
    
    # Preserve enabled features if they exist on the source
    if hasattr(source.data, "enabled_features") and source.data.enabled_features:
        clone_params["enabled_features"] = source.data.enabled_features
    
    # Create the cloned assistant
    response = client.ai_assistants.create(**clone_params)
    
    # Extract serializable data
    return {
        "id": response.data.id,
        "name": response.data.name,
        "model": response.data.model,
        "instructions": response.data.instructions,
        "tools": response.data.tools if hasattr(response.data, "tools") else [],
        "enabled_features": response.data.enabled_features if hasattr(response.data, "enabled_features") else [],
        "created_at": response.data.created_at,
        "source_assistant_id": source_assistant_id,
    }
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Flask server. |
| Assistant Not Found (404) | You receive a 404 error or `{"error": "..."}` indicating the assistant does not exist. | Confirm the `assistant_id` in your request URL is correct and matches an existing assistant in your Telnyx account. Retrieve the correct ID from the [Telnyx Portal](https://portal.telnyx.com) under AI Assistants. Verify the assistant belongs to the account associated with your API key. |
| Clone Missing Tools or Features | The cloned assistant is created but lacks tools or enabled_features from the source. | Ensure the source assistant has tools and features configured before cloning. The clone operation preserves these attributes only if they exist on the source. If you need to add tools post-clone, use the update endpoint to modify the cloned assistant's configuration. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | The Telnyx API enforces rate limits on requests. Implement exponential backoff in your client code and space out clone requests. For bulk cloning operations, add delays between requests (e.g., 1 second between calls). Check the [Telnyx documentation](https://developers.telnyx.com) for current rate limit thresholds. |

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
- [Create an AI Assistant](/tutorials/ai/python/create-ai-assistant).
- [Chat with an AI Assistant](/tutorials/ai/python/chat-with-ai-assistant).
