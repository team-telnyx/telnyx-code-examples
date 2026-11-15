# The Identity Desk — a longitudinal identity ledger for every phone number

A walkthrough of the `identity-desk` sample: one durable `IdentityDesk` actor per phone number that runs a multi-type Telnyx Number Lookup on intake, files an append-only snapshot in agent SQL, and diffs each new snapshot against the last so the front desk sees carrier, portability, and name changes the moment a returning patient calls back.

---

## 1. What you are building

Most demos treat Number Lookup as a one-shot enrichment: call the API, print the carrier, forget it. That works for a single call. It falls apart at a front desk, where the same patient calls back three days later — possibly on a ported number, possibly on a new carrier — and the receptionist has no idea the record changed.

This sample makes the lookup **longitudinal**. The unit of state is not the call and not the lookup response. It is a durable entity representing *one person's phone number* — every answer Telnyx has ever given about it, stitched over time.

The demo moment: a returning patient's number now ports to a different carrier, and the receptionist sees the delta on screen before saying a word.

Three things make that possible:

| Piece | What it does |
| --- | --- |
| `IdentityDesk` actor | One instance per E.164 number, addressed by `env.IDENTITY.idFromName(digitsOfE164(e164))`. Owns the snapshot history and the current verdict across bookings, days, and pod restarts. |
| Telnyx Number Lookup | `GET /v2/number_lookup/{phone_number}` with `type=carrier` **and** `type=enhanced-caller-name` in a single request — carrier, line type, portability, and caller name in one round trip. |
| agent SQL (`identity_snapshot`) | Append-only table with a unique dedupe index. The ledger and the delta view are derived from it, not stored separately. |

There are **no webhooks** in this sample. The trigger path is the clinic's booking app calling `POST /intake`.

---

## 2. Prerequisites

- Node.js 20 or newer
- The `telnyx-edge` CLI (`npm install -g telnyx-edge`, or use `npx telnyx-edge`)
- A Telnyx account with a Number Lookup–capable API key
- No Telnyx phone number is required — Number Lookup is a read-only data API

You do **not** need an API key to run the demo. Demo mode is the default and returns deterministic fixtures.

---

## 3. Project layout

```
identity-desk/
├── src/index.ts        # the whole sample: actor, lookup, SQL, HTTP routes, demo script
├── telnyx.toml         # actor binding, SQL binding, secret declaration
├── package.json        # @telnyx/edge-runtime, deploy + types scripts
├── tsconfig.json       # ES2022, strict, src/**/*.ts
├── smoke_test.ts       # imports the module and exercises the demo flow
├── .env.example        # placeholder env vars only
├── README.md
├── API.md
└── GUIDE.md            # this file
```

Everything of substance lives in `src/index.ts`. The sections below walk it feature by feature.

---

## 4. Bindings and environment

### `telnyx.toml`

Three bindings matter:

```toml
name = "identity-desk"
main = "src/index.ts"
compatibility_date = "2026-07-28"

[[actors]]
binding = "IDENTITY"        # env.IDENTITY — the actor namespace
type    = "IdentityDesk"    # the class exported from src/index.ts

[storage.sqldb.IDENTITY_DB] # env.IDENTITY_DB — the snapshot table
id = "<sqldb-namespace-uuid>"

[[secrets]]
binding = "TELNYX_API_KEY"
name    = "TELNYX_API_KEY"
```

`IDENTITY` is an `ActorNamespace`: you never construct an `IdentityDesk` directly, you ask the platform for the one that owns a given name. `IDENTITY_DB` is a `SqlDatabase` binding the actor owns end to end — it creates the schema and runs every query itself.

### `interface Env`

The `Env` interface near the top of `src/index.ts` mirrors those bindings and adds two optional knobs:

| Variable | Default | Meaning |
| --- | --- | --- |
| `TELNYX_API_KEY` | — | Secret. Required only when `DEMO_MODE=false`. |
| `DEMO_MODE` | `true` | Anything other than the literal string `"false"` keeps the sample in demo mode. |
| `TELNYX_API_BASE` | `https://api.telnyx.com` | Override for testing against a mock or a regional base URL. |

`.env.example` ships placeholders only:

```
TELNYX_API_KEY=your_telnyx_api_key_here
DEMO_MODE=true
```

### Setting the secret

```bash
telnyx-edge auth api-key set <YOUR_API_KEY>
telnyx-edge secrets add TELNYX_API_KEY "<YOUR_API_KEY>"
```

The actor reads it at call time via `await this.env.SECRETS.get("TELNYX_API_KEY")` — never from a literal in the source.

---

## 5. The actor lifecycle, step by step

### 5.1 Birth: intake capture, not an HTTP route

The acceptance criterion is explicit: the actor is born on the first intake capture, addressed by the digits of the E.164 number.

```ts
function deskFor(env: Env, e164: string): IdentityDeskRpc {
  const id = env.IDENTITY.idFromName(digitsOfE164(e164));
  return env.IDENTITY.get(id) as unknown as IdentityDeskRpc;
}
```

`digitsOfE164("+15550101999")` → `"15550101999"`. That string is the actor's durable name. Two bookings for the same number, days apart, resolve to the *same* actor instance — no context reconstruction, no cache warm-up. A booking for a different number resolves to a different actor with its own ledger.

`deskFor` is the only place an actor is looked up. Both HTTP routes and the demo script go through it.

### 5.2 Normalizing input

`normalizeE164` accepts anything string-shaped, strips non-digits, rejects lengths outside 10–15 and leading zeros, and returns `+<digits>`. `normalizeTimestamp` accepts an ISO string or falls back to now. Both are pure functions, exported so the smoke test can exercise them without a runtime.

### 5.3 Schema creation

`ensureSchema()` runs on every entry point, before any read or write:

```sql
CREATE TABLE IF NOT EXISTS identity_snapshot (
  phone_e164 TEXT NOT NULL,
  looked_up_at TIMESTAMPTZ NOT NULL,
  source_type TEXT NOT NULL,
  carrier_name TEXT,
  line_type TEXT,
  ported_status TEXT,
  caller_name TEXT,
  entity_type TEXT,
  confidence_score INT
);

CREATE UNIQUE INDEX IF NOT EXISTS identity_snapshot_dedupe
  ON identity_snapshot (phone_e164, looked_up_at, source_type);
```

That is the exact schema from the spec, column for column. The unique index is the second line of defense against duplicate rows; the first is the explicit `snapshotExists` check below.

### 5.4 Dedupe before lookup

`onIntakeCaptured` checks `snapshotExists(e164, lookedUpAt, sourceType)` first. If a row already exists for that `(phone, timestamp, source_type)` triple, the method returns `status: "duplicate"` with the current ledger and **does not call the lookup API at all**. Redelivery of the same intake event is therefore free — no charge, no duplicate row, no state churn.

### 5.5 The lookup itself

`runLookup(e164, priorCount)` is the only place the Telnyx API is touched. In live mode:

```ts
const query = LOOKUP_TYPES.map((type) => `type=${encodeURIComponent(type)}`).join("&");
const response = await fetch(
  `${base}/v2/number_lookup/${encodeURIComponent(e164)}?${query}`,
  { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } },
);
```

`LOOKUP_TYPES` is `["carrier", "enhanced-caller-name"]`, so the request is:

```
GET /v2/number_lookup/15550101999?type=carrier&type=enhanced-caller-name
```

Both types are populated in the **same response** — one round trip, one billable lookup, one snapshot. The response envelope is `{ data: NumberLookupRecord }`; the code unwraps `body.data` before mapping.

> The sample calls Number Lookup over raw REST rather than through the `TELNYX` binding, because the zero-credential binding exposes messaging and AI, not lookup. The API key comes from `SECRETS`.

### 5.6 Mapping the response

`normalizeLookup` flattens a `NumberLookupRecord` onto the ledger columns:

| Ledger column | Source field | Fallback |
| --- | --- | --- |
| `carrier_name` | `carrier.name` | `portability.normalized_carrier` |
| `line_type` | `carrier.type` | `portability.line_type` |
| `ported_status` | `portability.ported_status` | `null` |
| `caller_name` | `enhanced_caller_name.caller_name` | `caller_identity.caller_name` |
| `entity_type` | `enhanced_caller_name.entity_type` | `null` |
| `confidence_score` | `caller_identity.confidence_score` | `80` if a name exists, else `0` |

The fallbacks matter in practice: a ported number often reports the *normalized* carrier rather than the original one, and CNAM data can arrive under either the enhanced-caller-name block or the caller-identity block depending on what Telnyx has on file.

### 5.7 Confidence semantics

`caller_identity.confidence_score` runs on a **50–90 scale**:

| Score | Meaning |
| --- | --- |
| 70–90 | High confidence — the name is safe to greet by |
| 60–69 | Moderate — usable, but worth confirming at the desk |
| 50–59 | Limited — treat as a hint, not a fact |
| below 50 | No name is returned at all |

The ledger's `verified` flag is `confidence_score >= 70`. A VoIP number with no name on file lands at `0` and is never `verified`.

### 5.8 Filing the snapshot

`fileSnapshot` is a single parameterized `INSERT` with nine `?` placeholders — no string interpolation, no credentials, no full phone numbers in logs. The row is append-only; nothing is ever updated in place.

### 5.9 Delta detection

`onDelta(prev, next)` compares the new record against the previous snapshot and returns a list of flags:

| Flag | Trigger |
| --- | --- |
| `carrier_changed` | `carrier_name` differs |
| `name_changed` | `caller_name` differs |
| `portability_changed` | `ported_status` differs |
| `line_type_changed` | `line_type` differs |
| `voip_low_trust` | The new line type is `voip` |

On the very first snapshot there is no `prev`, so the only possible flag is `voip_low_trust`. That is deliberate: a first-ever VoIP capture should be flagged for the front desk immediately, but there is nothing to diff against.

### 5.10 Agent state

`recordState` writes the current verdict into the actor's Agent state via `setState`:

```ts
{
  phoneNumber, lastConfidence, entity_type, carrierName,
  lineType, snapshotCount, flags
}
```

`setState` uses merge-patch semantics, so only the listed keys change. `flags` is unioned with the existing set (`Array.from(new Set([...state.flags, ...flags]))`) so a flag raised on visit two is still visible on visit five — the state is a running record of everything that has ever been worth telling the desk, not just the last diff.

State is the fast read. SQL is the source of truth. If they ever disagree, SQL wins, because the ledger is always rebuilt from `snapshots()`.

### 5.11 The staff surface

```ts
@rpc()
async identity(e164Input: string): Promise<Ledger> { ... }
```

`@rpc()` exposes the method over the Agent SDK's RPC surface, so a staff UI (or `agent.stub.identity(...)`) can call it directly without going through an HTTP route. The method normalizes the number, ensures the schema, logs the discovered surface via `rpcSurface(this)`, and returns the merged ledger.

The `Ledger` shape:

```ts
{
  phone_e164, snapshot_count, verified, low_trust,
  latest,      // the most recent SnapshotRow
  deltas,      // [{ from, to, changes: string[] }, ...]
  snapshots    // every row, ascending by looked_up_at
}
```

`deltas` is computed by walking consecutive snapshot pairs and re-running `onDelta`. That means the delta view is *derived*, never stored — add a snapshot and the whole history re-diffs correctly, including after a restart.

---

## 6. HTTP routes

The default export's `fetch` handler exposes three routes. All errors are caught, logged server-side, and returned as a generic `{"error": "internal error"}` with status 500 — no exception text leaks to the client.

### `POST /intake`

```json
{ "phoneE164": "+15550101999", "capturedAt": "2025-06-02T09:00:05Z" }
```

Validates the number, resolves the actor, calls `onIntakeCaptured`, returns the `IntakeResult` (`status`, `phone_e164`, `looked_up_at`, `flags`, `ledger`). A malformed number returns 400.

`capturedAt` is optional but **important**: it is the dedupe key. Two intake events with the same number and the same `capturedAt` are the same event, and the second one is a no-op.

### `GET /identity/:e164`

Returns the merged ledger for one number. This is the screen the receptionist looks at.

### `POST /demo/run`

Runs the scripted demo end to end and returns every intermediate result. See the next section.

---

## 7. The scripted demo

`runDemo(env)` is the acceptance-criteria checklist in executable form. It drives two numbers through the actor and returns the whole transcript.

| Step | Call | What it proves |
| --- | --- | --- |
| 1 | `onIntakeCaptured(+15550101999, 2025-06-02T09:00:05Z)` | Actor born, first lookup, snapshot v1 filed |
| 2 | `onIntakeCaptured(+15550101999, 2025-06-04T10:00:05Z)` | Same actor, second lookup, snapshot v2 filed, delta flagged |
| 3 | `onIntakeCaptured(+15550101999, 2025-06-04T10:00:05Z)` | Redelivery → `status: "duplicate"`, no new row |
| 4 | `onIntakeCaptured(+15550101998, 2025-06-05T11:00:00Z)` | Different actor, VoIP line type, `voip_low_trust` |
| 5 | `identity(+15550101999)` | Merged ledger with `deltas` and `snapshot_count: 2` |

### Demo fixtures

`demoLookup(e164, priorCount)` is deterministic and keyed off the last digit of the number:

- **Last digit even** → VoIP: `Bandwidth.com`, `line_type: "voip"`, `ported_status: "N"`, no caller name, confidence `0`.
- **Last digit odd, first lookup** (`priorCount === 0`) → `Verizon Wireless`, `line_type: "mobile"`, `ported_status: "N"`, `Martha Reyes`, `entity_type: "person"`, confidence `80`.
- **Last digit odd, subsequent lookup** → `Google Fi`, `line_type: "mobile"`, `ported_status: "Y"`, `Martha Reyes`, confidence `80`.

So `+15550101999` (ends in 9) produces the v1 → v2 portability delta, and `+15550101998` (ends in 8) produces the VoIP low-trust case. No API key, no charges, no network.

### Reading the output

After step 2, the ledger for `+15550101999` looks like:

```json
{
  "phone_e164": "+15550101999",
  "snapshot_count": 2,
  "verified": true,
  "low_trust": false,
  "latest": { "carrier_name": "Google Fi", "ported_status": "Y", "caller_name": "Martha Reyes", "confidence_score": 80, "...": "..." },
  "deltas": [
    {
      "from": "2025-06-02T09:00:05.000Z",
      "to": "2025-06-04T10:00:05.000Z",
      "changes": ["carrier_changed", "portability_changed"]
    }
  ],
  "snapshots": [ /* v1, v2 */ ]
}
```

That `deltas` array is the demo moment. The receptionist sees `carrier_changed` and `portability_changed` before the patient says a word, and greets by the confirmed name with a fresh mobile number on file.

---

## 8. Demo mode vs live mode

**Demo mode is the default.** `demoMode()` returns `true` unless `DEMO_MODE` is exactly the string `"false"`. In demo mode `runLookup` short-circuits to `demoLookup` and never touches the network or your API key.

To go live:

```bash
telnyx-edge secrets add TELNYX_API_KEY "<YOUR_API_KEY>"
# set DEMO_MODE=false in your environment / telnyx.toml [env_vars]
```

In live mode `runLookup` calls the real `GET /v2/number_lookup/{e164}?type=carrier&type=enhanced-caller-name` and maps the real `NumberLookupRecord`. Everything downstream — dedupe, snapshot filing, delta detection, the ledger — is identical. The only difference is where the record came from.

Live mode costs money per lookup. The dedupe check runs *before* the lookup, so replaying an intake event never bills you twice.

---

## 9. Durability: what happens when the pod dies

The acceptance criterion is "pod killed after snapshot v1 → snapshot v2 lands on the same actor with both rows intact and no duplicate."

This works because nothing important lives in memory:

- The actor's **name** is derived from the phone number, so the platform routes the next booking to the same instance regardless of which pod serves it.
- The **snapshots** live in `IDENTITY_DB`, a durable SQL binding, not in a local variable.
- The **schema** is created idempotently on every entry point, so a cold actor can serve a request immediately.
- The **dedupe index** is in the database, so a redelivered event is rejected even if the actor's state was lost entirely.

On restart, the next `onIntakeCaptured` re-wakes the actor, `ensureSchema` is a no-op, `snapshots(e164)` returns both rows, `prior.length` is `1`, the lookup runs, and the new snapshot appends. `snapshotCount` in state is recomputed from `prior.length + 1` rather than incremented, so it cannot drift.

---

## 10. Security notes

- The API key is read from `SECRETS` at call time and never written to a file, a log, or a response.
- Every SQL statement is parameterized with `?` placeholders and `.bind(...)`. No string interpolation anywhere.
- Logs mask phone numbers: `maskPhone("+15550101999")` → `+1555****99`. The only logged fields are the masked number, the source type, and the flag list.
- HTTP error responses are generic. The real message goes to `console.error` server-side only.
- `.env.example` contains placeholders only. No real numbers, no real keys.

---

## 11. Running it

```bash
# 1. Install
npm install

# 2. Authenticate the CLI
telnyx-edge auth api-key set <YOUR_API_KEY>

# 3. Generate telnyx-env.d.ts from telnyx.toml
npm run types

# 4. Verify the module loads and the demo flow works
npx tsx smoke_test.ts

# 5. Deploy
npm run deploy        # → telnyx-edge ship
```

Once deployed, exercise the demo:

```bash
# The full scripted transcript
curl -X POST https://<your-worker>/demo/run

# A single intake capture
curl -X POST https://<your-worker>/intake \
  -H 'content-type: application/json' \
  -d '{"phoneE164":"+15550101999","capturedAt":"2025-06-02T09:00:05Z"}'

# The staff view
curl https://<your-worker>/identity/+15550101999
```

`smoke_test.ts` imports the module, asserts that `normalizeE164` and `digitsOfE164` behave, and checks that `normalizeLookup` maps a representative `NumberLookupRecord` onto the ledger columns. It runs without a Telnyx account.

---

## 12. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `phoneE164 must be a valid E.164 number` | Fewer than 10 or more than 15 digits, or a leading zero | Pass a full E.164 number including country code |
| `TELNYX_API_KEY is not configured` | `DEMO_MODE=false` but no secret set | `telnyx-edge secrets add TELNYX_API_KEY "..."` or unset `DEMO_MODE` |
| `number_lookup returned 4xx` | Key lacks Number Lookup permission, or the number is not lookup-able | Check the key's product access in the Telnyx portal |
| Second intake returns `status: "duplicate"` unexpectedly | Same `capturedAt` as a previous event | Omit `capturedAt` to let the actor stamp the current time |
| `confidence_score` is `0` | No caller name on file (common for VoIP and prepaid) | Expected — the ledger marks the record `low_trust` and not `verified` |
| `verified` is `false` on a named number | Confidence below 70 | Moderate/limited confidence is not treated as verified by design |

---

## 13. Next steps

- **Number Lookup docs** — the full type list, response shapes, and pricing: <https://developers.telnyx.com/docs/identity/number-lookup>
- **Lookup phone number data (API reference)** — request/response schema for `GET /v2/number_lookup/{phone_number}`: <https://developers.telnyx.com/docs/api-reference/number-lookup/lookup-phone-number-data>
- **Agent SDK** — `Agent`, `@rpc`, `rpcSurface`, SQL bindings, and actor namespaces: <https://developers.telnyx.com/docs/agent-sdk>
- **Add `type=caller-identity`** — the third lookup type returns postal address and a `confidence_score` on the same 50–90 scale. `normalizeLookup` already reads `caller_identity.caller_name` and `caller_identity.confidence_score`; adding the type to `LOOKUP_TYPES` is a one-line change.
- **Wire the flags to messaging** — when `carrier_changed` or `voip_low_trust` fires, send the front desk a Telnyx SMS instead of waiting for them to open the ledger: <https://developers.telnyx.com/docs/messaging/messages>
- **Gate the callback** — pair `low_trust` with a Verify flow so a VoIP number can still be confirmed before the clinic calls it back: <https://developers.telnyx.com/docs/identity/verify>
- **Read the sibling docs** — `README.md` for setup and architecture, `API.md` for the typed route reference.
