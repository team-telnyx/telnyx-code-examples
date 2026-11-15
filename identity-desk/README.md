---
name: identity-desk
title: "Identity Desk — The Identity Ledger for Every Phone Number"
description: "A durable Telnyx Edge actor that files multi-type Number Lookup results as an append-only identity ledger and surfaces carrier, portability, and name deltas to the front desk."
language: typescript
framework: edge
telnyx_products: [number-lookup, agent-sdk]
---

# Identity Desk — The Identity Ledger

One durable `IdentityDesk` actor per phone number: intake captures a number, the actor runs a multi-type Telnyx Number Lookup, files an append-only snapshot in agent SQL, and diffs it against the previous snapshot so the front desk sees carrier, portability, and name deltas on the next visit — even after a pod restart.

## The Story

Northside Family Clinic runs three urgent-care sites and books most of its patients by phone; the front desk types a callback number into the intake form, and everything downstream — the reminder SMS, the no-show follow-up, the billing contact — hangs off that one number being right. When a returning patient's number has quietly ported to a new carrier, or a caller hands over a VoIP line that rings nowhere, the clinic doesn't just lose a callback: it loses a patient, wastes a slot, and risks a misidentified record in a regulated healthcare workflow. The actor IS the identity ledger for one phone number. It is born the moment intake captures `+1 555 010 1999`, files its first snapshot (Verizon Wireless, mobile, "Martha Reyes", confidence 80, verified), and then lives on across days and bookings — on Wednesday's follow-up the same number comes back ported to Google Fi, so the actor files snapshot v2 and raises `carrier_changed` before the receptionist says a word; on Thursday a different caller's VoIP line files as `voip_low_trust` so staff prefer the mobile on record. When the pod is killed between snapshots, the next booking re-wakes the same actor by name, both rows are still in SQL, and the verdict merges without a duplicate — the ledger survives because it was never in memory to begin with. The rest of this README is the API surface of that story.

## Why Telnyx

Because the identity data and the durable compute live on the same platform. Telnyx Number Lookup returns carrier, line type, portability, CNAM, and caller identity in a single multi-type request — the exact signals a receptionist needs to decide whether to trust a callback number — and the Telnyx Edge Agent SDK gives that data a permanent home: a stateful actor with its own SQL database, an `@rpc()` staff surface, and state that survives restarts. That combination is what we mean by **AI Communications Infrastructure**: not a lookup endpoint bolted onto a CRM, but a platform-native identity record that a voice agent, a booking flow, and a human receptionist can all read from the same source of truth. Competitor receptionist demos sync contact memory out to a third-party CRM; here the identity record *is* the compute.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose in this sample |
|----------|--------|-----------------------|
| `/v2/number_lookup/{phone_number}?type=carrier&type=enhanced-caller-name` | `GET` | Multi-type lookup in one request — `carrier.name`, `carrier.type` (line type), `portability.ported_status`, `portability.normalized_carrier`, `enhanced_caller_name.caller_name`, `enhanced_caller_name.entity_type`. Called by `IdentityDesk.runLookup()`. |
| `/v2/number_lookup/{phone_number}?type=caller-identity` | `GET` | Optional third type — `caller_identity.caller_name`, postal address, `confidence_score` (50–90 scale). The normalizer reads it when present and falls back to CNAM. |

No webhooks. The trigger path is the booking app calling `POST /intake` on this worker.

### Lookup types and confidence semantics

| `type` | What it returns | How this sample uses it |
|--------|-----------------|-------------------------|
| `carrier` | `carrier.name`, `carrier.type` (`mobile` / `landline` / `voip`), `portability.ported_status`, `portability.normalized_carrier` | Populates `carrier_name`, `line_type`, `ported_status`; drives `carrier_changed` / `portability_changed` / `line_type_changed` deltas. |
| `enhanced-caller-name` | `enhanced_caller_name.caller_name`, `enhanced_caller_name.entity_type` (`person` / `business`) | Populates `caller_name` and `entity_type`; drives `name_changed`. |
| `caller-identity` | `caller_identity.caller_name`, postal address, `confidence_score` | Optional; when present its `confidence_score` wins over the CNAM-derived default. |

`confidence_score` runs on a **50–90 scale**. **70+** is high confidence and marks the record `verified: true` in the ledger; **60** is moderate; **50** is limited; **below 50** Telnyx returns no name at all, and the actor files the snapshot with `confidence_score: 0` and `caller_name: null`. A `line_type` of `voip` sets `low_trust: true` on the ledger regardless of confidence — the receptionist should prefer a mobile callback.

## Architecture

```
  Booking app / front desk
        │  POST /intake  {"phoneE164": "+15550101999", "capturedAt": "..."}
        ▼
  ┌──────────────────────────────────────────────────────────┐
  │  worker fetch()  —  src/index.ts                         │
  │  normalizeE164() → digitsOfE164()                        │
  └───────────────────────┬──────────────────────────────────┘
                          │  env.IDENTITY.idFromName(digits)
                          ▼
  ┌──────────────────────────────────────────────────────────┐
  │  IdentityDesk extends Agent<Env, IdentityState>          │
  │  ONE durable actor per phone number                      │
  │                                                          │
  │  onIntakeCaptured(payload)                               │
  │     ├─ snapshotExists(phone, looked_up_at, source_type)  │
  │     │     └─ yes → status "duplicate", no new row        │
  │     ├─ runLookup(e164, priorCount)                       │
  │     │     └─ GET /v2/number_lookup/{e164}                │
  │     │        ?type=carrier&type=enhanced-caller-name     │
  │     │        → normalizeLookup() → LookupRecord          │
  │     ├─ fileSnapshot()  → INSERT identity_snapshot        │
  │     ├─ onDelta(prev, next) → carrier_changed,            │
  │     │     name_changed, portability_changed,             │
  │     │     line_type_changed, voip_low_trust              │
  │     └─ setState({ snapshotCount, carrierName, lineType,  │
  │                   lastConfidence, entity_type, flags })  │
  │                                                          │
  │  @rpc identity(e164) → Ledger { snapshots, deltas,       │
  │                                 verified, low_trust }    │
  └───────────────────────┬──────────────────────────────────┘
                          │  this.env.IDENTITY_DB
                          ▼
  ┌──────────────────────────────────────────────────────────┐
  │  SqlDatabase binding IDENTITY_DB                         │
  │  identity_snapshot — append-only, unique index on        │
  │  (phone_e164, looked_up_at, source_type)                 │
  └──────────────────────────────────────────────────────────┘
```

### Ledger schema (`identity_snapshot`)

| Column | Type | Notes |
|--------|------|-------|
| `phone_e164` | `TEXT NOT NULL` | Normalized E.164, e.g. `+15550101999`. |
| `looked_up_at` | `TIMESTAMPTZ NOT NULL` | From the intake payload's `capturedAt`, else now. Part of the dedupe key. |
| `source_type` | `TEXT NOT NULL` | `carrier+enhanced-caller-name` — the lookup types that produced this row. Part of the dedupe key. |
| `carrier_name` | `TEXT` | `carrier.name`, falling back to `portability.normalized_carrier`. |
| `line_type` | `TEXT` | `carrier.type` — `mobile`, `landline`, `voip`. |
| `ported_status` | `TEXT` | `portability.ported_status` — `Y` / `N`. |
| `caller_name` | `TEXT` | CNAM name, falling back to `caller_identity.caller_name`. |
| `entity_type` | `TEXT` | `person` / `business`. |
| `confidence_score` | `INT` | 50–90 scale; `0` when no name is returned. |

A unique index on `(phone_e164, looked_up_at, source_type)` makes redelivery of the same intake event a no-op — the actor returns `status: "duplicate"` and the existing ledger.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `DEMO_MODE` | `string` | `true` | no | `true` (default) returns deterministic fixtures — no API key, no charges. Set to `false` for live Number Lookup calls. | Set in `.env` / `telnyx.toml` `[env_vars]` |
| `TELNYX_API_BASE` | `string` | `https://api.telnyx.com` | no | Override the Number Lookup base URL (staging, proxies). | — |

Bindings declared in `telnyx.toml` (not secrets): `IDENTITY` (`[[actors]]`, type `IdentityDesk`) and `IDENTITY_DB` (`[storage.sqldb.IDENTITY_DB]`).

## Setup

```bash
# 1. Clone
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/identity-desk

# 2. Configure
cp .env.example .env
# edit .env — DEMO_MODE=true runs with fixtures and no API key

# 3. Install
npm install

# 4. Generate binding types from telnyx.toml
telnyx-edge types

# 5. Authenticate the CLI (skip while DEMO_MODE=true)
telnyx-edge auth api-key set "$TELNYX_API_KEY"

# 6. Deploy
telnyx-edge ship
```

Smoke test (no deploy, no network):

```bash
npx tsx smoke_test.ts
```

Run the scripted demo against the deployed worker:

```bash
curl -X POST https://<your-worker-host>/demo/run
```

The demo files snapshot v1 (Verizon Wireless, mobile, Martha Reyes, confidence 80), snapshot v2 (ported to Google Fi, `ported_status: "Y"`), replays v2 to prove dedupe, files a VoIP number as low-trust, and returns the merged ledger with deltas.

## API Reference

### `POST /intake`

The only way an `IdentityDesk` is born. Normalizes the number, derives the actor id via `env.IDENTITY.idFromName(digitsOfE164(e164))`, and calls `onIntakeCaptured`.

```json
{ "phoneE164": "+15550101999", "capturedAt": "2025-06-02T09:00:05Z" }
```

`200` response:

```json
{
  "status": "filed",
  "phone_e164": "+15550101999",
  "looked_up_at": "2025-06-02T09:00:05.000Z",
  "flags": [],
  "ledger": { "snapshot_count": 1, "verified": true, "low_trust": false, "latest": { "...": "..." }, "deltas": [], "snapshots": ["..."] }
}
```

`status` is `"filed"` for a new snapshot and `"duplicate"` when `(phone_e164, looked_up_at, source_type)` already exists. `400` on an invalid E.164 number.

### `GET /identity/{e164}`

Staff surface. Returns the merged ledger for one number — every snapshot in `looked_up_at` order, plus pairwise `deltas` (`{ from, to, changes[] }`), `verified` (latest confidence ≥ 70), and `low_trust` (latest `line_type === "voip"`).

### `@rpc identity(e164)`

The same ledger, callable actor-to-actor: `agent.stub.identity("+15550101999")`. The actor logs its RPC surface via `rpcSurface(this)` on every call, so the demo output shows `identity(e164)` as the exposed method.

### `POST /demo/run`

Runs the scripted scenario end to end and returns `{ first, second, replay, voip, ledger }`.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `phoneE164 must be a valid E.164 number` | Fewer than 10 or more than 15 digits, or a leading zero | Send digits only or a `+`-prefixed number; `normalizeE164` strips punctuation. |
| `TELNYX_API_KEY is not configured` | `DEMO_MODE=false` but no secret bound | `telnyx-edge secrets add TELNYX_API_KEY "..."`, or leave `DEMO_MODE` unset (defaults to `true`). |
| `number_lookup returned 401` / `403` | Key lacks Number Lookup scope | Check the key's product access in the Telnyx portal. |
| `number_lookup returned 429` | Rate limited | Back off and retry; snapshots are deduped so a retry is safe. |
| Every lookup returns the same fixture data | `DEMO_MODE` is still `true` | Set `DEMO_MODE=false` in `.env` / `[env_vars]` and redeploy. |
| `IDENTITY_DB` is undefined | SQL binding missing from `telnyx.toml` | Add `[storage.sqldb.IDENTITY_DB]` and re-run `telnyx-edge types`. |
| Duplicate rows in `identity_snapshot` | Unique index not created | `ensureSchema()` runs on every intake; confirm `identity_snapshot_dedupe` exists. |
| `404 not found` from the worker | Path typo | Routes are exactly `/intake`, `/identity/{e164}`, `/demo/run`. |

## Agent Discovery

- Agent signup and capabilities: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md)
- Telnyx AI + agent examples: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- Machine-readable docs index: [telnyx.com/llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [`number-lookup-python`](../number-lookup-python) — the one-shot Number Lookup script this sample generalizes into a durable ledger.
- [`sim-swap-guard`](../sim-swap-guard) — uses `number_lookup` as a SIM-swap signal inside a Verify gate.
- [`agent-sdk-starter`](../agent-sdk-starter) — minimal `Agent` + `@rpc()` project to compare against this one.
- [`contact-memory-agent`](../contact-memory-agent) — the CRM-sync take on contact memory that this platform-native ledger replaces.

## Resources

- [Number Lookup docs](https://developers.telnyx.com/docs/identity/number-lookup)
- [Lookup phone number data — API reference](https://developers.telnyx.com/docs/api-reference/number-lookup/lookup-phone-number-data)
- [Agent SDK docs](https://developers.telnyx.com/docs/agent-sdk)
- [Number Lookup product page](https://telnyx.com/products/number-lookup)
- [Number Lookup pricing](https://telnyx.com/pricing/number-lookup)
