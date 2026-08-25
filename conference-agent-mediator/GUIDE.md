# Guide: Conference Agent Mediator

This guide walks through the `conference-agent-mediator` sample. You will learn how an AI agent joins a Telnyx Call Control conference, tracks turn-taking, nudges quiet participants, and sends a post-conference summary via SMS.

## Prerequisites

* Python 3.10 or newer
* A Telnyx account with a Call Control Application configured
* A Telnyx phone number capable of sending SMS
* An LLM API key (OpenAI-compatible endpoint)
* `ngrok` or another tool to expose your local server to the internet for webhooks

## Environment Setup

Create a `.env` file based on `.env.example` and fill in your credentials:

```bash
TELNYX_API_KEY=your_telnyx_api_key_here
TELNYX_PUBLIC_KEY=your_telnyx_public_key_here
TELNYX_CONNECTION_ID=your_call_control_connection_id_here
TELNYX_FROM_NUMBER=+1800...
TELNYX_TO_NUMBER=+1800...
LLM_API_KEY=your_llm_api_key_here
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
WEBHOOK_BASE_URL=https://your-ngrok-url.io
```

Install dependencies and run the Flask server:

```bash
pip install -r requirements.txt
flask run --port 5000
```

## How the Code Works

The application is built around four core primitives: Telnyx Call Control (Conference), the Telnyx Python SDK, an LLM for inference, and Server-Sent Events (SSE) for live transcript broadcasting.

### 1. The `ConferenceAgent` Class

At the heart of the sample is the `ConferenceAgent` class. It maintains the state of a single meeting:

* `transcript`: A list of utterances spoken during the call.
* `last_spoken`: A dictionary tracking the last time each participant spoke.
* `participant_names`: The list of expected participants.

The agent exposes methods to ingest new speech, mediate the conversation, and finalize the meeting.

### 2. Starting a Conference

When you POST to `/conference/start`, the app uses the Telnyx SDK to create a conference and dial the agent in:

```python
conf = telnyx.Conference.create(...)
call = telnyx.Call.create(...)
```

A new `ConferenceAgent` instance is created and stored in an in-memory dictionary (`AGENTS`) keyed by the conference ID. The endpoint returns the conference ID and a URL for observers to connect to the live transcript stream.

### 3. Ingesting Transcripts

In a production system, speech-to-text (STT) events would arrive via Telnyx Inference bindings or a direct WebSocket stream. This sample exposes a REST endpoint (`/conference/<id>/transcript`) to simulate that feed.

When a transcript chunk arrives, the agent calls `add_utterance()`. This method:
1. Records the utterance with a timestamp.
2. Updates the `last_spoken` time for that speaker.
3. Broadcasts the event to connected observers.
4. Triggers turn-taking mediation.

### 4. Turn-Taking Mediation

After every utterance, the agent checks if any participant has been silent for more than 45 seconds (`IDLE_PROMPT_SECONDS`).

If someone is quiet, the agent builds a prompt and sends it to the LLM:

```python
prompt = f"...invite {quiet} to share their thoughts..."
nudge = self._llm_complete(prompt, max_tokens=60)
```

The agent then uses Telnyx Call Control to speak the nudge into the conference:

```python
telnyx.Call.retrieve(self.call_control_id).speak(
    payload=nudge,
    voice="female",
    language="en-US",
)
```

### 5. Webhook Handling

Telnyx sends lifecycle events to `/webhooks/telnyx`. The app verifies the Ed25519 signature on every request:

```python
telnyx.Webhook.unwrap(request.data, request.headers, TELNYX_PUBLIC_KEY, tolerance=300)
```

The handler listens for `conference.ended`. When the conference ends, it calls `agent.finalize()`.

### 6. Summary and SMS

The `finalize()` method builds a full transcript and asks the LLM to summarize it in 3-5 bullet points. It then uses the Telnyx SDK to send that summary via SMS to the configured recipient:

```python
telnyx.Message.create(
    from_=TELNYX_FROM_NUMBER,
    to=TELNYX_TO_NUMBER,
    text=f"Conference summary:\n{self.summary}",
)
```

### 7. Live Transcript for Observers

Observers can connect to `/conference/<id>/stream`. This sample uses Server-Sent Events (SSE) to avoid extra WebSocket dependencies. When an observer connects, the app:
1. Replays the existing transcript.
2. Registers a queue for the observer.
3. Streams new utterances in real-time as they are ingested.

## Next Steps

* **Telnyx Call Control**: Learn more about [Conferences](https://developers.telnyx.com/docs/voice/call-control-conferences) and the [Speak command](https://developers.telnyx.com/docs/voice/call-control-speak).
* **Messaging**: Read the [SMS API reference](https://developers.telnyx.com/docs/messaging/overview).
* **Webhooks**: Understand [Telnyx Webhook signatures](https://developers.telnyx.com/docs/develop/webhooks/overview).
* **Inference**: Explore how to bind real-time STT streams to your calls for production deployments.
