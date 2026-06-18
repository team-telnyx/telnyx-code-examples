# API Reference — Update AI Assistant

This example uses the Telnyx Python SDK to update an AI Assistant's configuration. It runs as a script, not as a web server.

## CLI Usage

```bash
python app.py
```

## Telnyx SDK Calls

| Method | Description |
|--------|-------------|
| `telnyx.AIAssistant.retrieve(id)` | Fetch current assistant configuration |
| `assistant.save()` | Save updated configuration |

## Configuration Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Assistant display name |
| `model` | `string` | LLM model identifier |
| `instructions` | `string` | System prompt |
| `voice` | `string` | TTS voice for phone calls |
| `tools` | `array` | Function calling tools |
