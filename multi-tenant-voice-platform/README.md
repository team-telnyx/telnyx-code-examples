---
name: multi-tenant-voice-platform
title: "Multi-Tenant Voice Platform with Telnyx Edge Compute"
description: "White-label voice platform on Telnyx Edge Compute with a polished per-tenant dashboard. Each tenant gets isolated config (SQL DB), per-tenant rate limit (Actor state), and per-tenant call state (StatefulActor). DEMO_MODE runs locally without credentials; LIVE_MODE places real calls through the Telnyx Call Control API."
language: nodejs
framework: telnyx-edge
telnyx_products: [Edge Compute, Call Control]
---

# Multi-Tenant Voice Platform

A self-contained white-label voice platform built on Telnyx Edge Compute, with a polished **per-tenant dashboard** designed for recording on YouTube. One Edge function, many tenants — each tenant's config, rate limit, and call state are isolated through the Stateful Actor + per-actor storage primitives. Two tenants are seeded automatically: **tenant_a** (10 calls/min, 5 concurrent) and **tenant_b** (5 calls/min, 3 concurrent).

The dashboard has two tenant cards side-by-side, each showing live counters, rate-limit progress bars, a "Place call" form, and a recent-calls feed. The rate-limit bar turns amber at 60% and red when full. A recording-view toggle hides debug controls and enlarges type for screen capture.

## Why Telnyx

Telnyx Edge Compute gives every Stateful Actor its own SQLite-backed `ctx.storage.sql` and durable per-actor state via `setState`/`getState`. Multi-tenancy becomes a routing decision: one Edge function, one per-tenant Actor instance keyed by `idFromName(tenantId)`. No shared mutable state, no cross-tenant data leaks, no separate deploys per tenant.

## Telnyx APIs Used

- **Call Control** — outbound call placement (`telnyx.calls.create()` in LIVE_MODE)
- **Stateful Actors** — `Agent<E, S>` base class, per-actor SQLite, `idFromName(name)` addressing
- **Durable state** — `this.setState()` / `this.getState()` for per-actor state
- **Call webhooks** — `call.initiated` / `call.answered` / `call.hangup` (Ed25519-signed) update dashboard state in real time

## Architecture

```
   ┌─────────────────────────────────────────────────────────┐
   │                  Local runner / Edge runtime              │
   │                                                          │
   │  POST /api/tenants/:id/calls                             │
   │    │                                                     │
   │    ├─ TenantConfigActor (singleton, "config" actor)     │
   │    │    • tenants SQL table (shared)                      │
   │    │    • sliding-window rate limit (Actor state)         │
   │    │                                                     │
   │    └─ TenantVoiceActor (one per tenant, "voice_<id>")    │
   │         • calls SQL table (per-actor SQLite)              │
   │         • isolates call state from other tenants          │
   │                                                          │
   │  Live mode: telnyx.calls.create() — real call placement  │
   │  DEMO mode: walker flips call through queued→completed   │
   │                                                          │
   │  /webhooks/voice — Ed25519 verified, routes by           │
   │                       call_control_id → updates row        │
   └─────────────────────────────────────────────────────────┘
```

Two tenants' calls cannot leak because each Actor's SQLite lives in a separate file (`voice_tenant_a.sqlite` vs `voice_tenant_b.sqlite`). The rate-limit counter lives in the config Actor's durable state — atomic because the Actor serializes invocations per instance.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DEMO_MODE` | no (default `true`) | If `true`, calls are simulated locally (no credentials needed). If `false`, requires `TELNYX_API_KEY` and tenant `default_voice_profile_id`s to place real calls. |
| `PORT` | no (default `8787`) | Local runner port |
| `HOST` | no (default `127.0.0.1`) | Local runner bind host |
| `TENANT_VOICE_DB` | no (default `.data`) | Local SQLite directory |
| `TELNYX_API_KEY` | yes (live) | Telnyx v2 API key |
| `TELNYX_PUBLIC_KEY` | yes (live) | Ed25519 webhook signing key (PEM or base64) |
| `TELNYX_PUBLIC_BASE_URL` | yes (live) | Public HTTPS URL for webhook delivery (ngrok / cloudflared) |
| `TENANT_A_NAME` | no (default `Tenant A`) | Display name for tenant_a |
| `TENANT_A_VOICE_PROFILE_ID` | no | Telnyx Call Control connection_id for tenant_a's outbound calls (LIVE_MODE) |
| `TENANT_A_WEBHOOK_URL` | no | Where tenant_a's call events get forwarded |
| `TENANT_B_NAME` | no (default `Tenant B`) | Display name for tenant_b |
| `TENANT_B_VOICE_PROFILE_ID` | no | Telnyx Call Control connection_id for tenant_b |
| `TENANT_B_WEBHOOK_URL` | no | Webhook URL for tenant_b |

## Setup

### Demo mode (no credentials)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/multi-tenant-voice-platform
npm install
npm start
# → http://localhost:8787/
# → Dashboard renders both tenants
# → Click "Place call" → simulated call walks queued → ringing → answered → completed
```

### Live mode (real calls)

```bash
# 1. One-time: store secrets
telnyx-edge secrets add TELNYX_API_KEY "your_api_key"
telnyx-edge secrets add TELNYX_PUBLIC_KEY "$(curl -s -H \"Authorization: Bearer $TELNYX_API_KEY\" https://api.telnyx.com/v2/public_key | jq -r '.data.public')"

# 2. Configure tenant voice profiles in .env
cat > .env <<EOF
DEMO_MODE=false
TELNYX_API_KEY=KEY...
TELNYX_PUBLIC_KEY=...
TELNYX_PUBLIC_BASE_URL=https://your-tunnel.ngrok.app
TENANT_A_VOICE_PROFILE_ID=your_connection_id_a
TENANT_B_VOICE_PROFILE_ID=your_connection_id_b
EOF

# 3. Run
npm start

# 4. Point Telnyx Call Control app webhook at /webhooks/voice
```

## Dashboard

The dashboard renders at `GET /` and is the screen-recording target.

| Element | Behavior |
|---|---|
| Top-right pill | "Demo mode" (amber, simulated) or "Live · Telnyx" (red, blinking) — viewer sees the source of truth |
| Top-right toggle | "Recording view" hides debug controls + enlarges type for screen capture |
| Per-tenant card | Stripe (green for A, blue for B), name, two stat blocks |
| Rate-limit stat | "X/10 calls this minute" with progress bar (amber at 60%, red at 100%) |
| Active-calls stat | "X/5 active" with progress bar (sliding cap) |
| Place-call form | `from` + `to` E.164 fields + tenant-color button |
| Recent calls | Newest first, status pill (queued/ringing/answered/completed), real vs simulated indicator |

Click **Place call** on either tenant — the bar ticks, a new entry appears in the recent calls feed with status `queued`, then `ringing` → `answered` → `completed` on a timer (DEMO_MODE) or via real Telnyx webhooks (LIVE_MODE). Try to exceed either tenant's rate limit or concurrent cap — the bar turns red and the request returns 429.

## API

Base URL: `http://127.0.0.1:8787` (local) or your deployed Edge function URL.

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/` | — | dashboard HTML (200) |
| `GET` | `/health` | — | `{ok, demoMode}` (200) |
| `GET` | `/api/dashboard` | — | `{tenants: TenantDashboard[]}` — snapshot for the dashboard UI |
| `GET` | `/api/tenants` | — | `{tenants: Tenant[]}` — all tenants |
| `GET` | `/api/tenants/:id` | — | single tenant row (200) or 404 |
| `GET` | `/api/tenants/:id/config` | — | `{tenant}` (200) or 404 |
| `POST` | `/api/tenants/:id/calls` | `{from, to}` | `{call, rate_limit}` (202), 429 rate-limited, 429 max-concurrent, 404 unknown tenant, 400 missing fields |
| `GET` | `/api/tenants/:id/calls` | — | `{calls: Call[]}` — newest first (200) |
| `GET` | `/api/tenants/:id/calls/:callId` | — | `{call}` (200) or 404 |
| `POST` | `/api/tenants/:id/calls/:callId/hangup` | — | `{call}` (200, status="completed") or 404 |
| `POST` | `/webhooks/voice` | Telnyx call event | `{ok, call_control_id, tenant_id}` (202) or 401 invalid signature |
| `GET` | `/api/events` | — | Server-Sent Events stream — `dashboard_update` events drive live UI refresh |

```ts
type Tenant = {
  id: string;
  name: string;
  rate_limit_per_minute: number;
  max_concurrent_calls: number;
  default_voice_profile_id: string;
  webhook_url: string;
  created_at: number;
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

type TenantDashboard = {
  tenant_id: string;
  name: string;
  rate_limit_per_minute: number;
  max_concurrent_calls: number;
  rate_limit: { used: number; limit: number };
  active_calls: number;
  recent_calls: Call[];
};
```

## Demo flow (for the YouTube recording)

1. **Open the dashboard (5 sec)** — `http://localhost:8787/`. The "Demo mode" pill is amber, both tenants are visible with empty bars and empty recent-calls feeds.
2. **Tenant_a: click "Place call" (10 sec)** — the call-control id (`call_…`) appears in the recent calls feed with status `queued`. After ~800ms it transitions to `ringing` (amber pill), after ~2.5s to `answered` (blue pill), after ~10s to `completed` (green pill).
3. **Tenant_a: rapid-fire 5 calls (15 sec)** — the rate-limit bar ticks from 1/10 → 5/10 and turns amber at 60%, red at the 10th. Each call appears in the feed.
4. **Tenant_b: rapid-fire 5 calls (20 sec)** — limit=5, max_concurrent=3. The first 3 succeed (active bar fills), the 4th-5th hit the **max concurrent calls reached** 429, the 6th hits **rate limit exceeded** 429. The bar turns red.
5. **Tenant_a: still works (5 sec)** — switch back to tenant_a; it still has its full budget. Demonstrates **per-tenant isolation**.
6. **Recording view (10 sec)** — top-right toggle. Type enlarges, debug controls hide. This is what shows on screen.
7. **Outro (10 sec)** — "One Telnyx Edge Compute function. Many tenants. Isolated state. Per-tenant rate limits and concurrency caps. Same dashboard, same code, real calls or simulated — flip a flag."

Total runtime: ~75 seconds.

## Files

```
multi-tenant-voice-platform/
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── telnyx.toml                            # Edge manifest
├── README.md
├── src/
│   ├── index.ts                            # fetch handler with tenant routing + dashboard endpoint
│   ├── dashboard.ts                        # polished 3-pane HTML export (TENANT · A | TENANT · B)
│   ├── types.ts                             # Tenant, Call, DashboardSnapshot
│   ├── tenantConfigLogic.ts                 # pure functions — schema, list, get, rate limit, reset, used
│   ├── tenantVoiceLogic.ts                  # pure functions — startCall, listCalls, hangup, activeCount, update
│   ├── tenantConfigActor.ts                 # Edge-runtime wrapper for config actor
│   ├── tenantVoiceActor.ts                  # Edge-runtime wrapper for voice actor
│   ├── telnyxLive.ts                        # Telnyx Call Control wrapper (LIVE_MODE only)
│   ├── webhookVerify.ts                     # Ed25519 signature verification (tweetnacl)
│   └── local/
│       ├── context.ts                       # LocalActorContext (better-sqlite3)
│       └── server.ts                        # Express runner + SSE bus + demo call walker
└── tests/
    └── smoke.test.ts                        # 10 tests — DB CRUD, isolation, rate limit, Ed25519
```

## Notes

- **Why pure functions + thin Actor wrappers?** The `Agent` base class wires a TaskScheduler and StateStore in its constructor that call `ctx.storage.list({prefix, limit})` and other KV primitives — fiddly to mock in tests. The real logic lives in `tenantConfigLogic.ts` and `tenantVoiceLogic.ts`; the Actor classes are thin Edge-runtime adapters.
- **Why per-actor SQLite files?** Edge's runtime gives each Stateful Actor its own SQLite on disk — two tenants' `calls` tables cannot collide because they live in different files. Locally, `actorDbPath()` keys the file on the actor name.
- **Demo walker** — In DEMO_MODE, a background walker in the local runner flips each placed call through `queued → ringing → answered → completed` on a timer (800ms / 2200ms / 10000ms). It uses synthetic `call_control_id = null` so the dashboard's "simulated vs real" indicator is accurate.
- **SSE dashboard updates** — Every call state change broadcasts a `dashboard_update` event over `/api/events`. The browser reconnects automatically on disconnect. Polling is not needed but the client also re-fetches the snapshot on each event as a belt-and-suspenders measure.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `npm install` fails on `@types/tweetnacl` | Package doesn't exist | Removed — `tweetnacl` ships its own types |
| Dashboard renders but `Place call` returns 500 in LIVE_MODE | Missing `TENANT_X_VOICE_PROFILE_ID` | Set both tenant voice profile IDs in `.env` |
| Live calls return `502 Bad Gateway` | Telnyx API rejected the request | Check `TELNYX_API_KEY`, voice profile IDs, and that the numbers belong to your Telnyx account |
| `401` on webhooks | `TELNYX_PUBLIC_KEY` mismatch | Re-fetch via `GET /v2/public_key` and update |
| `429 rate limit exceeded` even on first call | Rate-limit window carried over from a previous run | `POST /api/demo/reset` (or restart with fresh `.data`) |

## Related Examples

- [Edge Cron Scheduler (TypeScript, Agent SDK)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/edge-cron-scheduler) — durable job runner with auth-gated dashboard
- [omni-channel-lab-inbox-agent (TypeScript, Agent SDK)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/omni-channel-lab-inbox-agent) — multi-channel actor with per-customer routing
- [edge-cache-invalidation-agent (TypeScript)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/edge-cache-invalidation-agent) — example of KV bindings via `env.CACHE_KV`

## References

- [Telnyx Edge Compute docs](https://developers.telnyx.com/docs/edge-compute)
- [Stateful Actors](https://developers.telnyx.com/docs/edge-compute/stateful-actors)
- [Agent SDK](https://developers.telnyx.com/docs/agent-sdk)
- [Telnyx CLI](https://developers.telnyx.com/docs/development/cli)
- [Edge CLI releases](https://github.com/team-telnyx/edge-compute/releases)
