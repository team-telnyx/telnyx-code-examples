# Chat With AI Assistant with Python and Flask

## What Does This Example Do?

Build a production-ready Flask application that enables real-time conversations with Telnyx AI Assistants. This tutorial demonstrates how to initialize the Telnyx Python SDK, send chat messages to an assistant, handle streaming responses, and implement proper error handling for production resilience.

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
- An existing AI Assistant created in your Telnyx account (or follow the [Create an AI Assistant](/tutorials/ai/python/create-ai-assistant) tutorial first).
- pip (Python package manager).
- A tool like curl or Postman to test HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/chat-with-ai-assistant-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/chat-with-ai-assistant-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` and initialize the Telnyx client using the new pattern. Define a helper function to handle chat interactions with proper validation and error handling:

```python
import os
import telnyx
from dotenv import load_dotenv

load_dotenv()

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def chat_with_assistant(assistant_id: str, user_message: str) -> dict:
    """Send a message to an AI Assistant and return the response."""
    if not assistant_id:
        raise ValueError("Assistant ID is required")
    
    if not user_message or not user_message.strip():
        raise ValueError("Message cannot be empty")
    
    # Use client.ai_assistants.chat() to send a message to the assistant
    response = client.ai_assistants.chat(
        assistant_id=assistant_id,
        messages=[
            {
                "role": "user",
                "content": user_message,
            }
        ],
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    # The response contains the assistant's reply in the messages array
    assistant_message = None
    if response.data.messages:
        for msg in response.data.messages:
            if msg.role == "assistant":
                assistant_message = msg.content
                break
    
    return {
        "user_message": user_message,
        "assistant_response": assistant_message or "No response generated",
        "assistant_id": assistant_id,
    }
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Flask server. |
| Assistant Not Found (404) | The API returns a 404 error or "Assistant not found" message. | Confirm the `AI_ASSISTANT_ID` in your `.env` file or request body matches an existing assistant in your Telnyx account. You can verify your assistant ID by listing all assistants using the [List AI Assistants](/tutorials/ai/python/list-ai-assistants) tutorial. Ensure the assistant is enabled and active. |
| Empty or No Response | The endpoint returns `{"assistant_response": "No response generated"}` even though the request succeeded. | This may indicate the assistant did not generate a response or the response format differs from expected. Check that your assistant is properly configured with instructions and a valid model. Try sending a simpler message to test basic functionality. Review the assistant's configuration in the Telnyx Portal to ensure it is enabled for chat. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | You are sending requests too quickly. Implement exponential backoff in your client code: wait 1 second, then 2 seconds, then 4 seconds between retries. Check your Telnyx plan limits in the Portal and consider upgrading if you need higher throughput. |
| Environment Variable Not Set | The application raises `ValueError` or returns a 400 error about missing `AI_ASSISTANT_ID`. | Confirm your `.env` file exists in the same directory as `app.py` and contains both `TELNYX_API_KEY` and `AI_ASSISTANT_ID`. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `load_dotenv()` call must execute before `os.getenv()` is called—verify this import order in your code. |

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

- [List All AI Assistants](/tutorials/ai/python/list-ai-assistants).
- [Create an AI Assistant](/tutorials/ai/python/create-ai-assistant).
- [Update an AI Assistant](/tutorials/ai/python/update-ai-assistant).
