# OTP Guard — the second lock

A step-by-step tutorial for building a **durable step-up verification session** on Telnyx Edge. The actor *is* the verification session: it owns the trigger, the attempt budget, the expiry clock, the lockout, and the append-only audit trail. Telnyx Verify owns the code itself — generation, delivery, and profile policy.

By the end you'll have a working sample where a user changing their payout destination must clear a 6-digit SMS code, gets exactly three tries, gets locked out for ten minutes when they burn them, and can come back twenty minutes later — or after the worker was `kill -9`'d — and find the same session waiting with the same budget and the same audit trail.

---

## Table of contents

1. [What you're building](#1-what-youre-building)
2. [Prerequisites](#2-prerequisites)
3. [Project layout](#3-project-layout)
4. [Environment setup](#4-environment-setup)
5. [Step 1 — The session is the actor](#step-1--the-session-is-the-actor)
6. [Step 2 — Create the step-up verify profile](#step-2--create-the-step-up-verify-profile)
7. [Step 3 — Trigger the verification](#step-3--trigger-the-verification)
8. [Step 4 — Submit the code (the accepted path)](#step-4--submit-the-code-the-accepted-path)
9. [Step 5 — The attempt budget and the lockout](#step-5--the-attempt-budget-and-the-lockout)
10. [Step 6 — Expiry, handled cleanly](#step-6--expiry-handled-cleanly)
11. [Step 7 — The audit trail](#step-7--the-audit-trail)
12. [Step 8 — Verify webhooks as a second signal](#step-8--verify-webhooks-as-a-second-signal)
13. [Step 9 — Crash resume and concurrent checks](#step-9--crash-resume-and-concurrent-checks)
14. [Demo mode vs live mode](#demo-mode-vs-live-mode)
15. [Running the demo](#running-the-demo)
16. [Troubleshooting](#troubleshooting)
17. [Next steps](#next-steps)

---

## 1. What you're building

Most "2FA" samples hand-roll OTP generation: generate a random number, store it in Redis, compare strings, expire the key. That works until the process restarts, the cache is flushed, or two requests race and the counter decrements twice.

This sample takes the other road. **Telnyx Verify owns the code. The actor owns the session.**

```
┌──────────────────────────────────────────────────────────────┐
│  OtpGuard actor  (idFromName("action-4471"))                 │
│                                                              │
│  state:                                                      │
│    action_kind      "payout_destination_change"              │
│    phone_number     "+15551234567"                           │
│    destination      "acct_99812"                             │
│    verify_id        "vrfy_..."        ← from Verify          │
│    verify_profile_id "prof_..."       ← step-up policy       │
│    status           idle|pending|committed|locked|expired    │
│    attempts_left    3 → 2 → 1 → 0                            │
│    expires_at       trigger + 300s                           │
│    locked_until     now + 600s                               │
│    audit[]          append-only event log                    │
└──────────────────────────────────────────────────────────────┘
              │                              │
              │ raw fetch                    │ this.schedule()
              ▼                              ▼
   api.telnyx.com/v2/verifications   cool-down timer that
   /sms  and  /check/{id}            lifts the lock
```

The split of responsibility is the whole point:

| Owner | Responsibility |
|---|---|
| **Telnyx Verify** | Code generation, SMS delivery, code validation, profile policy (length, expiry) |
| **The actor** | Attempt budget, expiry clock, lockout, cool-down timer, audit trail, session durability |

Verify profiles do **not** expose a server-side max-attempts knob. Enforcing "three strikes" is the actor's job — and that is exactly the class of bug this sample makes visible.

---

## 2. Prerequisites

- **Node.js 20+** and `npx`
- A **Telnyx account** with Verify enabled — [sign up here](https://telnyx.com/sign-up)
- A **Telnyx API key** (V2) from the [Telnyx Portal](https://portal.telnyx.com/#/app/api-keys)
- A **Telnyx public key** for webhook signature verification (Portal → Account Settings → Public Key)
- The **`telnyx-edge` CLI**:

  ```bash
  npm install -g @telnyx/edge-runtime-cli
  telnyx-edge auth api-key set YOUR_TELNYX_API_KEY
  ```

- A **Telnyx phone number** capable of sending SMS, if you want live-mode notifications (`DISPATCH_FROM_NUMBER`)

You do **not** need a real phone number to run the demo — demo mode is the default.

---

## 3. Project layout

```
otp-guard/
├── src/
│   └── index.ts          # OtpGuard actor + plain-fetch HTTP router
├── package.json          # @telnyx/edge-runtime, deploy/types scripts
├── tsconfig.json         # ES2022, strict, include: ["src/**/*.ts"]
├── telnyx.toml           # actor binding, secrets, TELNYX API binding
├── .env.example          # placeholder env vars only
├── .gitignore
├── smoke_test.ts         # npx tsx smoke_test.ts
├── README.md
├── API.md
└── GUIDE.md              # ← you are here
```

Everything that matters lives in `src/index.ts`, in two halves:

- **The actor half** — `class OtpGuard extends Agent<Env, GuardState>`, from `initialState()` through `notify()`. This is the session.
- **The HTTP half** — the `export default { fetch }` router plus `handleVerifyWebhook()`. This is the thin transport that resolves an action id to an actor stub and calls a method on it.

---

## 4. Environment setup

### 4.1 `telnyx.toml`

```toml
name = "otp-guard"
main = "src/index.ts"
compatibility_date = "2026-07-28"

[[actors]]
binding = "OTP_GUARD"
type    = "OtpGuard"

[[secrets]]
binding = "TELNYX_API_KEY"
name    = "TELNYX_API_KEY"

[[secrets]]
binding = "TELNYX_PUBLIC_KEY"
name    = "TELNYX_PUBLIC_KEY"

[telnyx]
binding = "TELNYX"          # zero-credential binding — used only for SMS notifications

[env_vars]
DEMO_MODE = "true"
DEMO_PHONE = "+1555XXXXXXXX"
```

The `OTP_GUARD` actor binding is what makes `env.OTP_GUARD.idFromName("action-4471")` resolve to a durable, addressable instance. The `TELNYX` binding is used **only** for outbound SMS notifications via `this.env.TELNYX.messages.send(...)` — the Edge binding does not expose the Verify endpoints, so Verify calls go over raw `fetch` with the API key from secrets.

### 4.2 Secrets

```bash
telnyx-edge secrets add TELNYX_API_KEY "KEY_your_key_here"
telnyx-edge secrets add TELNYX_PUBLIC_KEY "your_base64_ed25519_public_key"
```

### 4.3 `.env.example`

```dotenv
# Required for live mode
TELNYX_API_KEY=your_telnyx_api_key_here
TELNYX_PUBLIC_KEY=your_telnyx_public_key_here

# Demo mode (default: true) — stubs Verify HTTP calls, never sends real SMS
DEMO_MODE=true

# E.164 number used by the demo curl flows
DEMO_PHONE=+1555XXXXXXXX

# Optional: reuse an existing step-up verify profile instead of creating one
VERIFY_PROFILE_ID=

# Public base URL of the deployed worker — used to build the Verify webhook URL
PUBLIC_BASE_URL=https://otp-guard.example.workers.dev

# Telnyx number used as the `from` for SMS notifications (live mode only)
DISPATCH_FROM_NUMBER=+1555XXXXXXXX
```

No real credentials, no real phone numbers. Ever.

### 4.4 Generate types and deploy

```bash
npm install
telnyx-edge types      # regenerates telnyx-env.d.ts from telnyx.toml
telnyx-edge ship       # deploy
```

`telnyx-edge types` is what makes `env.OTP_GUARD`, `env.SECRETS`, and `env.TELNYX` type-check against your actual bindings.

---

## Step 1 — The session is the actor

Open `src/index.ts` and start at the top: the constants and the state shape.

```ts
export const MAX_ATTEMPTS = 3;
export const LOCKOUT_SECONDS = 600;
export const VERIFICATION_TIMEOUT_SECS = 300;
const DEMO_ACCEPT_CODE = "123456";
```

These three numbers are the entire step-up policy, stated as demo constants:

| Constant | Value | Meaning |
|---|---|---|
| `MAX_ATTEMPTS` | 3 | Wrong codes before the session locks |
| `LOCKOUT_SECONDS` | 600 | Cool-down before the lock lifts (10 minutes) |
| `VERIFICATION_TIMEOUT_SECS` | 300 | Code lifetime (5 minutes) — the "short expiry" step-up tuning |

Next come the validators — `isE164`, `isActionId`, `isVerificationCode` — and `maskPhone()`, which is the only way a phone number leaves the actor:

```ts
export function maskPhone(phone: string): string {
  if (phone.length <= 9) return "***";
  return `${phone.slice(0, 5)}***${phone.slice(-4)}`;
}
```

Then the state interface, `GuardState`. Read it as a checklist of everything the session must survive a restart:

```ts
export interface GuardState {
  action_kind: string;
  phone_number: string;
  destination: string | null;
  verify_id: string | null;
  verify_profile_id: string | null;
  status: "idle" | "pending" | "committed" | "locked" | "expired";
  attempts_left: number;
  expires_at: string | null;
  locked_until: string | null;
  audit: AuditEntry[];
}
```

And the actor itself:

```ts
export class OtpGuard extends Agent<Env, GuardState> {
  protected initialState(): GuardState { /* ... */ }
```

`Agent<E, State>` gives you `getState()` / `setState()` (merge-patch semantics — `setState({ attempts_left: 2 })` touches only that field), `schedule(delaySeconds, method, payload)`, and durable storage underneath. The state is not a cache. It is the session.

The `demoMode` getter is the single switch that decides whether Verify calls hit the network:

```ts
private get demoMode(): boolean {
  return (this.env.DEMO_MODE ?? "true").toLowerCase() !== "false";
}
```

Default is `true`. You have to explicitly opt into live mode.

Finally, the audit primitive — a private helper every other method funnels through:

```ts
private async record(event: string, result: string, detail: Record<string, unknown> = {}): Promise<void> {
  const state = await this.getState();
  const audit = [...state.audit, { at: new Date().toISOString(), event, result, detail }];
  await this.setState({ audit });
}
```

Append-only by construction: read the array, spread it into a new one, write it back. Nothing ever removes an entry.

---

## Step 2 — Create the step-up verify profile

`onProfileCreated()` is the one-time setup call. It's idempotent — call it twice and the second call returns `created: false`.

```ts
async onProfileCreated(input: { action_id: string }) {
  const state = await this.getState();
  if (state.verify_profile_id) {
    return { ok: true, created: false, verify_profile_id: state.verify_profile_id };
  }
  const fromEnv = this.env.VERIFY_PROFILE_ID;
  if (fromEnv) { /* attach the existing profile, record it, return */ }
  const profileId = await this.createStepUpProfile(input.action_id);
  /* ... */
}
```

Three paths, in priority order:

1. **Already attached** — the actor remembers its profile, so a restart doesn't create a second one.
2. **`VERIFY_PROFILE_ID` env var set** — reuse an existing profile (useful when you've tuned one in the portal).
3. **Create a new one** — `createStepUpProfile()`.

The creation call is where the step-up policy is expressed:

```ts
private async createStepUpProfile(actionId: string): Promise<string> {
  if (this.demoMode) return DEMO_PROFILE_ID;
  const base = (this.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  const webhookUrl = base ? `${base}/webhooks/verify?action_id=${encodeURIComponent(actionId)}` : undefined;
  const res = await this.verifyApi("/verify_profiles", {
    method: "POST",
    body: JSON.stringify({
      name: `otp-guard-step-up-${actionId}`,
      language: "en-US",
      sms: { code_length: 6, default_verification_timeout_secs: VERIFICATION_TIMEOUT_SECS },
      ...(webhookUrl ? { webhook_url: webhookUrl } : {}),
    }),
  });
  /* ... */
}
```

Two things to notice:

- **`code_length: 6` and `default_verification_timeout_secs: 300`** are the profile tuning. A step-up profile is deliberately tighter than a login profile: five minutes is enough for a user who is already mid-task, and short enough that a leaked code goes stale fast.
- **The webhook URL carries `?action_id=`**. Verify webhooks don't know about your actor naming scheme, so the action id is threaded through the query string at profile-creation time. That's how `handleVerifyWebhook()` later knows which actor to notify.

The `verifyApi()` helper is the raw-fetch wrapper used by every Verify call:

```ts
private async verifyApi(path: string, init: { method: string; body?: string }) {
  const apiKey = await this.env.SECRETS.get("TELNYX_API_KEY");
  if (!apiKey) throw new Error("TELNYX_API_KEY is not configured");
  const res = await fetch(`https://api.telnyx.com/v2${path}`, {
    method: init.method,
    body: init.body,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  });
  const retryAfter = Number(res.headers.get("retry-after") ?? "");
  /* ... */
}
```

It parses `Retry-After` on the way out, because the 429 path needs it.

---

## Step 3 — Trigger the verification

`onActionRequested()` is the "user clicked *change payout account*" moment. It runs four gates before it spends a verification:

```ts
async onActionRequested(input: { action_kind: string; phone_number: string; destination: string | null }) {
  const state = await this.getState();
  const now = Date.now();

  if (state.status === "committed") {
    return { ok: false, status: "committed", message: "This action is already committed." };
  }
  if (state.locked_until && now < Date.parse(state.locked_until)) {
    return { ok: false, status: "locked", locked_until: state.locked_until, /* ... */ };
  }
  const profileId = state.verify_profile_id ?? this.env.VERIFY_PROFILE_ID ?? null;
  if (!profileId) {
    return { ok: false, status: "no_profile", message: "No verify profile. POST /actions/:id/verify-profile first." };
  }
  /* ... */
}
```

- **Already committed?** Refuse. A committed action is terminal.
- **Locked?** Refuse, and tell the caller exactly when the lock lifts.
- **No profile?** Refuse with a pointer to the setup endpoint.
- **Otherwise** — trigger.

The trigger itself:

```ts
private async triggerVerification(phoneNumber: string, profileId: string): Promise<TriggerResult> {
  if (this.demoMode) return { ok: true, verification_id: `demo-verify-${Date.now().toString(36)}` };
  const res = await this.verifyApi("/verifications/sms", {
    method: "POST",
    body: JSON.stringify({ phone_number: phoneNumber, verify_profile_id: profileId }),
  });
  if (res.status === 429) return { ok: false, reason: "rate_limited", retry_after_secs: res.retryAfter ?? 60 };
  if (!res.ok) return { ok: false, reason: "api_error", status: res.status };
  const id = (res.data as { data?: { id?: unknown } })?.data?.id;
  if (typeof id !== "string") return { ok: false, reason: "api_error", status: 502 };
  return { ok: true, verification_id: id };
}
```

The `TriggerResult` union is deliberate: **rate limiting is not an error**, it's a distinct outcome with its own message. Back in `onActionRequested()`:

```ts
if (trigger.reason === "rate_limited") {
  const minutes = Math.max(1, Math.ceil(trigger.retry_after_secs / 60));
  return {
    ok: false,
    status: "rate_limited",
    retry_after_secs: trigger.retry_after_secs,
    message: `Verification rate limit hit. Try again in ${minutes} minute(s).`,
  };
}
```

The user sees "try again in 2 minutes," not "500 Internal Server Error."

On success, the actor persists the whole session in one `setState()`:

```ts
const expiresAt = new Date(now + VERIFICATION_TIMEOUT_SECS * 1000).toISOString();
await this.setState({
  action_kind: input.action_kind,
  phone_number: input.phone_number,
  destination: input.destination,
  verify_id: trigger.verification_id,
  verify_profile_id: profileId,
  status: "pending",
  attempts_left: MAX_ATTEMPTS,
  expires_at: expiresAt,
  locked_until: null,
});
await this.record("verification_triggered", "pending", { verify_id: trigger.verification_id, expires_at: expiresAt });
```

Note `expires_at` is computed **locally** from the trigger time plus the profile timeout. That's what lets the actor answer "expired" without making an API call — see Step 6.

---

## Step 4 — Submit the code (the accepted path)

`onCodeSubmitted(code)` is the heart of the sample. It's a cascade of guards, then a single API call, then a branch on the result.

```ts
async onCodeSubmitted(code: string) {
  const state = await this.getState();
  const now = Date.now();

  if (state.status === "committed") { /* already done — return ok */ }
  if (state.locked_until && now < Date.parse(state.locked_until)) { /* locked — return locked_until */ }
  if (!state.verify_id) { /* no_session — POST /start first */ }
  if (state.expires_at && now >= Date.parse(state.expires_at)) {
    await this.setState({ status: "expired" });
    await this.record("code_submitted", "expired", { reason: "session_expired" });
    return { ok: false, status: "expired", message: "Verification expired. POST /actions/:id/start to re-trigger." };
  }

  const check = await this.checkVerification(state.verify_id, code);
  /* ... */
}
```

The local expiry check fires **before** the network call. If the clock says the code is dead, we don't spend a request finding out.

`checkVerification()` maps HTTP reality onto four outcomes:

```ts
private async checkVerification(verifyId: string, code: string): Promise<CheckResult> {
  if (this.demoMode) return { response_code: code === DEMO_ACCEPT_CODE ? "accepted" : "rejected" };
  const res = await this.verifyApi(`/verifications/check/${encodeURIComponent(verifyId)}`, {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  if (res.status === 404) return { response_code: "not_found" };
  if (!res.ok) return { response_code: "error" };
  const responseCode = (res.data as { data?: { response_code?: unknown } })?.data?.response_code;
  return { response_code: responseCode === "accepted" ? "accepted" : "rejected" };
}
```

| Outcome | Source | Meaning |
|---|---|---|
| `accepted` | `data.response_code === "accepted"` | Correct code |
| `rejected` | `data.response_code === "rejected"` | Wrong code — **or** an expired verification |
| `not_found` | HTTP `404` | The verification id doesn't exist (session was never created) |
| `error` | any other non-2xx | Verify is unavailable — **no attempt consumed** |

That last row matters. A 500 from Verify must not burn one of the user's three tries.

The accepted branch commits the action:

```ts
if (check.response_code === "accepted") {
  const committedAt = new Date().toISOString();
  await this.setState({ status: "committed" });
  await this.record("action_committed", "accepted", { destination: state.destination, committed_at: committedAt });
  await this.notify(`Payout destination change approved at ${committedAt}.`);
  return { ok: true, status: "committed", destination: state.destination, committed_at: committedAt };
}
```

> **A note on the "commit."** The payout-destination write is **stubbed** — it's recorded as an `action_committed` row in the actor's own audit trail with `{ destination, committed_at }`. The sample demonstrates the *grant*, not a banking backend. Swap `record("action_committed", ...)` for your real write and the rest of the flow is unchanged.

`notify()` is the SMS confirmation, and it's a no-op in demo mode:

```ts
private async notify(text: string): Promise<void> {
  if (this.demoMode) return; // safe demo mode: never send a real SMS
  const from = this.env.DISPATCH_FROM_NUMBER;
  const state = await this.getState();
  if (!from || !state.phone_number) return;
  try {
    await this.env.TELNYX.messages.send({ to: state.phone_number, from, text });
  } catch {
    // notification failures must never break the verification flow
  }
}
```

The swallowed catch is intentional. A failed confirmation SMS must never roll back a committed action.

---

## Step 5 — The attempt budget and the lockout

The rejected branch is where the actor earns its keep:

```ts
const attemptsLeft = Math.max(0, state.attempts_left - 1);
await this.setState({ attempts_left: attemptsLeft });
await this.record("code_submitted", "rejected", { attempts_left: attemptsLeft });
if (attemptsLeft === 0) return this.onBudgetExhausted();
return { ok: false, status: "rejected", attempts_left: attemptsLeft, message: `${attemptsLeft} attempts remaining.` };
```

Read the state, compute the new value, write it back. Because the actor serializes method calls per instance, there is exactly one writer — no compare-and-swap, no lock file, no lost update.

When the budget hits zero:

```ts
async onBudgetExhausted() {
  const lockedUntil = new Date(Date.now() + LOCKOUT_SECONDS * 1000).toISOString();
  await this.setState({ status: "locked", locked_until: lockedUntil });
  await this.record("budget_exhausted", "locked", { locked_until: lockedUntil });
  await this.schedule(LOCKOUT_SECONDS, "liftLockout", {});
  await this.notify(`Too many incorrect codes. This action is locked until ${lockedUntil}.`);
  return { ok: false, status: "locked", locked_until: lockedUntil, attempts_left: 0, message: `Locked until ${lockedUntil}.` };
}
```

`this.schedule(600, "liftLockout", {})` is the cool-down. It's a durable timer owned by the actor — not a `setTimeout` that dies with the process. Ten minutes later, the runtime calls `liftLockout()`:

```ts
async liftLockout() {
  const state = await this.getState();
  if (state.status !== "locked") return { ok: true, status: state.status };
  await this.setState({ status: "idle", locked_until: null, attempts_left: MAX_ATTEMPTS, verify_id: null, expires_at: null });
  await this.record("lockout_lifted", "idle", { attempts_left: MAX_ATTEMPTS });
  return { ok: true, status: "idle", attempts_left: MAX_ATTEMPTS };
}
```

The guard clause (`if (state.status !== "locked")`) makes the handler idempotent — a stale timer firing after the session already committed does nothing.

While locked, **every** entry point answers with the same fact:

```ts
if (state.locked_until && now < Date.parse(state.locked_until)) {
  return { ok: false, status: "locked", locked_until: state.locked_until, attempts_left: state.attempts_left,
           message: `Locked until ${state.locked_until}.` };
}
```

That's the "locked until 14:05" demo. No silent failures, no guessable state — the user is told the exact timestamp.

---

## Step 6 — Expiry, handled cleanly

Expiry has two independent detectors, and they cover different failures.

**Detector 1 — the local clock.** Before any network call, `onCodeSubmitted()` compares `now` against `expires_at`. If the session is stale, it flips to `expired` and returns a re-trigger offer without spending a request.

**Detector 2 — the API's answer.** If the local clock says the code is still live but Verify disagrees (the code was consumed elsewhere, the profile timeout was shorter than we thought), the check comes back `rejected`. And if the verification id is gone entirely:

```ts
if (check.response_code === "not_found") {
  await this.setState({ status: "expired", verify_id: null });
  await this.record("code_submitted", "not_found", { reason: "unknown_verification_id" });
  return { ok: false, status: "expired", message: "Verification no longer exists. POST /actions/:id/start to re-trigger." };
}
```

Both paths land on the same user-facing outcome: **status `expired`, with an explicit instruction to re-trigger.** The recovery is `POST /actions/:id/start` again — which resets `attempts_left` to `MAX_ATTEMPTS`, mints a fresh `verify_id`, and sets a new `expires_at`. The audit trail keeps the old events; it never forgets that the first attempt expired.

Note that expiry is **not** an HTTP status. There's no `410 Gone` on the wire — the check response's `response_code` is the signal, and the actor translates it into a clean state.

---

## Step 7 — The audit trail

`onAuditQuery()` answers "who attempted to change the payout account at 13:41?" from the actor's own state:

```ts
async onAuditQuery() {
  const state = await this.getState();
  return {
    action_kind: state.action_kind,
    status: state.status,
    phone_number: maskPhone(state.phone_number),
    attempts_left: state.attempts_left,
    expires_at: state.expires_at,
    locked_until: state.locked_until,
    audit: state.audit,
  };
}
```

The phone number is masked on the way out — `+15551234567` becomes `+1555***4567`. Nothing that leaves the actor carries an unmasked number.

Every event in the trail, in order:

| Event | Result | When |
|---|---|---|
| `verify_profile_created` / `verify_profile_attached` | `ok` / `error` | Profile setup |
| `verification_triggered` | `pending` / `rate_limited` / `api_error` | `POST /start` |
| `code_submitted` | `rejected` / `expired` / `not_found` / `error` | `POST /submit` |
| `action_committed` | `accepted` | Correct code |
| `budget_exhausted` | `locked` | Third wrong code |
| `lockout_lifted` | `idle` | Cool-down timer fired |
| `webhook:verify.*` | `accepted` / `failed` / `ignored` | Verify webhook arrived |

Each entry carries `{ at, event, result, detail }`. The `detail` object holds the specifics — `attempts_left`, `verify_id`, `locked_until`, `destination`, `committed_at`.

Because the trail lives in actor state, it survives the same things the session survives: restarts, redeploys, and `kill -9`.

---

## Step 8 — Verify webhooks as a second signal

Verify can push `verification.complete` events to you. This sample treats them as **confirmation, never authority**.

The router entry point:

```ts
if (url.pathname === "/webhooks/verify") {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  return await handleVerifyWebhook(request, env);
}
```

Signature verification comes first, and it's real Ed25519 — not a shared-secret header:

```ts
async function verifyTelnyxSignature(env: Env, rawBody: string, headers: Headers): Promise<boolean> {
  const publicKey = await env.SECRETS.get("TELNYX_PUBLIC_KEY");
  if (!publicKey) throw new Error("TELNYX_PUBLIC_KEY is not configured");
  const signature = headers.get("telnyx-signature-ed25519");
  const timestamp = headers.get("telnyx-timestamp");
  if (!signature || !timestamp) return false;
  const key = await crypto.subtle.importKey("raw", base64ToBytes(publicKey), { name: "Ed25519" }, false, ["verify"]);
  const signed = new TextEncoder().encode(`${timestamp}|${rawBody}`);
  return crypto.subtle.verify({ name: "Ed25519" }, key, base64ToBytes(signature), signed);
}
```

The signed payload is `` `${timestamp}|${rawBody}` `` — which is why the handler reads `await request.text()` **before** parsing. Re-serializing the JSON would change the bytes and break the signature.

If the public key isn't configured, the handler returns `503` rather than silently accepting unsigned traffic:

```ts
try {
  valid = await verifyTelnyxSignature(env, raw, request.headers);
} catch {
  return json({ error: "webhook_verification_not_configured" }, 503);
}
if (!valid) return json({ error: "invalid_signature" }, 401);
```

Then the action id comes out of the query string (remember Step 2), the event is unwrapped from `data.payload`, and the actor is notified:

```ts
const actionId = new URL(request.url).searchParams.get("action_id") ?? "";
if (!isActionId(actionId)) return json({ error: "missing_action_id" }, 400);

const data = (event.data && typeof event.data === "object" ? event.data : {}) as Record<string, unknown>;
const payload = (data.payload && typeof data.payload === "object" ? data.payload : {}) as Record<string, unknown>;
const result = await stubFor(env, actionId).onVerifyWebhook({
  type: typeof data.event_type === "string" ? data.event_type : "unknown",
  verification_id: typeof payload.verification_id === "string" ? payload.verification_id : null,
  status: typeof payload.status === "string" ? payload.status : null,
  failed_attempts: typeof payload.failed_attempts === "number" ? payload.failed_attempts : null,
});
return json({ received: true, result });
```

Inside the actor, the reconciliation rule is one line:

```ts
async onVerifyWebhook(event: { /* ... */ }) {
  const state = await this.getState();
  if (event.verification_id && state.verify_id && event.verification_id !== state.verify_id) {
    await this.record(`webhook:${event.type}`, "ignored", { reason: "verification_id_mismatch" });
    return { ok: true, applied: false };
  }
  await this.record(`webhook:${event.type}`, event.status ?? "unknown", { failed_attempts: event.failed_attempts });
  return { ok: true, applied: true };
}
```

A webhook for a *different* verification id is recorded as `ignored` and changes nothing. A webhook for *this* session is appended to the audit trail as a second data point.

**Ordering.** `verification.complete` can arrive before your check response is processed. The actor never lets the webhook override the check result — the check is authoritative, the webhook is corroboration. If they disagree, the audit trail shows both and you can see the race.

The handler returns `200` immediately after the actor call. Webhook endpoints that block get retried into a storm.

---

## Step 9 — Crash resume and concurrent checks

These are the two properties that justify the whole architecture, and both are demonstrable.

### Crash resume

```bash
# 1. Trigger a verification
curl -X POST "$PUBLIC_BASE_URL/actions/action-4471/start" \
  -H 'content-type: application/json' \
  -d '{"phone_number":"+15551234567","destination":"acct_99812"}'
# → { "ok": true, "status": "pending", "attempts_left": 3, ... }

# 2. Burn one attempt
curl -X POST "$PUBLIC_BASE_URL/actions/action-4471/submit" \
  -H 'content-type: application/json' -d '{"code":"000000"}'
# → { "ok": false, "status": "rejected", "attempts_left": 2, ... }

# 3. Kill the worker
#    (redeploy, crash, scale to zero — anything that destroys the process)

# 4. Submit again
curl -X POST "$PUBLIC_BASE_URL/actions/action-4471/submit" \
  -H 'content-type: application/json' -d '{"code":"000000"}'
# → { "ok": false, "status": "rejected", "attempts_left": 1, ... }
```

`attempts_left` went `3 → 2 → 1`, not `3 → 2 → 3`. The next request re-activates the same actor via `env.OTP_GUARD.idFromName("action-4471")`, and the budget, expiry clock, and audit trail are all intact.

Without the actor, a restart resets the budget to three and a brute-forcer gets a fresh window on every deploy. That's the bug class this sample exists to make visible.

### Concurrent checks

Fire two wrong codes at the same instant:

```bash
curl -X POST "$PUBLIC_BASE_URL/actions/action-4471/submit" -H 'content-type: application/json' -d '{"code":"000000"}' &
curl -X POST "$PUBLIC_BASE_URL/actions/action-4471/submit" -H 'content-type: application/json' -d '{"code":"000000"}' &
wait
```

The budget decrements **exactly twice** — never three times, never once. The Edge runtime serializes method calls per actor instance, so `onCodeSubmitted()` is a single writer. There's no lock file, no mutex, no optimistic-concurrency retry loop. Actor-native serialization *is* the mechanism.

`smoke_test.ts` asserts this directly: it fires two concurrent submits and checks that `attempts_left` dropped by exactly two.

---

## Demo mode vs live mode

This is the switch you'll flip most often.

| | **Demo mode** (default) | **Live mode** |
|---|---|---|
| `DEMO_MODE` | `true` (or unset) | `false` |
| Verify profile | `demo-profile-otp-guard` (constant) | Created via `POST /v2/verify_profiles`, or `VERIFY_PROFILE_ID` |
| Trigger | Returns `demo-verify-<ts>` | `POST /v2/verifications/sms` — **real SMS, real charge** |
| Check | `code === "123456"` → `accepted`, else `rejected` | `POST /v2/verifications/check/{id}` |
| SMS notifications | Skipped entirely | `this.env.TELNYX.messages.send(...)` |
| Credentials needed | None | `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY` |

**Demo mode is the default because it's safe.** No real SMS, no real verifications burned, no charges. The accepted / rejected / expiry / lockout flows all run end to end against inline stubs.

To go live:

```bash
telnyx-edge secrets add TELNYX_API_KEY "KEY_your_key_here"
telnyx-edge secrets add TELNYX_PUBLIC_KEY "your_public_key"
```

```toml
[env_vars]
DEMO_MODE = "false"
DEMO_PHONE = "+1555XXXXXXXX"
DISPATCH_FROM_NUMBER = "+1555XXXXXXXX"
PUBLIC_BASE_URL = "https://otp-guard.example.workers.dev"
```

```bash
telnyx-edge ship
```

In live mode, the code that arrives by SMS is whatever Verify generated — `123456` is only the demo accept code.

---

## Running the demo

### Smoke test

```bash
npx tsx smoke_test.ts
```

This imports `src/index.ts`, verifies the module loads, and exercises the actor's state machine — including the concurrent-submit assertion. It runs entirely in demo mode and needs no credentials.

### The full flow

```bash
export PUBLIC_BASE_URL="https://otp-guard.example.workers.dev"
export ACTION="action-4471"
```

**1. Create the step-up profile (one-time).**

```bash
curl -X POST "$PUBLIC_BASE_URL/actions/$ACTION/verify-profile"
# → { "ok": true, "created": true, "verify_profile_id": "demo-profile-otp-guard" }
```

**2. The user clicks "change payout account" — trigger the verification.**

```bash
curl -X POST "$PUBLIC_BASE_URL/actions/$ACTION/start" \
  -H 'content-type: application/json' \
  -d '{"phone_number":"+15551234567","action_kind":"payout_destination_change","destination":"acct_99812"}'
# → { "ok": true, "status": "pending", "verify_id": "demo-verify-...", "expires_at": "...", "attempts_left": 3 }
```

**3. Enter the correct code — the action commits.**

```bash
curl -X POST "$PUBLIC_BASE_URL/actions/$ACTION/submit" \
  -H 'content-type: application/json' -d '{"code":"123456"}'
# → { "ok": true, "status": "committed", "destination": "acct_99812", "committed_at": "..." }
```

**4. Wrong code — the budget decrements.**

```bash
curl -X POST "$PUBLIC_BASE_URL/actions/$ACTION/submit" \
  -H 'content-type: application/json' -d '{"code":"000000"}'
# → { "ok": false, "status": "rejected", "attempts_left": 2, "message": "2 attempts remaining." }
```

**5. Third wrong code — lockout.**

```bash
curl -X POST "$PUBLIC_BASE_URL/actions/$ACTION/submit" \
  -H 'content-type: application/json' -d '{"code":"000000"}'
# → { "ok": false, "status": "locked", "locked_until": "2026-07-28T14:05:00.000Z", "attempts_left": 0 }
```

Any retry before `locked_until` returns the same `locked` payload with the same timestamp.

**6. Audit query — who tried what, and when.**

```bash
curl "$PUBLIC_BASE_URL/actions/$ACTION/audit"
```

```json
{
  "action_kind": "payout_destination_change",
  "status": "locked",
  "phone_number": "+1555***4567",
  "attempts_left": 0,
  "expires_at": "2026-07-28T13:46:00.000Z",
  "locked_until": "2026-07-28T14:05:00.000Z",
  "audit": [
    { "at": "2026-07-28T13:41:00.000Z", "event": "verify_profile_created", "result": "ok", "detail": { "code_length": 6, "timeout_secs": 300 } },
    { "at": "2026-07-28T13:41:02.000Z", "event": "verification_triggered", "result": "pending", "detail": { "verify_id": "demo-verify-...", "expires_at": "..." } },
    { "at": "2026-07-28T13:41:30.000Z", "event": "code_submitted", "result": "rejected", "detail": { "attempts_left": 2 } },
    { "at": "2026-07-28T13:41:44.000Z", "event": "code_submitted", "result": "rejected", "detail": { "attempts_left": 1 } },
    { "at": "2026-07-28T13:41:58.000Z", "event": "code_submitted", "result": "rejected", "detail": { "attempts_left": 0 } },
    { "at": "2026-07-28T13:41:58.000Z", "event": "budget_exhausted", "result": "locked", "detail": { "locked_until": "2026-07-28T14:05:00.000Z" } }
  ]
}
```

**7. Expiry.** Start a fresh session and wait past `expires_at` (300 seconds in demo mode you can shorten `VERIFICATION_TIMEOUT_SECS` locally to test faster):

```bash
curl -X POST "$PUBLIC_BASE_URL/actions/$ACTION/submit" \
  -H 'content-type: application/json' -d '{"code":"123456"}'
# → { "ok": false, "status": "expired", "message": "Verification expired. POST /actions/:id/start to re-trigger." }
```

Then `POST /actions/$ACTION/start` again for a clean re-trigger.

### HTTP surface reference

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/actions/:id/verify-profile` | Create or attach the step-up verify profile (idempotent) |
| `POST` | `/actions/:id/start` | Trigger the verification; persists `verify_id` and `expires_at` |
| `POST` | `/actions/:id/submit` | Submit a code; branches accepted / rejected / expired / locked |
| `GET` | `/actions/:id/audit` | Full session snapshot + append-only audit trail |
| `POST` | `/webhooks/verify?action_id=:id` | Verify webhook receiver (Ed25519 verified) |

`:id` must match `^[A-Za-z0-9_-]{1,64}$`. Phone numbers must be E.164. Codes must be 4–8 digits. Every route validates before it touches an actor.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `{"error":"webhook_verification_not_configured"}` (503) | `TELNYX_PUBLIC_KEY` secret missing | `telnyx-edge secrets add TELNYX_PUBLIC_KEY "..."` |
| `{"error":"invalid_signature"}` (401) | Wrong public key, or the body was re-serialized before verification | Use the raw `request.text()` bytes; confirm the key in the portal |
| `{"error":"missing_action_id"}` (400) on the webhook | Profile was created without `PUBLIC_BASE_URL` | Set `PUBLIC_BASE_URL` and re-create the profile, or pass `?action_id=` manually |
| `{"status":"no_profile"}` on `/start` | Profile step skipped | `POST /actions/:id/verify-profile` first |
| `{"status":"rate_limited"}` | Verify per-number or per-profile rate limit | Wait `retry_after_secs`; the message already says how long |
| `{"status":"api_error"}` on submit | Verify unreachable | **No attempt was consumed** — retry |
| `{"status":"expired"}` immediately after `/start` | `expires_at` already passed | Re-trigger with `/start` |
| Budget resets to 3 after every deploy | You're not hitting the same actor | Confirm the action id is identical — `idFromName()` is the identity |
| `TELNYX_API_KEY is not configured` | Secret not set, or you're in live mode without it | `telnyx-edge secrets add TELNYX_API_KEY "..."` |
| `telnyx-env.d.ts` type errors on `env.OTP_GUARD` | Types not generated | `telnyx-edge types` |

---

## Next steps

You've got a durable step-up session. Here's where to go from here:

**Deepen the Verify integration**
- [Verify quickstart](https://developers.telnyx.com/docs/identity/verify/quickstart) — the full product tour
- [Trigger SMS verification](https://developers.telnyx.com/api-reference/verify/trigger-sms-verification) — the endpoint behind `triggerVerification()`
- [Verify code by id](https://developers.telnyx.com/api-reference/verify/verify-verification-code-by-id) — the endpoint behind `checkVerification()`
- [Create a verify profile](https://developers.telnyx.com/api-reference/verify/create-a-verify-profile) — tune `code_length`, timeout, and per-channel config
- [Receiving webhooks](https://developers.telnyx.com/docs/identity/verify/receiving-webhooks) — event shapes and signature verification

**Extend the sample**
- **Swap the stub for a real write.** Replace the `record("action_committed", ...)` call in `onCodeSubmitted()` with your actual payout-destination update. Everything else stays.
- **Add a second action kind.** `action_kind` is already a state field — spin up `OtpGuard("password-reset-8891")` with a different profile and the same machinery applies.
- **Persist the audit trail to SQL.** The actor's `audit[]` array is fine for a session; for cross-session reporting, add a `[storage.sqldb.AUDIT_DB]` binding and write each `record()` call through to a table.
- **Add a `this.every()` sweeper.** A periodic task that marks stale `pending` sessions as `expired` keeps the audit trail honest even for sessions nobody returns to.
- **Tune the profile per action kind.** A wire transfer probably wants a longer timeout than a phone-number swap. Create one profile per risk tier.

**Related samples in this repo**
- `sms-two-factor-auth-nodejs` — hand-rolled OTP over raw SMS (the thing this sample replaces)
- `sms-two-factor-agent` — 2FA driven by an agent
- `two-channel-otp` — the channel-fallback flagship; this sample is the step-up *policy* flagship

---

*Fingerprint: `cs23:sonam:otp-guard`*
