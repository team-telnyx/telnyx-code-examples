---
name: multi-tenant-voice-platform
title: "Multi-Tenant Voice Platform with Telnyx Edge Compute"
description: "White-label voice platform on Telnyx Edge Compute. Each tenant gets isolated config (SQL DB), per-tenant rate limit (Actor state), and per-tenant call state (StatefulActor). One deployment, many tenants — per-tenant rate limits and concurrency caps enforced at the actor boundary."
language: nodejs
framework: telnyx-edge
telnyx_products: [Edge Compute, Call Control, Voice AI]
---

# Multi-Tenant Voice Platform

A self-contained white-label voice platform built on Telnyx Edge Compute. One Edge function, many tenants — each tenant's config, rate limit, and call state are isolated through the Stateful Actor + per-actor storage primitives.

Two tenants are seeded automatically: **tenant_a** (10 calls/min, 5 concurrent) and **tenant_b** (5 calls/min, 3 concurrent). Add more by inserting rows into the `tenants` table.

## Why Telnyx

Telnyx Edge Compute gives every Stateful Actor its own SQLite-backed `ctx.storage.sql` and durable per-actor state via `setState`/`getState`. Multi-tenancy becomes a routing decision: one Edge function, one per-tenant Actor instance keyed by `idFromName(tenantId)`. No shared mutable state, no cross-tenant data leaks, no separate deploys per tenant — just routing.

## Telnyx APIs Used

- **Call Control** — outbound call placement (would be the real call on Edge)
- **Stateful Actors** — `Agent<E, S>` base class, per-actor SQLite, `idFromName(name)` addressing
- **Durable state** — `this.setState()` / `this.getState()` for per-actor state
- **HTTP fetch handler** — Edge runtime invokes the default exported handler

## Architecture

```
Inbound webhook → fetch handler
                    │
                    ├── env.TENANT_CONFIG.idFromName("__config__")
                    │     → reads tenants table, KV-style rate-limit state
                    │
                    └── env.TENANT_VOICE.idFromName(tenantId)
                          → per-tenant SQL store of call records
                          → isolated from other tenants' calls

POST /api/tenants/:id/calls
  1. config actor: rate-limit check (sliding window, per-tenant)
  2. voice actor: max-concurrent-cap check
  3. voice actor: insert call row
  4. (deployed) TELNYX.calls.create() — outbound dial
```

The singleton `TenantConfigActor` (keyed by `idFromName("__config__")`) owns the shared `tenants` table and the per-tenant sliding-window rate-limit counters (held in Actor state). The per-tenant `TenantVoiceActor` (keyed by `idFromName(tenantId)`) owns that tenant's `calls` table — two tenants literally cannot see each other's call state because each Actor has its own SQLite file.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DEMO_MODE` | no (default `true`) | Skip tenant seeding on the runtime side; use a local runner instead |
| `PORT` | no (default `8787`) | Local runner port |
| `HOST` | no (default `127.0.0.1`) | Local runner bind host |
| `TENANT_VOICE_DB` | no (default `.data`) | Local SQLite directory |
| `TELNYX_API_KEY` | yes (live) | Telnyx v2 API key |
| `TELNYX_PUBLIC_KEY` | yes (live) | Ed25519 webhook signing key (PEM or base64) |
| `TELNYX_PUBLIC_BASE_URL` | yes (live) | Public HTTPS URL for webhook delivery |
| `TENANT_A_NAME` | no (default `Tenant A`) | Display name for the seeded tenant_a |
| `TENANT_A_VOICE_PROFILE_ID` | no | Telnyx voice profile id used for tenant_a's calls |
| `TENANT_A_WEBHOOK_URL` | no | Where tenant_a's call events get forwarded |
| `TENANT_B_NAME` | no (default `Tenant B`) | Display name for tenant_b |
| `TENANT_B_VOICE_PROFILE_ID` | no | Voice profile id for tenant_b |
| `TENANT_B_WEBHOOK_URL` | no | Webhook URL for tenant_b |

## Setup

```bash
# Local runner — DEMO_MODE, no credentials needed
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/multi-tenant-voice-platform
npm install
npm start
# → http://localhost:8787/health
# → http://localhost:8787/api/tenants
```

### Live deployment to Edge Compute

```bash
# 1. Store secrets (one-time)
telnyx-edge secrets add TELNYX_API_KEY "your_api_key"
telnyx-edge secrets add TELNYX_PUBLIC_KEY "$(curl -s -H \"Authorization: Bearer $TELNYX_API_KEY\" https://api.telnyx.com/v2/public_key | jq -r '.data.public')"

# 2. Deploy
telnyx-edge ship

# 3. Wire the Call Control app webhook at /webhooks/voice
```

## API

Base URL: `http://127.0.0.1:8787` (local) or your deployed Edge function URL.

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/health` | — | `{ok: true}` |
| `GET` | `/api/tenants` | — | `{tenants: Tenant[]}` — all tenants |
| `GET` | `/api/tenants/:id` | — | single tenant row (200) or 404 |
| `GET` | `/api/tenants/:id/config` | — | `{tenant: Tenant}` (200) or 404 |
| `POST` | `/api/tenants/:id/calls` | `{from, to}` | `{call, rate_limit}` (202), 429 rate-limited, 404 unknown tenant, 400 missing fields |
| `GET` | `/api/tenants/:id/calls` | — | `{calls: Call[]}` — newest first, 200 |
| `GET` | `/api/tenants/:id/calls/:callId` | — | `{call}` (200) or 404 |
| `POST` | `/api/tenants/:id/calls/:callId/hangup` | — | `{call}` (200) with `status: "completed"`, or 404 |
| `POST` | `/webhooks/voice` | Telnyx call event | `{ok, tenant_id, forwarded_to}` (202) or 401 invalid signature |

```ts
type Tenant = {
  id: string;
  name: string;
  rate_limit_per_minute: number;
  max_concurrent_calls: number;
  default_voice_profile_id: string;
  webhook_url: string;
  created_at: number;  // unix ms
  updated_at: number;
};

type Call = {
  id: string;
  tenant_id: string;
  call_control_id: string | null;
  from_number: string;
  to_number: string;
  direction: "outbound";
  status: "queued" | "ringing" | "answered" | "completed" | "failed";
  started_at: number;
  answered_at: number | null;
  ended_at: number | null;
  duration_seconds: number | null;
  failure_reason: string | null;
};
```

## Demo flow

1. Open `http://localhost:8787/api/tenants` — see `tenant_a` and `tenant_b`.
2. Open `http://localhost:8787/api/tenants/tenant_a/config` — see rate limit (10/min) and concurrent cap (5).
3. `curl -X POST -d '{"from":"+1...","to":"+1..."}' http://localhost:8787/api/tenants/tenant_a/calls` — fire a call.
4. Fire 6 calls to `tenant_b` in a row — the 4th returns 429 (`max concurrent calls reached`, cap=3), the 6th returns 429 (`rate limit exceeded`, cap=5).
5. Try `tenant_a` again — still has its full quota. **Rate limits are isolated per tenant.**
6. `curl http://localhost:8787/api/tenants/tenant_a/calls` — see call history.
7. `curl -X POST http://localhost:8787/api/tenants/tenant_a/calls/<id>/hangup` — mark a call completed.

## Files

```
multi-tenant-voice-platform/
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── telnyx.toml                              # Edge manifest
├── README.md
├── src/
│   ├── index.ts                            # fetch handler with tenant routing
│   ├── types.ts                             # Tenant, Call, Env shapes
│   ├── tenantConfigLogic.ts                 # pure functions — schema, list, get, rate limit, reset
│   ├── tenantVoiceLogic.ts                  # pure functions — startCall, listCalls, hangup, activeCount
│   ├── tenantConfigActor.ts                 # Edge-runtime wrapper for config actor
│   ├── tenantVoiceActor.ts                  # Edge-runtime wrapper for voice actor
│   ├── webhookVerify.ts                     # Ed25519 signature verification (tweetnacl)
│   └── local/
│       ├── context.ts                       # LocalActorContext — better-sqlite3 + in-memory state
│       └── server.ts                        # Express runner for local dev
└── tests/
    └── smoke.test.ts                        # 10 tests: seed, isolation, rate limit, hangup, Ed25519
```

## Notes

- **Why pure functions + thin Actor wrappers?** The `Agent` base class wires a TaskScheduler and StateStore in its constructor that call `ctx.storage.list({prefix, limit})` and other KV primitives — fiddly to mock in tests. By extracting the real logic into `tenantConfigLogic.ts` and `tenantVoiceLogic.ts`, tests run against plain better-sqlite3 without ever instantiating `Agent`. The Actor classes are thin Edge-runtime adapters that delegate to the same functions in production.
- **Why SQL for rate limits instead of KV?** The runtime exposes `ctx.kv` via bindings (e.g. `env.CACHE_KV.get(...)`), configured in `telnyx.toml`. For this sample, the rate-limit counter is small enough to live in the config Actor's durable state via `setState`/`getState` — atomic because the Actor serializes invocations per instance, and zero external dependencies.
- **Why per-actor SQLite files?** Edge's runtime gives each Stateful Actor its own SQLite on disk — two tenants' `calls` tables cannot collide because they live in different files. Locally, `actorDbPath()` keys the file on the actor name to mimic this.
- **Webhook signing.** `webhookVerify.ts` is included and exported for the Edge fetch handler to validate `email.received` (or `call.initiated`) webhooks with `telnyx-signature-ed25519` + `telnyx-timestamp`. Live deployments should wire the handler in `src/index.ts` to verify; the local runner skips verification by default.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Server logs `storage.list is not a function` on startup | You're not using the local runner correctly — bypass Agent entirely (see `src/local/server.ts`) | Make sure `npm start` invokes `dist/src/local/server.js` |
| `npm install` fails on `@types/tweetnacl` | Package doesn't exist | Removed — `tweetnacl` ships its own types |
| `402`/`403` on outbound calls | Telnyx API rejected the request | Verify `TELNYX_API_KEY`, `TENANT_X_VOICE_PROFILE_ID`, and domain ownership |
| Rate limit never resets | Window is a sliding 60s — `retry_after_seconds` tells you when next slot opens | Use `POST /api/demo/reset` to clear in local mode |

## Related Examples

- [Edge Cron Scheduler (TypeScript, Agent SDK)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/edge-cron-scheduler) — durable job runner with auth-gated dashboard (closest pattern match for the local runner)
- [omni-channel-lab-inbox-agent (TypeScript, Agent SDK)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/omni-channel-lab-inbox-agent) — multi-channel actor with per-customer routing
- [edge-cache-invalidation-agent (TypeScript)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/edge-cache-invalidation-agent) — example of KV bindings via `env.CACHE_KV`

## References

- [Telnyx Edge Compute docs](https://developers.telnyx.com/docs/edge-compute)
- [Stateful Actors](https://developers.telnyx.com/docs/edge-compute/stateful-actors)
- [Agent SDK](https://developers.telnyx.com/docs/agent-sdk)
- [Telnyx CLI](https://developers.telnyx.com/docs/development/cli)
- [Edge CLI releases](https://github.com/team-telnyx/edge-compute/releases)
