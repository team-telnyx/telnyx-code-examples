# API Reference

## `POST /v2/ai/assistants`

`app.py` creates an AI Assistant by calling the Telnyx AI Assistants API.

The assistant includes a built-in `transfer` tool with one target,
`warm_transfer_instructions`, and `warm_transfer_acceptance.enabled`.
