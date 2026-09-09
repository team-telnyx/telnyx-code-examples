# Guide: Voice IVR with Agent Backend

This guide walks you through the `voice-ivr-with-agent-backend` code sample. You will learn how to build a natural language Interactive Voice Response (IVR) system using Telnyx Call Control, the Telnyx AI Inference API, and Python Flask.

## What You Will Build

Traditional IVR systems force callers into rigid, multi-level phone trees ("Press 1 for billing, Press 2 for support"). This code sample replaces that paradigm with a natural language conversation. 

When a caller dials your Telnyx number, the application:
1. Answers the call using Call Control.
2. Looks up the menu configuration for the dialed number in a Key-Value (KV) store.
3. Uses an LLM to generate a dynamic, conversational greeting.
4. Uses Call Control's `gather_using_speech` to listen to the caller's request.
5. Uses an LLM to route the caller's intent to the correct department.
6. Transfers the call using Call Control.

## Prerequisites

Before you begin, ensure you have:
- Python 3.10 or higher installed.
- A Telnyx account with an active API Key.
- A Telnyx Call Control Application configured with a public webhook URL.
- A purchased Telnyx phone number assigned to your Call Control Application.
- `ngrok` or another tunneling tool to expose your local Flask server to the internet.

## Environment Setup

1. **Clone the repository** and navigate to the `voice-ivr-with-agent-backend` directory.

2. **Create a virtual environment**:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows use: venv\Scripts\activate
   ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure environment variables**: 
   Copy the `.env.example` file to `.env` and fill in your details:
   ```bash
   cp .env.example .env
   ```
   Update the `.env` file with your actual Telnyx API Key, Public Key, and Connection ID.

## Running the Application

Start the Flask server:
```bash
python app.py
```
The application will start on `http://0.0.0.0:5000`.

Expose your local server using ngrok:
```bash
ngrok http 5000
```
Copy the ngrok forwarding URL (e.g., `https://<your-ngrok-url>.ngrok.io`) and configure it as the webhook URL in your Telnyx Call Control Application. Ensure the webhook points to `/webhooks/voice`.

## How the Code Works

The application is built around four core Telnyx primitives: **Call Control**, **Agent SDK patterns**, **KV Storage**, and **AI Inference**.

### 1. Configuration & KV Store

The application relies on environment variables loaded via `dotenv` to securely configure the Telnyx SDK. 

Instead of hardcoding menu options, the app uses an in-memory Key-Value store (`MENU_CONFIG_KV`) to map dialed phone numbers to specific business configurations. In a production environment, you would swap this dictionary for Redis, a database, or Telnyx KV. 

The `get_menu_config` function retrieves the business name, greeting, and department routing rules (including transfer numbers and keywords) based on the number the caller dialed.

### 2. Webhook Verification

Security is critical when handling inbound webhooks. The `verify_telnyx_webhook` decorator intercepts incoming requests to the webhook endpoint and verifies the Telnyx Ed25519 signature. 

It extracts the `Telnyx-Signature-Ed25519` and `Telnyx-Signature-Timestamp` headers and uses `telnyx.Webhook.construct_event` to validate the payload. If the signature is missing or invalid, the request is rejected with a `401 Unauthorized` response. This prevents spoofed requests from triggering call actions.

### 3. LLM-Powered Intent Routing

The application uses Telnyx AI Inference (OpenAI-compatible binding) to replace rigid DTMF (touch-tone) menus with natural language understanding.

- **`generate_dynamic_menu_prompt`**: Takes the KV menu config and constructs a system prompt. It asks the LLM to generate a brief, conversational greeting tailored to the business.
- **`route_intent_with_llm`**: Takes the caller's transcribed speech and the menu config. It asks the LLM to match the caller's intent to a specific department (e.g., "billing", "support", "sales"). 
  - The LLM is instructed to respond with only the department name to ensure reliable parsing.
  - **Fallback Mechanism**: If the LLM fails or times out, the function gracefully falls back to a standard keyword-matching algorithm using the keywords defined in the KV config.

### 4. Call Control Helpers

The `telnyx.Call` SDK provides the tools to manipulate the live call:
- **`speak_to_caller`**: Uses Call Control to synthesize speech (Text-to-Speech) and play it to the caller.
- **`gather_speech`**: Uses `gather_using_speech` to play a prompt and listen for the caller's response, transcribing it for the LLM.
- **`transfer_call`**: Uses Call Control to transfer the call to the appropriate department number.

### 5. The IVR Agent State Machine

The `IVRAgent` class manages the state of the active call. While implemented here as a standard Python class for portability, it mirrors the pattern of the Telnyx Agent SDK. 

The agent tracks:
- `call_control_id`: The unique identifier for the live call.
- `state`: The current state of the conversation (e.g., `greeting`, `awaiting_input`).
- `turn_count`: How many times the system has attempted to gather input.
- `max_turns`: The limit before transferring to a default operator.

**Agent Lifecycle:**
- **`on_connect`**: Triggered when the call is answered. It fetches the menu config, generates the LLM greeting, speaks to the caller, and initiates the speech gather.
- **`on_gather_ended`**: Triggered when the caller finishes speaking. It passes the transcribed speech to the LLM for intent routing. If a department is matched, it transfers the call. If not, it retries up to `max_turns` before transferring to a default number.

### 6. The Webhook Handler

The `/webhooks/voice` endpoint is the main entry point for Telnyx Call Control events. 

- **`call.initiated`**: An inbound call is received. The app creates a new `IVRAgent` instance, stores it in `active_agents`, and answers the call.
- **`call.answered`**: The call is connected. The app triggers `agent.on_connect()` to start the IVR conversation.
- **`call.gather.ended`**: The speech gather completes. The app extracts the transcribed text and passes it to `agent.on_gather_ended()`.
- **`call.gather.failed`**: The gather failed (e.g., silence timeout). The app triggers a retry.
- **`call.hangup`**: The call ends. The app cleans up the agent from memory.

### 7. Management API

The application includes a few management endpoints for configuration and debugging:
- `PUT /api/menu-config/<phone_number>`: Allows you to update the KV menu configuration for a specific number dynamically.
- `GET /api/menu-config/<phone_number>`: Retrieves the current configuration.
- `GET /api/agents`: Lists all currently active IVR agents (useful for debugging).
- `GET /health`: A standard health check endpoint.

## Next Steps

Now that you have a natural language IVR running, you can extend it further:

- **Connect a Database**: Replace the in-memory `MENU_CONFIG_KV` with a persistent database like PostgreSQL or Redis.
- **Add Contextual Awareness**: Pass caller ID information to the LLM to personalize the greeting (e.g., "Welcome back, John!").
- **Advanced Call Routing**: Integrate with Telnyx Call Queues to hold callers instead of blind transferring.

Explore the official Telnyx Developer Documentation for more details:
- [Telnyx Call Control](https://developers.telnyx.com/docs/voice/programmable-voice/call-control-overview)
- [Telnyx AI Inference](https://developers.telnyx.com/docs/ai/ai-overview)
- [Telnyx Webhooks](https://developers.telnyx.com/docs/develop/webhooks)
