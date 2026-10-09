---
name: persistent-ai-agent-memory
title: Persistent AI Agent Memory Demo
description: A Python CLI tool that ingests a support transcript into Telnyx Agent Memory, polls the async operation, and recalls extracted facts to demonstrate long-term AI agent memory.
language: python
framework: cli
telnyx_products: [Agent Memory, AI Communications Infrastructure]
---

# Persistent AI Agent Memory Demo

A Python CLI tool that ingests a support conversation transcript into Telnyx Agent Memory, polls the asynchronous write operation to completion, and then recalls extracted facts to demonstrate long-term memory across sessions.

## The Story

A regional urgent care clinic relies on an AI-powered triage assistant to field patient inquiries about appointment scheduling, prescription refills, and billing questions. When the assistant forgets a patient's preferred contact method or insurance details between conversations, patients receive redundant follow-ups, staff waste time re-collecting information, and worst of all, a missed communication preference could delay a critical care notification — eroding trust and risking patient safety. The actor IS the AI triage assistant. It is born when a patient initiates their first chat, evolves as it accumulates facts across dozens of fragmented touchpoints, and completes its purpose when it can reliably recall a patient's preferred contact method, insurance carrier, and medication history without prompting. Its survival hinges on durable memory: if the platform reboots mid-batch or a session times out, the assistant must still remember that the patient prefers email over SMS, because a single missed message could mean a missed dose or a delayed appointment. The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx provides the AI Communications Infrastructure that powers reliable, long-lived agent memory — turning ephemeral conversations into durable, recallable facts that persist across sessions, devices, and restarts.

## Telnyx API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/v2/ai/memory/namespaces/{ns}/profiles/{id}/ingest` | Submit a transcript for fact extraction; returns an async `operation_id` |
| `GET` | `/v2/ai/memory/namespaces/{ns}/operations/{operation_id}` | Poll the async operation until it reaches a terminal status |
| `POST` | `/v2/ai/memory/namespaces/{ns}/profiles/{id}/recall` | Query the profile's memory for ranked, relevant facts |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     CLI (app.py)                            │
│                                                             │
│  1. Ingest transcript                                       │
│     POST /namespaces/default/profiles/user_123/ingest       │
│     → 202 Accepted, operation_id returned                   │
│                                                             │
│  2. Poll operation                                          │
│     GET /namespaces/default/operations/{operation_id}       │
│     → status: pending → processing → completed              │
│                                                             │
│  3. Recall facts                                            │
│     POST /namespaces/default/profiles/user_123/recall       │
│     → ranked list of memory facts                           │
│                                                             │
│  4. Display results                                         │
│     Print ranked facts with scores                          │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Telnyx Agent Memory API (v2)                   │
│                                                             │
│  • Namespace: "default" (isolation boundary)                │
│  • Profile: "user_123" (user entity)                        │
│  • Source: ingested transcript                              │
│  • Memory: extracted durable facts                          │
│  • Operation: async job tracking write completion           │
└─────────────────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | Telnyx API key — the only credential this demo needs | [Telnyx Portal → API Keys](https://portal.telnyx.com/#/app/api-keys) |

> **Agent / CLI access** — the only environment variable is the API key, which agents can obtain via the [Telnyx Agent CLI](https://github.com/team-telnyx/ai/tree/main/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/persistent-ai-agent-memory

# 2. Create a .env file with your Telnyx API key
echo "TELNYX_API_KEY=your_telnyx_api_key_here" > .env

# 3. Install dependencies
pip install -r requirements.txt

# 4. Run the demo
python app.py
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login

# This demo needs no phone numbers or other provisioned resources —
# only an API key (auth login above, or export TELNYX_API_KEY=...).
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>

## API Reference

### Ingest Transcript

```
POST /v2/ai/memory/namespaces/{ns}/profiles/{id}/ingest?session_id={session_id}
```

**Headers:**
- `Authorization: Bearer <TELNYX_API_KEY>`
- `Content-Type: application/json`

**Body:**
```json
{
  "messages": [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."}
  ]
}
```

**Response (202):**
```json
{
  "data": {
    "operation_id": "op_abc123",
    "profile_id": "user_123",
    "session_id": "demo-session-001",
    "source_id": "src_xyz789"
  }
}
```

### Poll Operation Status

```
GET /v2/ai/memory/namespaces/{ns}/operations/{operation_id}
```

**Response:**
```json
{
  "data": {
    "operation_id": "op_abc123",
    "status": "completed",
    "created_at": "2026-10-05T12:00:00Z",
    "completed_at": "2026-10-05T12:00:05Z"
  }
}
```

**Status values:** `pending`, `processing` (non-terminal), `completed`, `failed`, `cancelled` (terminal).

### Recall Facts

```
POST /v2/ai/memory/namespaces/{ns}/profiles/{id}/recall
```

**Body:**
```json
{
  "query": "What is the user's preferred contact method?",
  "top_k": 10
}
```

**Response:**
```json
{
  "data": [
    {
      "id": "mem_abc123",
      "text": "The user's preferred contact method is email at user@example.com.",
      "recorded_at": "2026-10-05T12:00:05Z",
      "score": 0.92
    }
  ]
}
```

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `401 Unauthorized` | Invalid or missing API key | Verify `TELNYX_API_KEY` is set correctly in `.env` |
| `404 Not Found` | Incorrect namespace or profile ID | Ensure namespace is `default` and profile ID is URL-encoded |
| Operation stays `pending` | Ingest still processing | Increase `POLL_TIMEOUT_SECONDS` or check Telnyx status page |
| Recall returns empty list | Operation not yet completed | Wait for `completed` status before calling recall |
| `ValueError: session_id must be <= 128 characters` | Session ID too long | Use a shorter session ID string |

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Related Examples

- [Chat with AI Assistant](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/chat-with-ai-assistant-python/README.md) — text chat against an AI Assistant
- [Omnichannel AI Agent](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/omnichannel-ai-agent-python/README.md) — one AI agent with persistent cross-channel context
- [Semantic Search](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/semantic-search-python/README.md) — vector search over support tickets with Telnyx embeddings

## Resources

- [Telnyx Agent Memory Documentation](https://developers.telnyx.com/docs/agent-memory)
- [Telnyx API Reference](https://developers.telnyx.com/api/)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Telnyx Product Page](https://telnyx.com/)
- [Telnyx Pricing](https://telnyx.com/pricing)
