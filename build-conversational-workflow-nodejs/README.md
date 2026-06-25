---
name: build-conversational-workflow
title: "Build a Conversational Workflow"
description: "Build a Telnyx Conversational Workflow for inbound auto insurance claim intake with structured branches, backend tools, and priority follow-up."
language: nodejs
framework: express
telnyx_products: [Voice AI]
channel: [voice]
---

# Build a Conversational Workflow

Build a Telnyx Conversational Workflow for inbound auto insurance first notice of loss intake. The workflow asks structured questions, branches for urgent cases, calls backend tools, and returns a claim or fallback reference to the caller.

## Telnyx API Endpoints Used

This example is configured in the Telnyx Portal as a Conversational Workflow. The local Express app exposes webhook tool endpoints that Telnyx calls from workflow tool nodes:

- **Create Claim Intake Tool**: `POST /tools/create-claim-intake`
- **Log Fallback Tool**: `POST /tools/log-claim-intake-fallback`
- **Flag Priority Follow-Up Tool**: `POST /tools/flag-priority-follow-up`

## Architecture

```
  Inbound PSTN call
        │
        ▼
  ┌────────────────────────────┐
  │ Telnyx Conversational       │
  │ Workflow                    │
  └─────────────┬──────────────┘
                │ nodes + branches
                ▼
  ┌────────────────────────────┐
  │ Auto claim intake flow      │
  │ safety, caller, loss fields │
  └─────────────┬──────────────┘
                │ workflow tool calls
                ▼
  ┌────────────────────────────┐
  │ Express tool server         │
  │ /tools/create-claim-intake  │
  └─────────────┬──────────────┘
                │ JSON result
                ▼
     claim reference or fallback reference
```

### Workflow lifecycle

1. Caller reaches the Telnyx phone number assigned to the workflow.
2. The workflow confirms this is a new auto claim.
3. The workflow checks for injury, danger, or unsafe vehicle status.
4. The workflow collects caller, policy, vehicle, and incident details.
5. The workflow calls `create_claim_intake` when required fields are present.
6. The workflow calls `log_claim_intake_fallback` when the intake cannot be completed.
7. The workflow calls `flag_priority_follow_up` when `priority_flag` is true.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform that puts voice, AI, SIP, messaging, and programmable communications on one private, global network. Conversational Workflows let you build structured voice experiences with visible branches and tool calls, so operational processes like insurance claim intake are easier to audit than a single large prompt.

## Why This Example Uses Insurance

Insurance first notice of loss is a useful workflow pattern because it has realistic business constraints:

- the caller may be stressed
- the workflow must collect specific fields
- urgent cases need early branching
- backend records should only be created after required information is present
- the voice experience must not promise coverage, payment, repairs, liability, legal advice, or medical advice

The same structure can be reused for scheduling, support triage, lead qualification, patient intake, and service dispatch.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY_your_telnyx_api_key_here` | no | Telnyx API key for Portal/API automation; the local mock tool server does not call Telnyx directly | [Portal](https://portal.telnyx.com/api-keys) |
| `CLAIM_TOOL_SECRET` | `string` | `dev-secret` | **yes** | Shared secret expected in the `x-tool-secret` header from Telnyx workflow tools | Choose your own value |
| `PORT` | `number` | `8787` | no | Port the Express tool server listens on | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-conversational-workflow-nodejs
cp .env.example .env    # fill in CLAIM_TOOL_SECRET
npm install
npm test
node server.js          # starts on http://localhost:8787
```

### Workflow Configuration

1. Expose your local server:

   ```bash
   ngrok http 8787
   ```

2. In the [Telnyx Portal](https://portal.telnyx.com), create a Conversational Workflow named `auto claim intake conversational workflow`.
3. Build the nodes and branches from [GUIDE.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-conversational-workflow-nodejs/GUIDE.md).
4. Configure tool nodes with your ngrok base URL:

   - `POST https://<id>.ngrok.io/tools/create-claim-intake`
   - `POST https://<id>.ngrok.io/tools/log-claim-intake-fallback`
   - `POST https://<id>.ngrok.io/tools/flag-priority-follow-up`

5. Add the shared header to each tool:

   ```txt
   x-tool-secret: dev-secret
   ```

6. Assign an inbound Telnyx phone number to the workflow and call it.

## API Reference

### `POST /tools/create-claim-intake`

Creates a mock claim intake when the workflow has collected required fields.

```bash
curl -X POST http://localhost:8787/tools/create-claim-intake \
  -H "content-type: application/json" \
  -H "x-tool-secret: dev-secret" \
  -d '{
    "caller_name": "jane sample",
    "caller_phone": "+15551234567",
    "loss_type": "auto",
    "loss_date": "2026-06-15",
    "loss_location": "mission street and 5th street, san francisco",
    "loss_description": "rear-ended while stopped",
    "priority_flag": false,
    "consent_to_continue": true
  }'
```

**Response:**

```json
{
  "success": true,
  "claim_intake_id": "aci_123",
  "priority_flag": false,
  "next_step": "claims team follow-up"
}
```

### `POST /tools/log-claim-intake-fallback`

Records a fallback when the caller is misdirected, information is incomplete, or the primary tool cannot be used.

### `POST /tools/flag-priority-follow-up`

Creates a mock priority follow-up task for urgent cases.

### `GET /health`

Health check endpoint for monitoring.

```bash
curl http://localhost:8787/health
```

**Response:**

```json
{
  "status": "ok",
  "service": "claim_intake_tools"
}
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 {"success":false,"error":"unauthorized"}` | `x-tool-secret` is missing or does not match `CLAIM_TOOL_SECRET`. | Add the same `x-tool-secret` header to each Telnyx workflow tool node and restart the server after editing `.env`. |
| `422 {"error":"missing_required_fields"}` | The workflow called a tool before required fields were collected. | Check `workflow.json` and only call `create_claim_intake` after the minimum field check. |
| Tool call never reaches the server | Local server is not publicly reachable. | Run `ngrok http 8787` and use the HTTPS URL in each workflow tool node. |
| Caller receives an unsupported promise | Workflow instructions or node copy are too broad. | Keep the workflow focused on intake and avoid coverage, payment, liability, repair, legal, or medical decisions. |
| Workflow graph breaks during editing | A node points to a missing node or tool. | Run `npm test` to validate `workflow.json`. |

## Related Examples

- [AI Insurance Claims Intake Voice (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-insurance-claims-intake-voice-python/README.md) - voice agent for insurance claim intake
- [Build a Voice AI Agent (Node.js)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-voice-ai-agent-nodejs/README.md) - answer calls and generate replies with Telnyx Inference
- [Route Phone Calls to AI Agent (Node.js)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-nodejs/README.md) - route inbound calls to an AI agent
- [AI Assistant Multi Tool (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-assistant-multi-tool-python/README.md) - tool-calling pattern for AI assistants

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
- [Voice AI Agents](https://telnyx.com/products/voice-ai-agents)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
