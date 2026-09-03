# AI Call Summarizer — Developer Guide

This guide walks you through the `ai-call-summarizer` sample: a post-call summarization agent that detects call hangups via Telnyx Call Control webhooks, sends the conversation to OpenAI for summarization, texts the summary back to the caller via SMS, and logs the result to a SQL database for analytics.

---

## Prerequisites

Before you begin, ensure you have:

- A **Telnyx account** with a [Messaging Profile](https://portal.telnyx.com/) and a [Voice Profile](https://portal.telnyx.com/) configured.
- An **OpenAI API key** (the sample uses Telnyx's zero-credential AI binding, so no key is needed in the environment — but you must have access to the Telnyx AI feature).
- A **SQL database** accessible from your Edge runtime (e.g., PostgreSQL, MySQL, or SQLite for local testing).
- Node.js 18+ and npm installed.
- The Telnyx CLI (optional, for local webhook testing).

---

## Environment Setup

### 1. Clone the repository

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-call-summarizer
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:

```env
TELNYX_API_KEY=your_telnyx_api_key_here
TELNYX_PUBLIC_KEY=your_telnyx_public_key_here
DATABASE_URL=postgresql://user:password@localhost:5432/telnyx_summarizer
OPENAI_API_KEY=sk-your-openai-key-here  # Only if not using zero-credential binding
```

> **Note:** The sample uses Telnyx's zero-credential AI binding (`this.env.TELNYX.ai.openai.chat.createCompletion()`), so `OPENAI_API_KEY` is optional. If you prefer to use your own OpenAI key directly, set it here.

---

## How It Works

The AI Call Summarizer is built as a **Telnyx Edge Agent** — a stateful, event-driven application that reacts to Call Control webhooks. Here's the data flow:

```
Call Hangup Webhook
        │
        ▼
SummarizerAgent.onTask()
        │
        ▼
this.messages.toOpenAI()  ← Conversation history
        │
        ▼
LLM Summary (createCompletion)
        │
        ▼
SMS Summary to Caller (messages.send)
        │
        ▼
SQL Log (summaries table)
```

### Component Breakdown

#### 1. Call Control — Hangup Webhook Trigger

When a call ends, Telnyx sends a `call.hangup` webhook to your Edge app. The agent's `onTask()` handler receives this event and extracts the `call_id` and `caller` from the payload.

The webhook handler verifies the Ed25519 signature using `client.webhooks.unwrap()` to ensure the request is genuinely from Telnyx.

#### 2. Agent SDK — `SummarizerAgent`

The `SummarizerAgent` class extends Telnyx's `Agent` base class. It maintains call state — including the `call_id`, `caller` number, and conversation history — across the lifecycle of a single call.

The agent's `onTask()` method is the entry point for processing the hangup event. It orchestrates the entire summarization pipeline.

#### 3. Inference Binding — OpenAI Chat Completion

The agent retrieves the conversation history via `this.messages.toOpenAI()`, which formats the call's transcript into a structure suitable for OpenAI's chat completions API.

It then calls `this.env.TELNYX.ai.openai.chat.createCompletion()` — Telnyx's zero-credential AI binding — to generate a summary. This means you don't need to manage your own OpenAI API key; Telnyx handles the proxying and authentication.

#### 4. Telnyx Binding — SMS Summary

Once the summary is generated, the agent sends it to the caller via `this.env.TELNYX.messages.send()`. This uses Telnyx's native SMS API binding, ensuring reliable delivery and proper rate limiting.

#### 5. SQL DB — Analytics Logging

After the SMS is sent, the summary is logged to a SQL database table named `summaries` with the following schema:

| Column      | Type         | Description                          |
|-------------|--------------|--------------------------------------|
| `call_id`   | `TEXT`       | Unique identifier for the call       |
| `caller`    | `TEXT`       | Caller's phone number (masked)       |
| `summary`   | `TEXT`       | The AI-generated summary text        |
| `duration`  | `INTEGER`    | Call duration in seconds             |
| `timestamp` | `TIMESTAMP`  | When the summary was logged          |

This enables downstream analytics, such as call volume trends, common topics, and agent performance metrics.

---

## Demo Mode vs Live Mode

The sample runs in **demo mode** by default. In demo mode:

- No real SMS messages are sent — the app logs what *would* be sent.
- No real OpenAI API calls are made — a canned summary is returned.
- SQL inserts are logged but not executed against a real database.

To switch to **live mode** (real SMS, real LLM calls, real SQL writes), set the following environment variable:

```env
DEMO_MODE=false
```

In live mode, the app will:

- Send real SMS messages via Telnyx Messaging.
- Call the real OpenAI API through Telnyx's AI binding.
- Write summaries to your configured SQL database.

> ⚠️ **Warning:** Live mode incurs real charges. Ensure your Telnyx and OpenAI accounts are properly funded before enabling it.

---

## Running the Sample

### Local Development

Start the Edge runtime locally:

```bash
npm run dev
```

The app will start on `http://localhost:8787`.

### Exposing for Webhooks

To receive real Call Control webhooks from Telnyx, expose your local server:

```bash
npx localtunnel --port 8787 --subdomain ai-call-summarizer
```

Then configure your Telnyx Voice Profile's webhook URL to point to:

```
https://ai-call-summarizer.loca.lt/webhook
```

### Running the Smoke Test

Verify the app loads correctly:

```bash
npm run smoke-test
```

This test imports the main module and confirms the agent handler is registered without errors.

---

## Code Structure

```
ai-call-summarizer/
├── src/
│   └── index.ts          # Main entry point — Agent handler and webhook routes
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration (strict, ES2022)
├── .env.example          # Placeholder environment variables
├── .gitignore
├── smoke_test.ts         # Smoke test — verifies module loads
├── README.md             # Project overview and quick start
├── API.md                # Typed endpoint reference
└── GUIDE.md              # This file — detailed walkthrough
```

### Key Code Sections

#### Agent Definition (`src/index.ts`)

The `SummarizerAgent` class is defined here. It extends `Agent` and implements `onTask()` to handle the hangup event. The agent uses `this.messages.toOpenAI()` to retrieve conversation history and `this.env.TELNYX.ai.openai.chat.createCompletion()` to generate the summary.

#### Webhook Handler (`src/index.ts`)

The `/webhook` route receives Call Control events. It verifies the Ed25519 signature, parses the event type, and dispatches to the appropriate agent method.

#### SMS Sending (`src/index.ts`)

The `sendSummarySMS()` method uses `this.env.TELNYX.messages.send()` to text the summary to the caller. In demo mode, it logs the message instead of sending.

#### SQL Logging (`src/index.ts`)

The `logSummaryToSQL()` method inserts the summary into the `summaries` table. In demo mode, it logs the SQL statement instead of executing it.

---

## Troubleshooting

### Webhook Signature Verification Fails

Ensure your `TELNYX_PUBLIC_KEY` environment variable matches the public key in your Telnyx Portal under **Auth & Settings > Public Keys**.

### SMS Not Delivered

- Verify your Telnyx Messaging Profile is active and has a phone number assigned.
- Check that the `caller` number is in E.164 format (e.g., `+15551234567`).
- In live mode, ensure your Telnyx account has sufficient balance.

### OpenAI API Errors

- If using zero-credential binding, ensure the Telnyx AI feature is enabled on your account.
- If using your own OpenAI key, verify it's set in `OPENAI_API_KEY` and has sufficient quota.

### SQL Connection Errors

- Verify your `DATABASE_URL` is correct and the database is reachable.
- Ensure the `summaries` table exists (see schema above).
- For local testing, you can use SQLite: `DATABASE_URL=sqlite://./summaries.db`

---

## Next Steps

- **Telnyx Call Control Docs**: https://developers.telnyx.com/docs/voice/call-control
- **Telnyx Agent SDK Docs**: https://developers.telnyx.com/docs/edge/agents
- **Telnyx AI Binding Docs**: https://developers.telnyx.com/docs/ai
- **Telnyx SMS API Docs**: https://developers.telnyx.com/docs/messaging
- **Telnyx SQL Binding Docs**: https://developers.telnyx.com/docs/edge/sql
- **OpenAI Chat Completions API**: https://platform.openai.com/docs/guides/text-generation

Explore related examples in the `telnyx-code-examples` repository:

- `call-transcription` — Real-time call transcription with WebSocket streaming
- `ivr-menu` — Interactive voice response with DTMF input
- `sms-forwarding` — Forward SMS messages to email or Slack
- `voice-analytics` — Call metrics and dashboard integration
