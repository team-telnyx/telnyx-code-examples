```markdown
# Two-Channel OTP — Cross-Channel 2FA with Telnyx Edge Actors

A step-by-step tutorial for the `two-channel-otp` sample: a high-value-action verification flow where a one-time code is **sent by SMS** and **verified by voice**, defeating SIM-swap and SMS-interception attacks.

---

## Prerequisites

- A Telnyx account with an Edge Compute project
- The Telnyx Edge CLI: `npm i -g telnyx-edge`
- Node.js 20+ (for local smoke testing with `tsx`)
- A phone number in E.164 format (e.g. `+15551234567`) for testing — **never commit real numbers**

---

## Project Structure

```
two-channel-otp/
├── src/
│   └── index.ts          # Main entry: AuthSession actor + HTTP handler
├── smoke_test.ts         # Verifies module loads and key methods exist
├── package.json
├── tsconfig.json
├── telnyx.toml           # Edge bindings config
├── .env.example
├── .gitignore
├── API.md
├── GUIDE.md
└── README.md
```

---

## Environment Setup

### 1. Authenticate the CLI

```bash
telnyx-edge auth api-key set <your_api_key>
```

### 2. Configure `telnyx.toml`

The `telnyx.toml` file declares all bindings. Key sections:

```toml
name = "two-channel-otp"
main = "src/index.ts"
compatibility_date = "2026-07-28"

[[actors]]
binding = "SESSIONS"
type    = "AuthSession"

[[secrets]]
binding = "TELNYX_API_KEY"
name    = "TELNYX_API_KEY"

[telnyx]
binding = "TELNYX"

[storage.sqldb.LOCKS]
id = "<sql-db-uuid>"

[env_vars]
VERIFICATION_LINE_E164 = "+1555XXXXXXXX"
SECURITY_REVIEW_E164   = "+1555XXXXXXXX"
STT_TIMEOUT_MS         = "6000"
CODE_TTL_SECONDS       = "120"
MAX_FAILURES           = "3"
DEMO_MODE              = "true"
```

Generate the typed env declarations:

```bash
telnyx-edge types
```

### 3. Set Secrets

```bash
telnyx-edge secrets add TELNYX_API_KEY "your_telnyx_api_key_here"
```

### 4. `.env.example`

```env
TELNYX_API_KEY=your_telnyx_api_key_here
VERIFICATION_LINE_E164=+1555XXXXXXXX
SECURITY_REVIEW_E164=+1555XXXXXXXX
STT_TIMEOUT_MS=6000
CODE_TTL_SECONDS=120
MAX_FAILURES=3
DEMO_MODE=true
```

---

## How It Works — Step by Step

### Step 1: The Actor IS the Auth Session

The `AuthSession` class (in `src/index.ts`) extends `Agent<SessionEnv, SessionState>`. This is the durable entity that holds the pending code, its issue time, expiry time, failure count, and status. Because it's a Telnyx Edge Actor, this state **survives a pod restart** — the code and timer are durable.

The state shape is:

```typescript
interface SessionState {
  user: string;
  code: string | null;
  issuedAt: number | null;
  expiresAt: number | null;
  fails: number;
  status: "open" | "verified" | "expired" | "locked";
}
```

### Step 2: Issuing a Code (`POST /issue`)

When a high-value action is requested, the HTTP handler receives `POST /issue` with `{ "userE164": "+15551234567" }`. It addresses the actor via `env.SESSIONS.idFromName(userE164)` — **one durable actor per user/session** — then calls `stub.issue(userE164)`.

Inside `issue()`:

1. A 6-digit code is generated via `randomCode()`.
2. State is set: `{ code, issuedAt: now, expiresAt: now + 120s, fails: 0, status: "open" }`.
3. An SMS is sent via `this.env.TELNYX.messages.send({ to: user, text: ... })` — the code travels on the **SMS channel**.
4. A self-scheduled timer is set: `this.schedule(120, "expire", {}, { id: "expire:" + user })` — this is the actor's self-wake that voids the code after 2 minutes.

In **demo mode** (`DEMO_MODE=true`, the default), the SMS is logged instead of sent:

```
[DEMO] Would send SMS to +15551234567: Your verification code is 4 8 2 9 1 3. ...
```

### Step 3: The User Calls — Voice Verification Leg

The user calls the verification line. Telnyx Call Control fires a `call.initiated` webhook to `POST /webhook`. The handler extracts the caller's E.164 from `data.payload.from.e164` and addresses the same actor via `env.SESSIONS.idFromName(callerE164)`.

The actor's `onCallStart()` method runs:

1. **Checks for a valid open session**: If no session exists, or the session is already verified/expired/locked, or the code has expired, the actor **re-issues a fresh code** and says: *"We don't have a pending verification for this number. We'll text you a new code."*
2. **If a valid session exists**: The actor says *"Thanks for calling. Please read your 6-digit code."* and calls `captureCode()`.

### Step 4: Capturing the Code — STT Primary, DTMF Fallback

The `captureCode()` method implements the **cross-channel verification** — the code was delivered by SMS, now it's captured by voice:

1. **Primary path — `gather-using-ai` (STT)**: The actor issues a `gather-using-ai` command on the call. The user speaks the 6-digit code, and Telnyx's AI transcribes it. If the result is a valid 6-digit string, it's returned.
2. **Fallback path — `gather` (DTMF)**: If STT times out (default 6 seconds, configurable via `STT_TIMEOUT_MS`) or returns a non-6-digit result, the actor falls back to `gather` for DTMF keypad entry. The user dials the code on their phone's keypad.

Both paths return a 6-character string (or `null`), so the match/expiry/fail logic is identical regardless of which channel the user used.

In **demo mode**, `captureCode()` simulates a correct code capture (`"000000"`) so you can test the full flow without a real call.

### Step 5: Matching — Cross-Channel Proof

The actor compares the spoken/entered code against `this.state.code`:

- **Match + within expiry**: The actor sets `status: "verified"`, clears the code, and says *"Verified — your transfer is confirmed."* This is the **cross-channel security property**: the code traveled on SMS (channel 1) and was validated by voice (channel 2). An attacker who intercepts the SMS cannot complete verification without also controlling the voice leg.
- **Mismatch or expired**: The actor increments `fails`. If `fails < 3`, it re-issues a new code and says *"That code didn't match or has expired. I'll text you a new one."* If `fails >= 3`, it calls `lock()`.

### Step 6: Failure Handling — Lock + Review Surface

After 3 failed attempts, `lock()` does three things:

1. **Sets `status: "locked"`** in durable state — the session is permanently locked.
2. **Inserts a row into the `locks` SQL table** via `this.env.LOCKS.exec("INSERT INTO locks ...")` — this is the review surface a security team can query.
3. **Sends an SMS to `SECURITY_REVIEW_E164`** — the on-call security number gets paged with the user's number and attempt count.

### Step 7: Expiry — The Actor's Self-Wake

The `expire()` task handler fires 120 seconds after `issue()`:

```typescript
async expire(): Promise<void> {
  if (this.state.status === "open") {
    await this.setState({ status: "expired", code: null });
  }
}
```

This voids the code **exactly once**. Because the actor is durable, if a pod restart happens between `issue()` and the expiry timer firing, the timer **re-arms on re-activation** — the code is still voided at the right time.

### Step 8: Restart Proof

If the Edge function is killed between the SMS and the voice verify:

1. The session state (`code`, `issuedAt`, `expiresAt`, `fails`, `status`) is **durable** — it persists across the restart.
2. When the user calls, the actor is re-activated, reads the same state, and the code **still validates** (within expiry).
3. The expiry timer **re-arms** and voids the code exactly once — no double issue, no double expire.

---

## Demo Mode vs Live Mode

| | Demo Mode | Live Mode |
|---|---|---|
| `DEMO_MODE` | `true` (default) | `false` |
| SMS | Logged, not sent | Sent via `TELNYX.messages.send` |
| Voice calls | Simulated code capture (`"000000"`) | Real `gather-using-ai` + `gather` |
| Security SMS | Logged | Sent to `SECURITY_REVIEW_E164` |
| Charges | None | Real Telnyx charges apply |

### Switching to Live Mode

```bash
telnyx-edge secrets add DEMO_MODE "false"
```

Or set it in `telnyx.toml` under `[env_vars]`.

---

## Running the Sample

### Local Smoke Test

```bash
npx tsx smoke_test.ts
```

This verifies that the `AuthSession` class loads, key methods exist (`issue`, `onCallStart`, `captureCode`, `lock`, `expire`), and the HTTP handler is wired up.

### Deploy

```bash
telnyx-edge ship
```

### Trigger a Code (Demo)

```bash
curl -X POST https://<your-edge-url>/issue \
  -H "Content-Type: application/json" \
  -d '{"userE164": "+15551234567"}'
```

You'll see the simulated SMS in the logs. In live mode, the code is actually sent.

### Test the Voice Leg

Call your verification line (`VERIFICATION_LINE_E164`). In demo mode, the actor simulates a correct code capture and says *"Verified — your transfer is confirmed."* In live mode, you'll need to speak or dial the code you received via SMS.

---

## Telnyx Primitives Used

| Primitive | Where | Purpose |
|---|---|---|
| **Agent SDK** (`Agent<Env, State>`) | `AuthSession` class | The durable auth session — owns code, expiry, failure count, timer |
| **Messaging** (`TELNYX.messages.send`) | `issue()`, `lock()` | Delivers the 6-digit code by SMS; sends security alert SMS |
| **Call Control** (`call.initiated` webhook) | `/webhook` handler | Inbound call routing to the right actor by caller E.164 |
| **`gather-using-ai`** (STT) | `captureCode()` → `gatherUsingAi()` | Captures the spoken code via speech-to-text |
| **`gather`** (DTMF) | `captureCode()` → `gatherDtmf()` | Fallback: captures keypad-entered code |
| **`schedule()`** | `issue()` | Self-wake timer (`expire:<session>`) that voids the code after 120s |
| **StateStore** (`setState`/`getState`) | Throughout | Durable session state: `{ code, issuedAt, expiresAt, fails, status }` |
| **SQL** (`LOCKS.exec`) | `lock()` | Review surface: inserts a row per locked session |

---

## Key Design Decisions

1. **One actor per user**: `env.SESSIONS.idFromName(userE164)` ensures a single durable session per phone number. The same key is used for both `issue()` (SMS leg) and `onCallStart()` (voice leg).

2. **STT primary, DTMF fallback**: Spoken codes are lower-friction and higher-assurance (a human must be on the line). DTMF covers users who dial from a keypad or where STT confidence is poor. Both share the same `captureCode()` return contract.

3. **No callback to initiating app**: The demo marks `status: "verified"` in state and logs the verification. In production, the app would pass a `callbackUrl` in `issue()`'s payload, and the verified path would POST `{ userE164, verified: true, ts }` there.

4. **Bounded re-issues**: After 3 failures, the session is locked — no more re-issues. This prevents brute-force attacks.

5. **Expiry timer is actor-owned**: No external cron. The `schedule()` call is durable and re-arms on restart.

---

## Next Steps

- [Telnyx Agent SDK docs](https://developers.telnyx.com/docs/agent-sdk) — learn about `Agent`, `StatefulActor`, `schedule()`, and `queue()`
- [Scheduled Tasks](https://developers.telnyx.com/docs/agent-sdk/scheduled-tasks) — deep dive on `this.schedule()` and task handlers
- [Stateful Actors](https://developers.telnyx.com/docs/edge-compute/stateful-actors) — durability, restarts, and state persistence
- [Send a Message](https://developers.telnyx.com/docs/messaging/messages/send-message) — SMS API reference
- [Gather Using AI](https://developers.telnyx.com/docs/voice/programmable-voice/gather-using-ai) — STT capture for voice verification
- [Gather (DTMF)](https://developers.telnyx.com/api-reference/call-commands/gather) — keypad input capture
- [VapiAI otp-sms examples](https://github.com/VapiAI/examples) — the voice agent pattern this sample is based on
- [Call Control Overview](https://developers.telnyx.com/docs/voice/programmable-voice/call-control) — inbound/outbound call handling
- [SQL Storage](https://developers.telnyx.com/docs/edge-compute/storage/sql) — using `SqlDatabase` for the lock review surface
```
