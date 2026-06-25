# Build a Conversational Workflow with Telnyx

Build an inbound auto insurance claim intake workflow using Telnyx Conversational Workflows and a small Express backend for tool calls.

## How It Works

```
  Caller
    │
    ▼
  Telnyx Phone Number
    │
    ▼
  Conversational Workflow
    │
    ├── classify intent
    ├── triage safety
    ├── collect caller and claim fields
    └── call backend tools
          │
          ▼
       Express app
       /tools/*
```

## Telnyx Products Used

- **Conversational Workflows** - visual workflow builder for structured voice intake
- **Voice AI** - inbound voice experience
- **Workflow tools** - webhook-style calls from the workflow to your backend

## API Endpoints

Your Express app exposes these endpoints for Telnyx workflow tool nodes:

- `POST /tools/create-claim-intake`
- `POST /tools/log-claim-intake-fallback`
- `POST /tools/flag-priority-follow-up`
- `GET /health`

## Prerequisites

- Node.js 20+
- Telnyx account
- Access to Conversational Workflows
- Inbound voice-capable Telnyx phone number
- Public HTTPS tunnel such as ngrok

## Step 1: Set Up The Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-conversational-workflow-nodejs
cp .env.example .env
npm install
npm test
```

Edit `.env`:

```txt
PORT=8787
CLAIM_TOOL_SECRET=dev-secret
```

## Step 2: Understand The Code

Everything lives in `server.js`:

- **`GET /health`** checks whether the tool server is running.
- **`POST /tools/create-claim-intake`** validates required fields and returns a mock `claim_intake_id`.
- **`POST /tools/log-claim-intake-fallback`** creates a fallback reference for incomplete, misdirected, or failed intake paths.
- **`POST /tools/flag-priority-follow-up`** creates a mock priority follow-up task for urgent cases.

The `workflow.json` file is the workflow blueprint. Run `npm test` to check that referenced nodes and tools exist.

## Step 3: Run The Tool Server

```bash
node server.js
```

The server starts on `http://localhost:8787` unless `PORT` is set.

In another terminal:

```bash
ngrok http 8787
```

Use the HTTPS ngrok URL when configuring Telnyx workflow tools.

## Step 4: Build The Workflow In Telnyx

Create a workflow named:

```txt
auto claim intake conversational workflow
```

Set the first message:

```txt
hi, thanks for calling claims intake. are you calling to report a new auto claim
```

Build the happy path first:

```txt
start
-> classify_intent
-> safety_triage
-> collect_caller_details
-> collect_loss_details
-> collect_incident_details
-> minimum_field_check
-> create_claim_intake
-> priority_check
-> confirm_and_close
```

Then add branches:

- non-auto or misdirected caller: collect callback details and call `log_claim_intake_fallback`
- unclear intent: ask a clarifying question
- injury, emergency, unsafe vehicle, or unclear safety: set `priority_flag = true`
- missing minimum fields: call `log_claim_intake_fallback`
- priority case after intake: call `flag_priority_follow_up`

## Step 5: Configure Tool Nodes

Configure each tool node with your public base URL.

```txt
POST https://<id>.ngrok.io/tools/create-claim-intake
POST https://<id>.ngrok.io/tools/log-claim-intake-fallback
POST https://<id>.ngrok.io/tools/flag-priority-follow-up
```

Add this header to each tool:

```txt
x-tool-secret: dev-secret
```

Before calling `create_claim_intake`, make sure the workflow has:

- caller name
- caller phone
- loss type
- loss date
- loss location
- loss description
- priority flag
- consent to continue

## Step 6: Test It

Health check:

```bash
curl http://localhost:8787/health
```

Create a claim intake:

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

Then call your Telnyx number and try these scenarios:

- clean auto claim
- injury reported
- vehicle not drivable
- missing policy number
- human request
- wrong tool secret
- non-auto caller

## Going To Production

This example uses a mock in-memory tool server. For production:

- replace mock IDs with real claim-system writes
- store intake and fallback records durably
- verify Telnyx webhook/tool request authenticity
- move `CLAIM_TOOL_SECRET` into a secret manager
- add structured logs for every tool call
- review workflow copy with legal, compliance, and claims operations
- avoid promises about coverage, payment, repairs, liability, legal advice, or medical advice

## Resources

- [Source code and reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-conversational-workflow-nodejs/README.md)
- [Typed API reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-conversational-workflow-nodejs/API.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
