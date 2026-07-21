# AI Assistant Multiparticipant Calling API Reference

This example exposes a local Express app that receives Telnyx Voice webhooks and AI Assistant tool calls.

## Telnyx API Calls Made By The App

### `POST /v2/calls/{call_control_id}/actions/answer`

Answers the inbound call with an inline AI Assistant configuration.

### `POST /v2/calls`

Dials the human specialist after the assistant calls the `dial_specialist` backend tool.

### `POST /v2/calls/{call_control_id}/actions/ai_assistant_join`

Joins the answered specialist call leg into the existing AI Assistant conversation.

Request body:

```json
{
  "conversation_id": "conv_123",
  "participant": {
    "id": "call_control_id_for_specialist_leg",
    "role": "user",
    "name": "support specialist",
    "on_hangup": "continue_conversation"
  }
}
```

## Local Routes

### `POST /webhooks/voice`

Receives Telnyx Voice events.

- `call.initiated`: creates a session and answers with the AI Assistant.
- `ai.*`: captures `conversation_id` from AI events.
- `call.answered`: joins the specialist leg when the specialist answers.
- `call.hangup`: records hangup state.

### `POST /tools/classify-issue`

Mock AI Assistant tool that records a short issue summary and tells the assistant to route to a specialist.

```bash
curl -X POST http://localhost:8787/tools/classify-issue \
  -H "content-type: application/json" \
  -d '{"issue_summary":"webhook deliveries are failing with 401 responses"}'
```

### `POST /tools/record-specialist-consent`

Records caller consent before dialing the second participant.

```bash
curl -X POST http://localhost:8787/tools/record-specialist-consent \
  -H "content-type: application/json" \
  -d '{"granted":true}'
```

### `POST /tools/dial-specialist`

Async AI Assistant tool that dials the specialist with `POST /v2/calls`.

```bash
curl -X POST http://localhost:8787/tools/dial-specialist
```

### `GET /sessions`

Returns in-memory session state for local debugging.

### `GET /health`

Health check endpoint.
