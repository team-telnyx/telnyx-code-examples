---
name: watchdog
title: "Browser Watchdog — Scheduled Web Checks With a Memory"
description: "A durable Telnyx Edge actor that watches one web property, remembers what normal looks like, proves when it broke, and proves when it was fixed."
language: typescript
framework: edge
telnyx_products: [Agent Browser, AI, Messaging, Edge Runtime]
---

# Browser Watchdog

A durable Telnyx Edge actor that owns one web property's health check — it remembers the baseline, wakes on a schedule, drives an isolated Agent Browser session, and files dated incidents it can later close with before/after screenshots.

## Why Telnyx

A watchdog is only useful if it can act on what it finds, and that means three things living in one place: a durable actor that survives restarts, a browser that runs in the cloud (not on the operator's laptop), and a messaging + inference layer that turns a verdict into a text message. Telnyx provides all three as **AI Communications Infrastructure** — the Edge runtime hosts the actor and its SQL ledger, Agent Browser provides the isolated, policy-scoped browser session with JSON observations and refs instead of pixels, and the zero-credential `TELNYX` binding carries both the alert SMS and the model turn that decides healthy vs. broken. No separate browser-farm vendor, no separate SMS vendor, no API keys threaded through the actor.

> **Beta notice:** Agent Browser is a **beta** REST surface. Request/response shapes, action types, and error codes may change. The baseline-extraction and verdict prompts in this sample are demo constants, not API contracts — verify them against the current docs before relying on them in production.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose in this sample |
|----------|--------|------------------------|
| `/v2/browser_sessions` | `POST` | Create the run's isolated session — `policy.allowed_domains`, `limits.lifetime_s`/`idle_timeout_s`, `idempotency_key` = run key |
| `/v2/browser_sessions/:id` | `GET` | Poll provisioning until `ready`; re-check after `execution_lost` |
| `/v2/browser_sessions/:id/actions?wait_seconds=25` | `POST` | The action loop — `navigate`, `observe`, `fill`, `click`, `screenshot`; a `202` is polled by action id |
| `/v2/browser_sessions/:id/actions/:action_id` | `GET` | Poll a still-running action to a terminal state |
| `/v2/browser_sessions/:id/artifacts/:artifact_id` | `GET` | Resolve a screenshot `artifact_id` to a `download_url` stored in the run row |
| `/v2/browser_sessions/:id` | `DELETE` | Close the session in a `finally` path after every run |
| `/v2/messages` | `POST` | Alert + reply SMS via `this.env.TELNYX.messages.send()` (zero-credential binding) |
| `/v2/ai/chat/completions` | `POST` | Ref-picking and the healthy/broken verdict via `this.env.TELNYX.ai.chat.createCompletion()` |

## Architecture

```
 owner SMS / HTTP                    Telnyx Edge
 ────────────────                   ────────────
 "watch https://…"   ──────▶  POST /watch    ──▶  Watchdog actor  (idFromName(hostname))
 "status"            ──────▶  GET /status/:id         │
 "recheck now [url]" ──────▶  POST /webhooks/messaging│  state (durable):
 "recheck <incident>"          (Ed25519-verified)     │    target_url, allowed_domains,
                               owner-authorized       │    baseline { price_text, form_labels[] },
                                                      │    last_verdict, schedule_id, open_session_id
                                            every(86400) ──▶ runCheck()
                                                      │
                                      ┌───────────────┴─────────────────┐
                                      ▼                                 ▼
                          Agent Browser (beta REST)            TELNYX binding
                          POST /browser_sessions               ai.openai.chat
                            → poll provisioning → ready           (pick refs, judge vs baseline)
                            navigate → observe                      messages.send
                            → fill (stale_ref? re-observe)            (alert + replies)
                            → fill → click → observe → screenshot
                                      │
                                      ▼
                          WATCHDOG_DB  (SQL ledger)          WATCHDOG_INDEX (KV)
                            runs       (run_key, verdict,      watch:<id> → owner phone
                                       reason, price_text,    owner:<phone> → watch ids
                                       screenshot_artifact_id, incident:<id> → watch id
                                       screenshot_url, observation_id,
                                       refs_json, stale_recovered)
                            incidents  (id, run_date, first_broken_at, reason,
                                       before_artifact_id, after_artifact_id, status)
```

**One actor per watched property.** `idFromName(watchId(url))` derives the actor id from the target hostname, so `watch https://shop.example.com/pricing` and `watch https://shop.example.com/contact` are the same watch, and a second `watch` for a different host is a different, independent watchdog.

**The run loop** (`runCheck`):

1. Look up the run row by `run_key` (the UTC run date for scheduled runs). If a verdict already exists, the run is a no-op — this is the crash-resume guard.
2. `POST /browser_sessions` with `allowed_domains: [host]`, `limits: { lifetime_s: 900, idle_timeout_s: 120 }`, `idempotency_key: run_key`; poll `GET /browser_sessions/:id` until `ready`. If the idempotent replay returns a terminal (`closed`/`failed`/`expired`) session, the actor re-creates with a fresh key.
3. `navigate` (`wait_until: "dom_stable"`) → `observe` → the LLM picks the price/name/email/submit refs from the observation.
4. `fill` the price field. If it returns `stale_ref` (HTTP 200, `data.status: "failed"`), re-`observe` for a fresh `observation_id` + refs, re-pick, retry **once**. A second consecutive staleness files an incident note instead of a verdict.
5. Fill `name` + `email`, `click` submit, `observe` the success state, `screenshot` → `artifact_id` → `GET .../artifacts/:id` → `download_url` (a signed path, resolved against the API host) stored in the run row.
6. The LLM verdict compares the **pre-submit** pricing observation against the stored baseline → `healthy` or `broken(reason)`.
7. Write the run row. `broken` → upsert a dated incident (keyed by run date) + alert SMS. `healthy` with an open incident → close it with before/after artifact ids.
8. `DELETE /browser_sessions/:id` in a `finally` block, always.

**Error model.** `stale_ref` / `stale_observation` are HTTP 200 execution failures — recover by re-observing, never by resubmitting the same ref. `execution_lost` (HTTP 503, or an action in `unknown`) is never blindly resubmitted: the actor re-observes, verifies whether the fill/click already took effect, and only repeats the mutation with a fresh observation when it did not; if the session is `failed`/`expired`, a fresh session is opened for the remainder of the run. `429 quota_exceeded` on session create closes the actor's own still-open session, `schedule(60, "runCheck", …)` with the same run key, and retries — never a hot retry.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** (live mode) | API key for the Agent Browser beta REST calls, read via the `SECRETS` binding. | [Portal → API Keys](https://portal.telnyx.com/api-keys) |
| `WATCH_TARGET_URL` | `string` | `https://your-fixture-host.example.com/` | no | Default target used when no URL is supplied to `POST /watch` or by an owner's URL-less SMS command. Must be a public `https://` URL — Agent Browser sessions run in Telnyx's cloud and cannot reach `localhost`. | Your deployed fixture (see Setup) |
| `WATCH_OWNER_PHONE` | `string` | `+1555XXXXXXX` | no | E.164 number that receives alerts and is allowed to send `watch` / `status` / `recheck` commands. | Your personal phone |
| `FROM_NUMBER` | `string` | `+1555XXXXXXX` | no (required for live SMS) | E.164 Telnyx number the alert SMS is sent from. | [Telnyx Portal → Numbers](https://portal.telnyx.com/numbers) |
| `DEMO_MODE` | `string` | `true` | no | `true` (default) replays the envelopes recorded in `demo/browser-fixtures.json` and derives the verdict locally — no API calls, no SMS. `false` drives the live beta API and the `TELNYX` binding. | — |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | Model used for ref-picking and the verdict turn. | [Telnyx AI models](https://developers.telnyx.com/docs/inference/models) |
| `TELNYX_PUBLIC_KEY` | `string` | `your_telnyx_webhook_public_key_here` | yes (live SMS webhook) | Ed25519 webhook signing public key for `POST /webhooks/messaging`. | [Portal → API Keys → Public key](https://portal.telnyx.com/api-keys/public-key) |

Config knobs (`WATCH_TARGET_URL`, `WATCH_OWNER_PHONE`, `FROM_NUMBER`, `DEMO_MODE`, `AI_MODEL`) are read through a `setting()` helper with `env` → `process.env` → `SECRETS` fallbacks, because Edge env_vars do not reach the actor runtime — declare them as secrets (see `telnyx.toml`) for deploys.

`TELNYX_API_KEY` is read from the `SECRETS` binding inside the actor (`await this.env.SECRETS.get("TELNYX_API_KEY")`) — set it with `telnyx-edge secrets add`, not by committing a `.env`. The webhook route additionally requires the `TELNYX_PUBLIC_KEY` secret (Ed25519 signing public key) in live mode; unsigned webhook deliveries are refused.

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> telnyx available-phone-numbers list --country US --features sms
> telnyx number-orders create --phone-number +15551234567
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)

## Setup

### 1. Clone and install

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/watchdog
npm install
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login

# Provision an SMS-capable number for the alert + owner SMS
telnyx available-phone-numbers list --country US --features sms
telnyx number-orders create --phone-number +15551234567
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in `WATCH_TARGET_URL`, `WATCH_OWNER_PHONE`, and `FROM_NUMBER`. Leave `DEMO_MODE=true` for the offline walkthrough — the full loop (baseline → stale_ref recovery → broken verdict → incident → fix-close) replays from `demo/browser-fixtures.json` with zero network calls.

### 3. Deploy the demo fixture (required for live mode)

Agent Browser sessions run in Telnyx's cloud, so the target must be publicly reachable. The `fixture/` directory contains a single-page static shop with:

- a price module (the `#price` budget field the watchdog fills) and a contact form (`name`, `email`, submit)
- `?render_wave=N` — rebuilds the page main section after `N` seconds, deliberately invalidating the watcher's observation → `stale_ref`
- `?price=X.XX` — overrides the price (e.g. `?price=0.00`), reproducing the broken-verdict demo on any day

Deploy it to any static host (GitHub Pages, Netlify, S3), **or** let this sample serve it for you: the deployed actor answers `GET /fixture` with the exact same page (kept in sync by the smoke test), so pointing `WATCH_TARGET_URL` at your deployed worker URL + `/fixture` is enough. The `.env.example` default is a placeholder — replace it.

### 4. Authenticate and deploy the actor

```bash
telnyx-edge auth api-key set <YOUR_TELNYX_API_KEY>
telnyx-edge secrets add TELNYX_API_KEY "<YOUR_TELNYX_API_KEY>"
telnyx-edge secrets add TELNYX_PUBLIC_KEY "<Ed25519 public key from the portal>"   # live SMS webhook verification
telnyx-edge types          # regenerate telnyx-env.d.ts from telnyx.toml bindings
telnyx-edge ship           # deploy
```

Point a messaging profile webhook at `<deployed-url>/webhooks/messaging` so the owner's SMS commands reach the actor. Create the `WATCHDOG_DB` (SQL) and `WATCHDOG_INDEX` (KV) resources with `telnyx-edge storage` and paste their ids into `telnyx.toml`.

### 5. Run the smoke test

```bash
npx tsx smoke_test.ts
```

The smoke test exercises the actor over an in-memory Edge environment: the demo loop end-to-end (baseline capture, stale_ref recovery, broken verdict, incident upsert, fix-close with before/after artifacts), crash-resume with no duplicate incident, owner authorization, live-mode signature refusal, and the fixture/demo-fixture invariants — no network, no credentials.

### 6. Drive the demo

```bash
# arm a watch (HTTP path)
curl -X POST https://<your-worker-url>/watch \
  -H 'content-type: application/json' \
  -d '{"url":"https://your-fixture-host.example.com/","owner":"+1555XXXXXXX"}'

# or by SMS from the owner phone (unsigned webhook posts only work in DEMO_MODE)
#   watch https://your-fixture-host.example.com/
#   status
#   recheck now https://your-fixture-host.example.com/?price=0.00
#   recheck <incident_id>
```

The first run captures the baseline (no comparison yet). Point `recheck now` at the `?price=0.00` override to reproduce Wednesday's broken verdict on demand, then `recheck now` against the clean URL to close the incident.

## API Reference

### Worker routes

| Route | Method | Body / Params | Response |
|-------|--------|---------------|----------|
| `/health` | `GET` | — | `200 {"ok":true,"demo_mode":true}` |
| `/fixture` | `GET` | — | The static demo shop (`fixture/index.html`), with `?render_wave=N` and `?price=X.XX` knobs |
| `/watch` | `POST` | `{"url": "https://…", "owner": "+1555…"}` | `202 {"ok":true,"watch_id":"shop.example.com"}` · `400` on missing/invalid/insecure URL |
| `/status/:watch_id` | `GET` | `?owner=` = sender phone | `200 {"status":"Watch: …\nBaseline: …\nLast runs: …\nOpen incidents: …"}` · `403` for non-owners |
| `/webhooks/messaging` | `POST` | Telnyx `message.received` envelope | Dispatches the owner's command; `401` on a bad signature (live mode) |

### SMS commands

| Command | Effect |
|---------|--------|
| `watch <url>` | Validates `https://`, stores config + `allowed_domains`, arms `every(86400, "runCheck")` and a first run in ~5s. Does **not** create a browser session. |
| `status [url]` | Replies from the actor's own SQL: watch URL, baseline price, last 3 runs, open incidents. |
| `recheck now [url]` | Forces an immediate run; optional one-shot URL override (e.g. `?price=0.00`). |
| `recheck <incident_id>` | Fix-verification run — identical flow, closes the named incident on a healthy verdict. |

Only the watch's owner phone (or the account-level `WATCH_OWNER_PHONE`) may send commands; other senders are refused.

### Agent Browser calls made by the actor

| Call | Shape |
|------|-------|
| Create session | `POST /v2/browser_sessions` → `{policy:{allowed_domains:[host]}, limits:{lifetime_s:900, idle_timeout_s:120}, idempotency_key:<run_key>}` → `201 {id, status:"provisioning"}` |
| Poll session | `GET /v2/browser_sessions/:id` → `{status:"ready"\|"provisioning"\|…}` |
| Action | `POST /v2/browser_sessions/:id/actions?wait_seconds=25` → `{id, status:"succeeded"\|"failed"\|"unknown"\|"queued"\|"running", result:{observation?\|artifact?}, error?}` |
| Poll action | `GET /v2/browser_sessions/:id/actions/:action_id` (after a `202`) |
| Artifact | `GET /v2/browser_sessions/:id/artifacts/:artifact_id` → `{artifact_id, download_url}` |
| Close | `DELETE /v2/browser_sessions/:id` → `{status:"closed"}` |

Execution failures ride HTTP 200 with `data.status: "failed"` and `data.error.code` ∈ `policy_denied`, `stale_observation`, `stale_ref`, `navigation_blocked`, `timeout`, `execution_lost`, `result_too_large`.

See [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/watchdog/API.md) for full request/response shapes and [GUIDE.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/watchdog/GUIDE.md) for the demo-mode vs. live-mode walkthrough.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `session create failed (429 quota_exceeded)` repeatedly | Org browser-session quota exhausted by other sessions | The actor already closes its own open session and retries after 60s; check `telnyx-edge actors list` for orphaned sessions and `DELETE` them. |
| `stale_ref persisted` thrown from the run | Page re-rendered twice within one run (e.g. `?render_wave=1`) | Expected failure path — the run files an incident note. Use `?render_wave=3` or higher so a single re-observe recovers. |
| `execution_lost: effect unproven` | Session died mid-action | Not retried blindly by design. The actor re-observes and verifies page state; if the session is `failed`/`expired` it opens a new one for the remainder of the run. |
| `TELNYX_API_KEY is not configured` | Secret not set on the deployed actor | `telnyx-edge secrets add TELNYX_API_KEY "<key>"` then `telnyx-edge ship`. |
| `missing TELNYX_PUBLIC_KEY — refusing unsigned webhook in live mode` | Webhook route live without the signing public key | `telnyx-edge secrets add TELNYX_PUBLIC_KEY "<key>"` (Portal → Messaging → Webhook signing → Public key). |
| `model did not return all four refs` | Model returned prose or partial JSON | Retry or pin a different `AI_MODEL`; the system prompt enforces strict JSON. |
| Session never reaches `ready` | Target unreachable from Telnyx's cloud, or host not in `allowed_domains` | Confirm the fixture is publicly deployed over `https://` — `localhost` will never work. |
| No SMS arrives in live mode | `DEMO_MODE` still `true`, or `FROM_NUMBER` unset | Set `DEMO_MODE=false` and a valid E.164 `FROM_NUMBER`; check the masked log line. |
| `status` shows `incomplete` for today's run | Actor was killed mid-run | Expected — the next activation re-arms the schedule and replays the run under the same `idempotency_key`. |
| `401 invalid_signature` from the webhook | Signature header missing or clock skew > 300s | Ensure the messaging profile posts to `/webhooks/messaging` and the host clock is sane. |

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Related Examples

- [`edge-customer-agent-typescript`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-customer-agent-typescript/README.md) — the `Agent` + plain-fetch router pattern this sample follows.
- [`edge-cron-scheduler`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-cron-scheduler/README.md) — `this.schedule()` / `this.every()` task dispatch on Edge actors.
- [`crew-cast`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/crew-cast/README.md) — Ed25519-verified messaging webhooks and per-actor durable state on Edge.
- [`event-sponsorship-agent`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/event-sponsorship-agent/README.md) — KV-indexed webhook routing to `idFromName` actors.
- [`agent-sms-triage-bot`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/agent-sms-triage-bot/README.md) — SMS intake + AI triage over inbound messages.

## Resources

- [Agent Browser overview](https://developers.telnyx.com/docs/agent-browser)
- [Agent Browser — getting started](https://developers.telnyx.com/docs/agent-browser/getting-started)
- [Agent Browser — sessions](https://developers.telnyx.com/docs/agent-browser/sessions)
- [Agent Browser — actions](https://developers.telnyx.com/docs/agent-browser/actions)
- [Agent Browser — observations](https://developers.telnyx.com/docs/agent-browser/observations)
- API reference: [create session](https://developers.telnyx.com/api-reference/browser-sessions/create-browser-session) · [get session](https://developers.telnyx.com/api-reference/browser-sessions/get-browser-session) · [close session](https://developers.telnyx.com/api-reference/browser-sessions/close-browser-session) · [execute action](https://developers.telnyx.com/api-reference/actions/execute-browser-action)
- [Agent SDK — Harness SDK](https://developers.telnyx.com/docs/agent-sdk/harness-sdk)
- [Telnyx Messaging](https://developers.telnyx.com/docs/messaging)
- [Telnyx Inference](https://developers.telnyx.com/docs/inference)
- [Telnyx pricing](https://telnyx.com/pricing)
