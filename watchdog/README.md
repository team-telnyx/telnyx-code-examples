---
name: watchdog
title: "Browser Watchdog — Scheduled Web Checks With a Memory"
description: "A durable Telnyx Edge actor that watches one web property, remembers what normal looks like, and proves when it broke and when it was fixed."
language: typescript
framework: edge
telnyx_products: [Agent Browser, AI, Messaging, Edge Runtime]
---

# Browser Watchdog

A durable Telnyx Edge actor that owns one web property's health check — it remembers the baseline, wakes on a schedule, drives an isolated Agent Browser session, and files dated incidents it can later close.

## The Story

The head of e-commerce at a 40-person direct-to-consumer skincare brand checks the storefront pricing page every morning before standup, because a price module that renders `$0.00` or a contact form that silently stops submitting costs real orders and, worse, real trust — customers screenshot the broken page and post it. Nobody on a five-person team can babysit a page 365 days a year, and a generic uptime pinger only proves the HTML came back, not that the price is still the right number or the form still submits. The actor IS the browser watchdog. It is born the moment the owner texts `watch https://shop.example.com/pricing`, and on its first scheduled run it opens a real browser session, drives the page, and quietly writes down what "normal" looks like — the price text and the form labels — as its baseline. Every day after that it wakes, re-drives the same flow, and asks a model whether what it sees still matches what it remembers; when Wednesday's run finds the price module at `$0.00` it files a dated incident with the screenshot attached, and when Thursday's run comes back clean it closes that same incident with before-and-after artifact ids. The edge runtime recycles the pod between the screenshot and the verdict write — the watchdog comes back up, re-arms its schedule, sees the incomplete run row, replays it under the same idempotency key, and never double-files the incident, because the baseline and the incident history live in its own state and SQL ledger rather than in a process's memory. The rest of this README is the API surface of that story.

## Why Telnyx

A watchdog is only useful if it can act on what it finds, and that means three things living in one place: a durable actor that survives restarts, a browser that runs in the cloud (not on the operator's laptop), and a messaging + inference layer that turns a verdict into a text message. Telnyx provides all three as **AI Communications Infrastructure** — the Edge runtime hosts the actor and its SQL ledger, Agent Browser provides the isolated, policy-scoped browser session with JSON observations and refs instead of pixels, and the zero-credential `TELNYX` binding carries both the alert SMS and the model turn that decides healthy vs. broken. No separate browser-farm vendor, no separate SMS vendor, no API keys threaded through the actor.

> **Beta notice:** Agent Browser is a **beta** REST surface. Request/response shapes, action types, and error codes may change. The baseline-extraction and verdict prompts in this sample are demo constants, not API contracts — verify them against the current docs before relying on them in production.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose in this sample |
|----------|--------|-----------------------|
| `/v2/browser_sessions` | `POST` | Create the run's isolated session — `policy.allowed_domains`, `limits.lifetime_s`/`idle_timeout_s`, `idempotency_key` = run key |
| `/v2/browser_sessions/:id` | `GET` | Read session status (`provisioning → ready → closed\|failed\|expired`) |
| `/v2/browser_sessions/:id/actions` | `POST` | The action loop — `navigate`, `observe`, `fill`, `click`, `screenshot` |
| `/v2/browser_sessions/:id/artifacts/:artifact_id` | `GET` | Resolve a screenshot `artifact_id` to a `download_url` stored in the run row |
| `/v2/browser_sessions/:id` | `DELETE` | Close the session in a `finally` path after every run |
| `/v2/messages` | `POST` | Alert + reply SMS via `this.env.TELNYX.messages.send()` (zero-credential binding) |
| `/v2/ai/chat/completions` | `POST` | Ref-picking and the healthy/broken verdict via `this.env.TELNYX.ai.openai.chat.createCompletion()` |

## Architecture

```
 owner SMS / HTTP                    Telnyx Edge
 ────────────────                   ────────────
 "watch https://…"   ──────▶  POST /watch   ──▶  Watchdog actor  (idFromName(hostname))
 "status"            ──────▶  GET /status/:id         │
 "recheck now [url]" ──────▶  (SMS intake)            │  state:
 "recheck <incident>"                                 │    target_url, allowed_domains,
                                                      │    baseline { price_text, form_labels[] },
                                                      │    last_verdict, schedule_id, open_session_id
                                                      │
                                            every(86400) ──▶ runCheck()
                                                      │
                                      ┌───────────────┴─────────────────┐
                                      ▼                                 ▼
                          Agent Browser (beta REST)            TELNYX binding
                          POST /browser_sessions               ai.openai.chat
                            navigate → observe                   (pick refs, judge vs baseline)
                            → fill (stale_ref? re-observe)       messages.send
                            → click → observe → screenshot         (alert + replies)
                                      │
                                      ▼
                          WATCHDOG_DB  (SQL ledger)
                            runs       (run_key, verdict, reason, price_text,
                                        screenshot_artifact_id, screenshot_url,
                                        observation_id, refs_json, stale_recovered)
                            incidents  (id, run_date, first_broken_at, reason,
                                        before_artifact_id, after_artifact_id, status)
```

**One actor per watched property.** `idFromName(watchId(url))` derives the actor id from the target hostname, so `watch https://shop.example.com/pricing` and `watch https://shop.example.com/contact` are the same watch, and a second `watch` for a different host is a different, independent watchdog.

**The run loop** (`runCheck`):

1. Look up the run row by `run_key` (the UTC run date for scheduled runs). If a verdict already exists, the run is a no-op — this is the crash-resume guard.
2. `POST /browser_sessions` with `allowed_domains: [host]`, `limits: { lifetime_s: 900, idle_timeout_s: 120 }`, `idempotency_key: run_key`.
3. `navigate` (`wait_until: "dom_stable"`) → `observe` → LLM picks the price/name/email/submit refs.
4. `fill` the price ref. If it returns `stale_ref` (HTTP 200, `data.status: "failed"`), re-`observe` for a fresh `observation_id` + refs, re-pick, retry **once**. A second consecutive staleness fails the run.
5. Fill `name` + `email`, `click` submit, `observe` the success state, `screenshot` → `artifact_id` → `GET .../artifacts/:id` → `download_url`.
6. LLM verdict against the stored baseline → `healthy` or `broken(reason)`.
7. Write the run row. `broken` → upsert a dated incident (keyed by run date) + alert SMS. `healthy` with an open incident → close it with before/after artifact ids.
8. `DELETE /browser_sessions/:id` in a `finally` block, always.

**Error model.** `stale_ref` / `stale_observation` are HTTP 200 execution failures — recover by re-observing, never by resubmitting the same ref. `execution_lost` is never blindly resubmitted (the effect is unproven); the actor re-observes and verifies page state first, and opens a fresh session if the old one is `failed`/`expired`. `429 quota_exceeded` on session create is handled by closing the actor's own still-open session, `schedule(60, "runCheck", …)`, and retrying the same run key — never a hot retry.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `WATCH_TARGET_URL` | `string` | `https://your-fixture.example.com/` | no | Default target used when no URL is supplied to `POST /watch`. Must be a public `https://` URL — Agent Browser sessions run in Telnyx's cloud and cannot reach `localhost`. | Your deployed fixture (see Setup) |
| `WATCH_OWNER_PHONE` | `string` | `+1555XXXXXXXX` | no | E.164 number that receives alerts and is allowed to send `watch` / `status` / `recheck` commands. | Your Telnyx number or personal phone |
| `FROM_NUMBER` | `string` | `+1555XXXXXXXX` | no (required for live SMS) | E.164 Telnyx number the alert SMS is sent from. | [Telnyx Portal → Numbers](https://portal.telnyx.com/#/numbers) |
| `DEMO_MODE` | `string` | `true` | no | `true` (default) replays recorded Agent Browser fixtures and derives the verdict locally — no API calls, no SMS. `false` drives the live beta API and the `TELNYX` binding. | — |
| `AI_MODEL` | `string` | `DeepSeek-V4.1-Flash` | no | Model used for ref-picking and the verdict turn. | [Telnyx AI models](https://developers.telnyx.com/docs/inference/models) |

`TELNYX_API_KEY` is read from the `SECRETS` binding inside the actor (`await this.env.SECRETS.get("TELNYX_API_KEY")`) — set it with `telnyx-edge secrets add`, not by committing a `.env`.

## Setup

### 1. Clone and install

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/watchdog
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in `WATCH_TARGET_URL`, `WATCH_OWNER_PHONE`, and `FROM_NUMBER`. Leave `DEMO_MODE=true` for the offline walkthrough.

### 3. Deploy the demo fixture (required for live mode)

Agent Browser sessions run in Telnyx's cloud, so the target must be publicly reachable. The `fixture/` directory contains a single-page static shop with:

- a price module and a contact form (`name`, `email`, submit)
- `?render_wave=N` — re-renders the form after `N` seconds, deliberately triggering `stale_ref`
- `?price=0.00` — flips the price to reproduce the broken-verdict demo on any day

Deploy it to any static host (GitHub Pages, Netlify, S3) and point `WATCH_TARGET_URL` at the deployed base URL. The `.env.example` default is a placeholder — replace it.

### 4. Authenticate and deploy the actor

```bash
telnyx-edge auth api-key set <YOUR_TELNYX_API_KEY>
telnyx-edge secrets add TELNYX_API_KEY "<YOUR_TELNYX_API_KEY>"
telnyx-edge types          # regenerate telnyx-env.d.ts from telnyx.toml bindings
telnyx-edge ship           # deploy
```

### 5. Run the smoke test

```bash
npx tsx smoke_test.ts
```

The smoke test imports `src/index.ts`, asserts the `Watchdog` class and the fetch handler load, and exercises the demo-mode helpers — no network, no credentials.

### 6. Drive the demo

```bash
# arm a watch (HTTP path)
curl -X POST https://<your-worker-url>/watch \
  -H 'content-type: application/json' \
  -d '{"url":"https://your-fixture.example.com/","owner":"+1555XXXXXXXX"}'

# or by SMS from the owner phone
#   watch https://your-fixture.example.com/
#   status
#   recheck now https://your-fixture.example.com/?price=0.00
#   recheck <incident_id>
```

The first run captures the baseline (no comparison yet). Point `recheck now` at the `?price=0.00` override to reproduce Wednesday's broken verdict on demand, then `recheck now` against the clean URL to close the incident.

## API Reference

### Worker routes

| Route | Method | Body / Params | Response |
|-------|--------|---------------|----------|
| `/health` | `GET` | — | `200 {"ok":true,"demo_mode":true}` |
| `/watch` | `POST` | `{"url": "https://…", "owner": "+1555…"}` | `202 {"ok":true,"watch_id":"shop.example.com"}` · `400` on missing/invalid URL |
| `/status/:watch_id` | `GET` | `watch_id` = target hostname | `200 {"status":"Watch: …\nBaseline: …\nLast runs: …\nOpen incidents: …"}` |

### SMS commands

| Command | Effect |
|---------|--------|
| `watch <url>` | Validates `https://`, stores config + `allowed_domains`, arms `every(86400, "runCheck")` and a first run in ~5s. Does **not** create a browser session. |
| `status` | Replies from the actor's own SQL: watch URL, baseline price, last 3 runs, open incidents. |
| `recheck now [url]` | Forces an immediate run; optional one-shot URL override (e.g. `?price=0.00`). |
| `recheck <incident_id>` | Fix-verification run — identical flow, closes the incident on a healthy verdict. |

### Agent Browser calls made by the actor

| Call | Shape |
|------|-------|
| Create session | `POST /v2/browser_sessions` → `{policy:{allowed_domains:[host]}, limits:{lifetime_s:900, idle_timeout_s:120}, idempotency_key:<run_key>}` → `201 {id, status}` |
| Action | `POST /v2/browser_sessions/:id/actions` → `{type:"navigate"\|"observe"\|"fill"\|"click"\|"screenshot", …}` → `200 {status, observation_id?, refs?, tree?, artifact_id?, error?}` |
| Artifact | `GET /v2/browser_sessions/:id/artifacts/:artifact_id` → `200 {artifact_id, download_url}` |
| Close | `DELETE /v2/browser_sessions/:id` → `200 {id, status:"closed"}` |

Execution failures ride HTTP 200 with `data.status: "failed"` and `data.error.code` ∈ `policy_denied`, `stale_observation`, `stale_ref`, `navigation_blocked`, `timeout`, `execution_lost`, `result_too_large`.

See [API.md](./API.md) for full request/response shapes and [GUIDE.md](./GUIDE.md) for the demo-mode vs. live-mode walkthrough.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `session create failed (429 quota_exceeded)` repeatedly | Org browser-session quota exhausted by other sessions | The actor already closes its own open session and retries after 60s; check `telnyx-edge actors list` for orphaned sessions and `DELETE` them. |
| `stale_ref persisted` thrown from the run | Page re-rendered twice within one run (e.g. `?render_wave=1`) | Expected failure path — the run files an incident note. Use `?render_wave=3` or higher so a single re-observe recovers. |
| `execution_lost: effect unproven` | Session died mid-action | Not retried blindly by design. The actor re-observes and verifies page state; if the session is `failed`/`expired` it opens a new one for the remainder of the run. |
| `TELNYX_API_KEY is not configured` | Secret not set on the deployed actor | `telnyx-edge secrets add TELNYX_API_KEY "<key>"` then `telnyx-edge ship`. |
| Session never reaches `ready` | Target unreachable from Telnyx's cloud, or host not in `allowed_domains` | Confirm the fixture is publicly deployed over `https://` — `localhost` will never work. |
| No SMS arrives in live mode | `DEMO_MODE` still `true`, or `FROM_NUMBER` unset | Set `DEMO_MODE=false` and a valid E.164 `FROM_NUMBER`; check the masked log line. |
| `status` shows `incomplete` for today's run | Actor was killed mid-run | Expected — the next activation re-arms the schedule and replays the run under the same `idempotency_key`. |
| `unparseable model output` verdict | Model returned prose instead of strict JSON | The system prompt enforces JSON-only; if it persists, pin a different `AI_MODEL`. |

## Agent Discovery

- [Agent signup](https://telnyx.com/agent-signup.md) — get an agent-ready Telnyx account
- [team-telnyx/ai](https://github.com/team-telnyx/ai) — agent tooling, SDKs, and reference implementations
- [llms.txt](https://developers.telnyx.com/llms.txt) — machine-readable index of the Telnyx developer docs

## Related Examples

- **Agent Browser quickstart** — the minimal session → observe → act loop this sample builds on
- **Stateful Actor scheduling** — `every()` / `schedule()` patterns for recurring durable work
- **SMS intake and replies** — parsing inbound commands and answering from actor SQL
- **Inference over structured observations** — using the `TELNYX` binding's OpenAI-compatible chat surface for strict-JSON verdicts

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
