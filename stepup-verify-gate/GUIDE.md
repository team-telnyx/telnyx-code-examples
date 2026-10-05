# Step-Up Verify Gate — SIM-Swap Fraud Protection Guide

A hands-on walkthrough of the `stepup-verify-gate` sample: a durable Telnyx Edge actor that gates every login with **Number Lookup** and escalates to **flash-call or voice-call verification** when a SIM-swap is detected.

---

## Prerequisites

- A Telnyx account with a [Verify profile](https://developers.telnyx.com/docs/identity/verify) and [Number Lookup](https://developers.telnyx.com/docs/identity/number-lookup) enabled.
- Node.js 18+ and the [Telnyx Edge CLI](https://developers.telnyx.com/docs/edge-compute/getting-started):
  ```bash
  npm install -g @telnyx/edge-cli
  telnyx-edge auth api-key set <your-telnyx-api-key>
  ```
- The `@telnyx/edge-runtime` package (v0.15.1) — declared in `package.json`.

---

## Environment Setup

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Edit `.env` and fill in your values:

| Variable | Description | Example |
|---|---|---|
| `TELNYX_API_KEY` | Your Telnyx API key (used for raw API calls in live mode) | `KEY_...` |
| `VERIFY_PROFILE_ID` | The Verify profile resource ID | `12345678-...` |
| `TELNYX_WEBHOOK_PUBLIC_KEY` | Ed25519 public key for webhook signature verification | `base64-encoded-key` |
| `DEMO_MODE` | Set to `true` to run in safe demo mode (no real charges) | `true` |

> **Demo mode is the default.** The actor logs all actions instead of making real API calls. See [Switching to Live Mode](#switching-to-live-mode) below.

---

## Project Structure

```
stepup-verify-gate/
├── src/
│   └── index.ts          # Main entry — VerifyGate actor + fetch handler
├── package.json
├── tsconfig.json
├── telnyx.toml           # Edge bindings config
├── .env.example
├── .gitignore
└── smoke_test.ts         # Verifies the module loads without error
```

---

## How It Works — Step by Step

### 1. The Actor: `VerifyGate`

The entire fraud gate is a **durable actor** — one instance per phone number, identified by `env.GATES.idFromName(userE164)`. This means the actor's state (carrier baseline, step-up history, lock status) **survives restarts**. A stateless function would re-trust a ported number on every login; the actor remembers the port.

```typescript
export class VerifyGate extends Agent<Env, VerifyGateState> {
  protected initialState(): VerifyGateState {
    return {
      carrierBaseline: null,
      stepups: [],
      locked: false,
      lockedUntil: null,
    };
  }
}
```

The `Env` interface declares the bindings the actor needs:

```typescript
export interface Env {
  SECRETS: { get(name: string): Promise<string | null> };
  GATES: { idFromName(name: string): AgentStub<VerifyGate> };
  TELNYX: TelnyxBinding;
  LEDGER: SqlDatabase;
}
```

- **`SECRETS`** — holds `TELNYX_API_KEY`, `VERIFY_PROFILE_ID`, `TELNYX_WEBHOOK_PUBLIC_KEY`, `DEMO_MODE`.
- **`GATES`** — the actor namespace; `idFromName(userE164)` creates or retrieves the per-number actor.
- **`TELNYX`** — the zero-credential Telnyx API binding (available in live mode).
- **`LEDGER`** — a SQL database for the fraud ledger (`carrier_history` + `stepups` tables).

### 2. The Challenge RPC

The entry point is the `@rpc challenge(userE164)` method. When a user logs in, the portal app calls this RPC, which:

1. **Checks the lock** — if the number is locked for manual review, login is refused.
2. **Runs Number Lookup** — `GET /v2/number_lookup/{phone}` to get the current `line_type`, `spid_carrier_name`, and `spid_carrier_type`.
3. **Records the carrier snapshot** in the `carrier_history` SQL table.
4. **Loads the baseline** from the SQL ledger (not in-memory state — this is the restart-proof part).
5. **Detects SIM-swap** — compares the current snapshot against the baseline.
6. **Routes accordingly** — clean path → SMS verify; step-up path → flash-call or voice-call verify.

```typescript
async challenge(userE164: string): Promise<ChallengeResult> {
  // ... lock check ...
  const lookup = await this.runNumberLookup(userE164);
  await this.recordCarrierHistory(userE164, lookup);
  const baseline = await this.loadBaseline(userE164);
  const needsStepUp = this.detectSimSwap(lookup, baseline);
  // ... route to SMS or step-up ...
}
```

### 3. Number Lookup — The Evidence

Every challenge starts with a **Number Lookup** call. This is the per-request evidence that tells us who currently holds the number:

```typescript
private async runNumberLookup(userE164: string): Promise<CarrierSnapshot | null> {
  const resp = await fetch(
    `https://api.telnyx.com/v2/number_lookup/${encodeURIComponent(userE164)}`,
    { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } }
  );
  const data: LookupResponse = await resp.json();
  return {
    line_type: data.data.line_type,
    spid_carrier_name: data.data.spid_carrier_name,
    spid_carrier_type: data.data.spid_carrier_type,
    at: Date.now(),
  };
}
```

Key fields from the lookup response:
- **`line_type`** — `mobile`, `voip`, or `landline`. A flip from `mobile` to `voip`/`landline` triggers step-up.
- **`spid_carrier_name`** — the carrier identity. A change from the baseline carrier triggers step-up.
- **`spid_carrier_type`** — `wireless`, `landline`, `voip`, etc.

In demo mode, the lookup is simulated by reading from a `demo_carrier` table that an external simulator toggles between "clean" and "ported" states.

### 4. The SQL Fraud Ledger

The ledger is the durable memory. Two tables:

**`carrier_history`** — every lookup is recorded:
```sql
INSERT INTO carrier_history (number, at, spid, line_type, carrier_name, carrier_type)
VALUES (?, ?, ?, ?, ?, ?)
```

**`stepups`** — every step-up event is recorded:
```sql
INSERT INTO stepups (number, reason, at, resolved)
VALUES (?, ?, ?, ?)
```

The baseline is loaded from the **first** row in `carrier_history` for a given number:
```sql
SELECT spid, line_type, carrier_name, carrier_type, at
FROM carrier_history
WHERE number = ?
ORDER BY at ASC
LIMIT 1
```

This is the key to restart-proofing: the baseline is read from SQL, not from in-memory actor state. If the actor is killed between lookup and verify, it restarts, re-runs the lookup, and compares against the **same** baseline — no double step-up, no lock drift.

### 5. Clean Path — SMS Verification

When the number is clean (mobile, unchanged carrier), the actor issues an SMS verification:

```typescript
private async triggerSmsVerify(userE164: string): Promise<SmsResult> {
  const resp = await fetch("https://api.telnyx.com/v2/verifications/sms", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      phone_number: userE164,
      verify_profile_id: profileId,
      timeout_secs: 300,
    }),
  });
  const data: VerifyResponse = await resp.json();
  return { ok: true, verification_id: data.data.verification_id };
}
```

The user receives an SMS code, submits it, and the `verifyCode` RPC checks it:

```typescript
async verifyCode(userE164: string, code: string): Promise<VerifyResult> {
  const resp = await fetch(
    `https://api.telnyx.com/v2/verifications/by_phone_number/${encodeURIComponent(userE164)}/actions/verify`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ code, verify_profile_id: profileId }),
    }
  );
  const data: VerifyResponse = await resp.json();
  if (data.data.response_code === "accepted") {
    await this.resolveStepup(userE164);
    return { ok: true, response_code: "accepted" };
  }
  return { ok: false, response_code: data.data.response_code };
}
```

### 6. Step-Up Path — Flash-Call or Voice-Call

When a SIM-swap is detected (carrier changed or `line_type` flipped to non-mobile), the actor **refuses SMS** and issues a step-up verification instead. The method is controlled by the `STEPUP_METHOD` env var (default: `flashcall`):

```typescript
private async triggerStepUp(userE164: string): Promise<StepupTriggerResult> {
  const method = this.stepupMethod(); // "flashcall" or "call"
  const endpoint = method === "call"
    ? "/v2/verifications/call"
    : "/v2/verifications/flashcall";
  const resp = await fetch(`https://api.telnyx.com${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      phone_number: userE164,
      verify_profile_id: profileId,
    }),
  });
  const data: VerifyResponse = await resp.json();
  return { ok: true, method, verification_id: data.data.verification_id, reason: "carrier_change" };
}
```

- **Flash-call** (`POST /v2/verifications/flashcall`): The code is embedded in the caller ID. The user reads the code from their incoming call screen.
- **Voice-call** (`POST /v2/verifications/call`): The actor calls the number and an automated voice reads the code aloud.

After a successful step-up verification, a row is written to the `stepups` table with `reason: "carrier_change"` and `resolved: true`.

### 7. Repeat-Offender Lock

If a number triggers **3 step-ups within 30 days** (`STEPUP_WINDOW_DAYS`), the actor locks the number for **24 hours** (`LOCK_HOURS`):

```typescript
const recentStepups = await this.countRecentStepups(userE164);
if (recentStepups >= this.lockThreshold()) {
  const lockedUntil = now + lockHours * 3600 * 1000;
  await this.setState({ locked: true, lockedUntil });
  await this.schedule(lockHours * 3600, "unlockExpired", { userE164 });
  return { ok: false, error: "Number locked for manual review", locked: true };
}
```

The lock is stored in durable actor state **and** enforced on every challenge. The `this.schedule()` call sets a self-wake alarm that fires after 24 hours to automatically unlock:

```typescript
async unlockExpired(payload: { userE164: string }): Promise<void> {
  await this.setState({ locked: false, lockedUntil: null });
}
```

### 8. Webhook Handler — Delivery Receipts

The actor also handles Verify webhooks (`verify.sent`, `verify.failed`, `verify.delivered`). These are routed to the actor via the `/webhook/verify` endpoint:

```typescript
if (path === "/webhook/verify") {
  const userE164 = url.searchParams.get("phone");
  const stub = env.GATES.idFromName(userE164);
  return stub.fetch(req);
}
```

Inside the actor, the webhook is verified using Ed25519 signature verification:

```typescript
async handleWebhook(req: Request): Promise<Response> {
  const payload = await req.text();
  const signature = req.headers.get("Telnyx-Signature");
  const publicKey = await this.getWebhookPublicKey();
  const event = await this.unwrapWebhook(payload, signature, publicKey);
  // ... record delivery receipt ...
}
```

The `unwrapWebhook` method uses the Web Crypto API to verify the Ed25519 signature, then parses the payload to extract `status`, `failed_attempts`, `type`, and `delivery_status`.

### 9. Fetch Handler — Routing

The main `fetch` handler routes incoming HTTP requests to the appropriate actor or webhook endpoint:

```typescript
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/webhook/verify") { /* route to actor */ }
    if (path === "/challenge") { /* create/activate actor, call challenge RPC */ }
    if (path === "/verify") { /* create/activate actor, call verifyCode RPC */ }
    return new Response("Not found", { status: 404 });
  }
};
```

Each endpoint extracts the `phone` query parameter, gets the actor stub via `env.GATES.idFromName(userE164)`, and forwards the request.

---

## Switching to Live Mode

By default, the actor runs in **demo mode** (`DEMO_MODE=true`). In demo mode:

- Number Lookup returns a simulated carrier snapshot from the `demo_carrier` table.
- SMS and step-up verifications are logged but not actually sent.
- No real charges are incurred.

To switch to **live mode**, set `DEMO_MODE=false` in your `.env` file:

```bash
DEMO_MODE=false
```

In live mode, the actor makes real API calls to Telnyx:
- Real Number Lookup via `GET /v2/number_lookup/{phone}`.
- Real SMS/Flash-call/Voice-call verification via the Verify API.
- Real webhook signature verification.

> **Important:** In live mode, you will be charged for Number Lookup queries and verification attempts. Ensure your Telnyx account has sufficient balance.

---

## Running the Sample

### Install dependencies

```bash
npm install
```

### Run the smoke test

```bash
npx tsx smoke_test.ts
```

This verifies that the `VerifyGate` class, its methods, and the module all load without error.

### Deploy to Telnyx Edge

```bash
telnyx-edge ship
```

This deploys the actor to Telnyx Edge. After deployment, the actor is accessible at the URL provided by the CLI.

### Simulating a SIM-Swap

In demo mode, you can toggle a number's carrier profile between "clean" and "ported" by updating the `demo_carrier` table:

```sql
-- Set to "ported" (carrier changed)
INSERT OR REPLACE INTO demo_carrier (number, carrier_name, line_type, carrier_type)
VALUES ('+15551234567', 'AT&T', 'mobile', 'wireless');

-- Set to "clean" (original carrier)
INSERT OR REPLACE INTO demo_carrier (number, carrier_name, line_type, carrier_type)
VALUES ('+15551234567', 'Verizon', 'mobile', 'wireless');

-- Set to VoIP (line_type flip)
INSERT OR REPLACE INTO demo_carrier (number, carrier_name, line_type, carrier_type)
VALUES ('+15551234567', 'Vonage', 'voip', 'voip');
```

---

## Restart Proof

The actor is designed to survive restarts. Here's how:

1. The **baseline carrier** is read from the SQL `carrier_history` table, not from in-memory state.
2. If the actor is killed between the Number Lookup and the verification, it restarts and re-runs the lookup.
3. The new lookup is compared against the **same** baseline from the ledger.
4. No double step-up occurs, and no lock drift happens.

This is the critical difference from a stateless function: the actor remembers the port.

---

## Next Steps

- [Telnyx Number Lookup docs](https://developers.telnyx.com/docs/identity/number-lookup) — learn about all the carrier intelligence fields available.
- [Telnyx Verify API docs](https://developers.telnyx.com/api-reference/verify/trigger-sms-verification) — explore SMS, flash-call, voice-call, and WhatsApp verification.
- [Telnyx Verify webhooks](https://developers.telnyx.com/docs/identity/verify/receiving-webhooks) — set up your webhook endpoint to receive delivery receipts.
- [Stateful Actors on Telnyx Edge](https://developers.telnyx.com/docs/edge-compute/stateful-actors) — learn about durable actors, scheduling, and SQL storage.
- [Agent SDK SQL](https://developers.telnyx.com/docs/agent-sdk/sql) — reference for SQL storage in actors.
- [Edge CLI reference](https://developers.telnyx.com/docs/edge-compute/cli) — `telnyx-edge ship`, `telnyx-edge types`, `telnyx-edge secrets add`.
