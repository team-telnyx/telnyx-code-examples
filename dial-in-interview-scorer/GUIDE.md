```markdown
# Dial-in Interview Scorer — Developer Guide

A step-by-step walkthrough of the `dial-in-interview-scorer` sample. This guide explains how a **Telnyx Edge Agent** orchestrates a rubric-driven intake interview: dialing a candidate, capturing answers with `gather-using-ai`, scoring each answer **mid-call** with the Telnyx Decision Models API, and streaming the live scorecard to a hiring-manager dashboard over Agent SDK WebSockets.

---

## Prerequisites

| What you need | Details |
|---|---|
| Telnyx account | Sign up at [telnyx.com](https://telnyx.com). You need a Voice connection (`OUTBOUND_CONNECTION_ID`) and a voice-enabled phone number (`OUTBOUND_CALLER_ID`). |
| Telnyx CLI | `npm i -g telnyx-edge` then `telnyx-edge auth api-key set <YOUR_API_KEY>` |
| Node.js | v18+ (for local smoke test via `npx tsx`) |
| API key | Stored as a secret: `telnyx-edge secrets add TELNYX_API_KEY "<your_key>"` |

---

## Project Layout

```
dial-in-interview-scorer/
├── src/
│   └── index.ts          # InterviewCall Agent + entry point
├── smoke_test.ts         # Verifies the module loads
├── package.json
├── tsconfig.json
├── telnyx.toml           # Actor + binding declarations
├── .env.example
└── .gitignore
```

---

## Environment Setup

### 1. Install dependencies

```bash
cd dial-in-interview-scorer
npm install
```

### 2. Configure `telnyx.toml`

This file declares the durable actor namespace, the Telnyx API binding, and the SQL storage binding. **No credentials live in code** — everything is injected by the platform.

```toml
name = "dial-in-interview-scorer"
main = "src/index.ts"
compatibility_date = "2026-07-28"

[[actors]]
binding = "INTERVIEWS"
type    = "InterviewCall"

[[secrets]]
binding = "TELNYX_API_KEY"
name = "TELNYX_API_KEY"

[telnyx]
binding = "TELNYX"

[storage.sqldb.SCORECARD_DB]
id = "<sql-database-uuid>"
```

> Replace `<sql-database-uuid>` with a real SQL database namespace UUID from the Telnyx dashboard.

### 3. Set secrets

```bash
telnyx-edge secrets add TELNYX_API_KEY "<your_api_key_here>"
```

### 4. Environment variables

| Variable | Description | Default |
|---|---|---|
| `OUTBOUND_CONNECTION_ID` | Call Control connection for dialing | *(required for live mode)* |
| `OUTBOUND_CALLER_ID` | Voice number to dial from | *(required for live mode)* |
| `DASHBOARD_ORIGIN` | Allowed WebSocket origin (e.g. `https://dashboard.example.com`) | `http://localhost:3000` |
| `MAX_CALL_MINUTES` | Max call duration before auto-hangup | `1800` |
| `RESUME_RETRY_MAX` | Max recovery re-dial attempts | `3` |
| `ANSWER_SILENCE_MS` | Silence timeout for `gather-using-ai` | `3000` |
| `DECISION_TIMEOUT_MS` | Timeout for Decision Models API | `8000` |

---

## Demo Mode vs Live Mode

### Demo Mode (default)

If `OUTBOUND_CONNECTION_ID` or `OUTBOUND_CALLER_ID` is unset or contains placeholder text (`<`), the actor **skips the real dial** and logs a warning. No calls are placed, no charges incurred. The scorecard SQL table is still created and the WebSocket surface still works — you can test the scoring and broadcast logic without a live phone line.

### Live Mode

Set real values for both `OUTBOUND_CONNECTION_ID` and `OUTBOUND_CALLER_ID` in your environment or via the Telnyx dashboard. The actor will dial the candidate's phone number when `openInterview` is called.

---

## How It Works — Step by Step

### Step 1: Actor Birth via `@rpc openInterview`

**Code reference: `openInterview` method**

When a hiring manager books a candidate, the entry-point `fetch` handler receives a POST to `/open` with `{ candidate, phone, questions[] }`. It derives a deterministic actor ID from the phone digits:

```typescript
const digits = phone.replace(/\D/g, "");
const stub = e.INTERVIEWS.idFromName(digits);
```

This guarantees **one durable actor per candidate line**. The actor is born with `initialState()` — an empty scorecard and `currentQIdx: 0`.

The `@rpc openInterview` method:
1. Validates inputs (candidate, phone, questions).
2. Calls `setState()` to populate the actor's in-memory state.
3. Calls `initScorecard()` to create the SQL `interviews` table if it doesn't exist.
4. Calls `dialCandidate()` to place the outbound call.

### Step 2: Dialing the Candidate

**Code reference: `dialCandidate` method**

The actor calls `POST https://api.telnyx.com/v2/calls` with:
- `connection_id` — your Call Control app
- `from` — your voice number
- `to` — the candidate's phone

The response contains a `call_control_id`, which is stored in actor state as `callId`. This ID is used for all subsequent Call Control commands on this call.

### Step 3: Per-Question Flow — Speak → Gather → Score

**Code references: `askQuestion`, `startGather`, `handleGatherEnded`, `scoreAnswer`, `doScoreAnswer`**

For each rubric question (indexed by `qIdx`):

1. **`speakText(question.text)`** — The actor sends a `POST /v2/calls/{callId}/actions/speak` to read the question aloud via TTS.

2. **`startGather(question)`** — The actor sends `POST /v2/calls/{callId}/actions/gather_using_ai` with a `speech_request` prompt. This captures the candidate's spoken answer and transcribes it.

3. **Callback: `call-ai-gather-ended`** — Telnyx sends this webhook when the gather completes. The actor's `fetch` handler routes it to `handleGatherEnded(payload)`, which extracts the `transcript`.

4. **`scoreAnswer(qIdx, question, answer)`** — Instead of calling the Decision Models API directly (which could exceed the 30-second inbound webhook budget), the actor **queues** the work:

   ```typescript
   await this.queue("doScoreAnswer", { qIdx, question, answer });
   ```

   This defers the scoring to a background task, keeping the webhook handler fast.

### Step 4: Mid-Call Scoring with Decision Models

**Code reference: `doScoreAnswer` method**

The queued task calls `POST https://api.telnyx.com/v2/ai/typesafe/v1/systemone` with:

```json
{
  "model": "telnyx/decision-flash",
  "state": {
    "question": "Tell me about a time you led a team through change.",
    "answer": "Well, at my last job...",
    "rubric": "Leadership: 0=none, 1=struggled, 2=adequate, 3=exemplary"
  },
  "questions": {
    "scoreQ": { "type": "number", "min": 0, "max": 3 },
    "verdict": { "type": "choice", "options": ["continue", "ask-clarify", "skip"] },
    "escalate": { "type": "noul", "min": 0, "max": 1 }
  }
}
```

The Decision Model returns:
- **`scoreQ`** (0–3) — the rubric score for this answer
- **`verdict`** — whether to continue, ask a clarifier, or skip
- **`escalate`** (0–1) — a "need human" confidence gate

**Error handling:** If the API returns 429/529, the actor honors `Retry-After` and reschedules via `this.schedule()`. If it times out (8s), it falls back to a neutral score of 1 and `continue`.

### Step 5: Persist + Broadcast the Score

**Code references: `persistScore`, `broadcastScore`**

After scoring:

1. **`persistScore`** — Inserts the score into the SQL `interviews` table:

   ```sql
   INSERT OR REPLACE INTO interviews (phone, qIdx, answer, score, choice, noul, notes, answered)
   VALUES (?, ?, ?, ?, ?, ?, ?, 1)
   ```

   The `PRIMARY KEY (phone, qIdx)` ensures no duplicate answers — critical for resume-after-drop.

2. **`broadcastScore`** — Pushes a JSON payload to all connected WebSocket clients:

   ```json
   {
     "qIdx": 2,
     "answer": "Well, at my last job...",
     "score": 2,
     "choice": "continue",
     "noul": 0.1,
     "running": 5,
     "total": 5
   }
   ```

   The hiring manager's dashboard (connected via `AgentSocketServer`) receives this in real time — **the scorecard fills live while the candidate is still talking**.

### Step 6: Escalation Gate

**Code reference: `doScoreAnswer` — escalation check**

If `noul > 0.8` (the escalation threshold), the actor:
1. Sets `escalated: true, completed: true` in state.
2. Speaks a TTS message: *"This interview is being escalated to a human reviewer."*
3. Broadcasts `{ completed: true, escalated: true }` to the dashboard.
4. Ends the interview early — no further questions asked.

### Step 7: Clarifier or Next Question

**Code reference: `doScoreAnswer` — choice handling**

Based on the `verdict`:
- **`ask-clarify`** — The actor speaks a follow-up prompt: *"Let me ask you to clarify that answer."* then re-gathers.
- **`skip`** — The actor moves to the next question without re-asking.
- **`continue`** — The actor advances to the next question via `askQuestion(nextQIdx)`.

### Step 8: Call Drop Recovery

**Code references: `handleHangup`, `recoverInterview`, `getLastAnsweredQIdx`**

If the call drops (`call-hangup` callback fires):

1. `handleHangup` checks if the interview is already completed. If not, it increments a retry counter and schedules `recoverInterview` with exponential backoff:

   ```typescript
   const delay = Math.min(Math.pow(2, retryCount) * 5, 60); // 5s, 10s, 20s, capped at 60s
   await this.schedule(delay, "recoverInterview");
   ```

2. `recoverInterview` queries SQL for the last answered question:

   ```sql
   SELECT MAX(qIdx) as maxQ FROM interviews WHERE phone = ? AND answered = 1
   ```

3. It sets `currentQIdx = lastAnswered + 1`, re-dials the candidate, speaks *"Picking up where we left off..."*, and resumes at the correct question.

**Key guarantee:** Because `qIdx` is `UNIQUE` per candidate in SQL, the resumed scorecard is identical to the pre-drop scorecard — no duplicates, no losses.

### Step 9: Interview Completion

**Code references: `finalizeInterview`, `speakSummary`, `generateWriteup`**

When the last question is scored (or escalation triggers):

1. `speakSummary(escalated)` — Speaks a 30-second TTS summary:
   - Normal: *"Interview complete. Average score: 2.3 out of 3. Thank you for your time."*
   - Escalated: *"This interview is being escalated to a human reviewer."*

2. `generateWriteup()` — Compiles a text summary from all SQL scores.

3. `finalizeInterview` — Sets `completed: true` in state and broadcasts `{ completed: true, summary: writeup }` to the dashboard.

---

## WebSocket Dashboard Surface

**Code reference: `fetch` method — `/ws` route**

The actor exposes a WebSocket endpoint at `/ws`:

```typescript
if (url.pathname === "/ws") {
  // Origin check
  if (origin && origin !== this.env.DASHBOARD_ORIGIN) {
    return new Response("Forbidden origin", { status: 403 });
  }
  const ws = this.webSocket(req);
  if (ws) return new Response(null, { status: 101, webSocket: ws });
}
```

A hiring manager dashboard connects once:

```javascript
const ws = new WebSocket("wss://<actor-url>/ws");
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // data = { qIdx, answer, score, choice, noul, running, total }
  // Update the live scorecard UI
};
```

Every `broadcastScore` call fans out to all connected clients. The dashboard sees the scorecard fill in real time.

---

## SQL Storage Schema

**Code reference: `initScorecard` method**

```sql
CREATE TABLE IF NOT EXISTS interviews (
  phone TEXT NOT NULL,
  qIdx INTEGER NOT NULL,
  answer TEXT,
  score REAL,
  choice TEXT,
  noul REAL,
  notes TEXT,
  answered INTEGER DEFAULT 0,
  PRIMARY KEY (phone, qIdx)
)
```

- `phone` + `qIdx` form the composite primary key — one row per question per candidate.
- `answered = 1` marks completed questions (used by the resume logic).
- `notes` stores the raw Decision Model JSON response for audit.

---

## Telnyx Primitives Used

| Primitive | Where | Purpose |
|---|---|---|
| **Agent SDK** (`Agent<Env, InterviewState>`) | `InterviewCall` class | Durable, stateful actor with RPC, queue, schedule, WebSocket |
| **`@rpc`** | `openInterview` | Public RPC entry point to start an interview |
| **`this.queue()`** | `scoreAnswer` | Defers Decision Model calls out of the 30s webhook budget |
| **`this.schedule()`** | `handleHangup`, `doScoreAnswer` (retry) | Recovery backoff + Decision Model retry with `Retry-After` |
| **Call Control** (`POST /v2/calls`) | `dialCandidate` | Dials the candidate |
| **Call Control** (`/actions/speak`) | `speakText` | TTS for questions and summaries |
| **Call Control** (`/actions/gather_using_ai`) | `startGather` | Captures candidate answers via AI speech recognition |
| **Decision Models** (`POST /v2/ai/typesafe/v1/systemone`) | `doScoreAnswer` | Per-answer rubric scoring (0–3), choice, noul escalation |
| **AgentSocketServer** (`this.webSocket()`) | `fetch` `/ws` route | Live scorecard streaming to dashboard |
| **SQL Storage** (`this.env.SCORECARD_DB`) | `initScorecard`, `persistScore`, `getLastAnsweredQIdx` | Durable scorecard + resume pointer |

---

## Running the Smoke Test

```bash
npx tsx smoke_test.ts
```

This verifies:
- The `InterviewCall` class loads.
- The `openInterview` RPC method exists.
- The `fetch` handler is defined.
- The module imports without error.

---

## Deploying

```bash
telnyx-edge ship
```

This deploys the actor to the Telnyx Edge. After deployment, you can trigger interviews by POSTing to the actor's `/open` endpoint.

---

## Next Steps

- **[Telnyx Agent SDK Docs](https://developers.telnyx.com/docs/agent-sdk)** — Learn about `StatefulActor`, `Agent`, `queue()`, `schedule()`, and WebSocket surfaces.
- **[Call Control API](https://developers.telnyx.com/api-reference/call-commands)** — Full reference for `speak`, `gather_using_ai`, `hangup`, and more.
- **[Decision Models API](https://developers.telnyx.com/api-reference/decision-models/evaluate-decision-models-typesafe-compatible)** — Typesafe evaluation with `score`, `choice`, and `noul` outputs.
- **[Gather Using AI](https://developers.telnyx.com/docs/voice/programmable-voice/gather-using-ai)** — Capture speech with AI-powered transcription.
- **[Agent SDK SQL](https://developers.telnyx.com/docs/agent-sdk/sql)** — Durable storage patterns for actors.
- **[Agent SDK WebSockets](https://developers.telnyx.com/docs/agent-sdk/websockets)** — Real-time streaming to dashboards.
- **[Agent SDK Scheduled Tasks](https://developers.telnyx.com/docs/agent-sdk/scheduled-tasks)** — Backoff, retries, and recovery patterns.
```
