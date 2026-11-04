# Browser Watchdog — A Scheduled Web Check That Remembers

A walkthrough of the `watchdog` sample: a Telnyx Edge **Agent** that owns one web property's health check, remembers what "normal" looks like, wakes on a schedule, drives an isolated **Agent Browser** session, and asks an LLM whether the page actually works. On a broken verdict it files a dated incident in its SQL ledger and re-tests the broken step after a fix window.

Everything in this guide maps to `src/index.ts`. Functions are referenced by name (the file is small enough to read top-to-bottom in one sitting).

---

## 1. What you're building

The actor **is** the watch. One actor per watched hostname (`idFromName(hostname)`), holding:

- the watch config (`target_url`, `allowed_domains`, `owner_phone`),
- the known-good **baseline** (`price_text`, `form_labels[]`),
- a **run ledger** and an **incident ledger** in SQL,
- the schedule that re-arms itself every day.

The interesting question this sample answers is not "can an LLM click a button" — it's **"can a scheduled agent remember what normal looks like, prove when it broke, and prove when it was fixed?"** A stateless browser-agent demo cannot close an incident, because it cannot remember the break.

The demo narrative:

| Day | What happens |
| --- | --- |
| Tuesday | First run captures the baseline. Mid-run the page re-renders, the `fill` returns `stale_ref`, the actor re-observes and finishes. Verdict: `healthy`. |
| Wednesday | The price module reads `$0.00`. The LLM compares against the stored baseline, flags a mismatch, files an incident with the screenshot artifact. |
| Thursday | `recheck <incident_id>` re-drives the same flow, confirms the fix, closes the incident with before/after artifact ids. |

---

## 2. Prerequisites

- Node.js 20+
- A Telnyx account with an API key (`telnyx-edge auth api-key set <KEY>`)
- The `telnyx-edge` CLI (`npm i -g @telnyx/edge-runtime-cli` or use `npx telnyx-edge`)
- A public HTTPS page to watch. Agent Browser sessions run in Telnyx's cloud and **cannot reach `localhost`** — use the bundled `fixture/` static shop (deploy it anywhere static, or serve it straight from the worker's `GET /fixture` route), or any public read-and-form page.
- A phone number that can receive SMS (for live mode) and a Telnyx number to send from.

> **Beta note:** Agent Browser is a **beta REST surface**. There is no SDK client, so every call in this sample is a raw `fetch` to `https://api.telnyx.com/v2/browser_sessions*` mirroring the docs' curl shapes 1:1. The baseline/verdict prompts are demo constants, not API contracts — verify them against your own pages.

---

## 3. Project layout

```
watchdog/
├── src/index.ts                 # router + Watchdog actor + Agent Browser client
├── src/fixture-html.ts          # the fixture page, embedded (kept in sync by the smoke test)
├── fixture/index.html           # deployable static shop (budget field + contact form + knobs)
├── demo/browser-fixtures.json   # recorded Agent Browser envelopes replayed by DEMO_MODE
├── telnyx.toml                  # actor + storage + telnyx bindings
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── smoke_test.ts
├── README.md
├── API.md
└── GUIDE.md                     # this file
```

---

## 4. Environment setup

Copy `.env.example` to `.env` and fill in the placeholders:

| Variable | Purpose | Demo default |
| --- | --- | --- |
| `TELNYX_API_KEY` | Bearer token for the beta Agent Browser REST calls (live mode only) | not needed |
| `WATCH_TARGET_URL` | Base URL of the page to watch (your deployed fixture) | fixture placeholder |
| `WATCH_OWNER_PHONE` | Who receives alert SMS and may send `watch` / `status` / `recheck` | `+1555XXXXXXXX` |
| `FROM_NUMBER` | Telnyx number the alerts are sent from | `+1555XXXXXXXX` |
| `DEMO_MODE` | `true` (default) replays recorded fixtures offline; `false` runs live | `true` |
| `AI_MODEL` | Model name for the verdict turn | `moonshotai/Kimi-K2.6` |

Bindings live in `telnyx.toml`:

```toml
name = "watchdog"
main = "src/index.ts"
compatibility_date = "2026-07-28"

[edge_compute]
func_id   = "<func-uuid>"
func_name = "watchdog"

# The durable watchdog. One actor instance per watched hostname.
[[actors]]
binding = "WATCHDOG"
type    = "Watchdog"

# Zero-credential Telnyx API binding (platform injects auth at deploy time).
[telnyx]
binding = "TELNYX"

# Run + incident ledger owned by the watchdog actor.
[storage.sqldb.WATCHDOG_DB]
id = "<sqldb-namespace-uuid>"

# KV routing index: watch -> owner phone, owner -> watch ids, incident -> watch.
[storage.kv.WATCHDOG_INDEX]
id = "<kv-namespace-uuid>"

[[secrets]]
binding = "TELNYX_API_KEY"
name    = "TELNYX_API_KEY"

# Telnyx webhook signing public key (Ed25519). Required in live mode.
[[secrets]]
binding = "TELNYX_PUBLIC_KEY"
name    = "TELNYX_PUBLIC_KEY"

[env_vars]
DEMO_MODE = "true"
AI_MODEL = "moonshotai/Kimi-K2.6"
WATCH_TARGET_URL = "https://your-fixture-host.example.com/"
WATCH_OWNER_PHONE = "+1555XXXXXXX"
FROM_NUMBER = "+1555XXXXXXX"
```

The `[telnyx]` binding carries **no API key** — the platform injects the credential, so `this.env.TELNYX.messages.send(...)` and `this.env.TELNYX.ai.openai.chat.createCompletion(...)` just work. The raw Agent Browser `fetch` calls need the key from `SECRETS`.

Regenerate the typed env after editing `telnyx.toml`:

```bash
npx telnyx-edge types
```

---

## 5. Run it

### Demo mode (default — no network, no SMS, no charges)

```bash
npm install
npx telnyx-edge types
npm run deploy          # telnyx-edge ship
```

`DEMO_MODE=true` stubs the Agent Browser REST calls against `demo/browser-fixtures.json` (real observation envelopes — trees, refs, artifact ids — captured from a live run) and derives the verdict locally, so the full loop — baseline → `stale_ref` recovery → broken verdict → incident → fix-close — runs end-to-end offline. SMS replies are printed to the actor log with the phone number masked.

### Live mode

```bash
npx telnyx-edge secrets add TELNYX_API_KEY "<your-key>"
# set DEMO_MODE=false in your environment / telnyx.toml [env_vars]
npm run deploy
```

Now `browser()` hits the real beta API and `extract()` / `judge()` call the `TELNYX` inference binding.

### Smoke test

```bash
npx tsx smoke_test.ts
```

The smoke test boots the actor over an in-memory Edge environment (real SQLite via `node:sqlite`) and exercises the acceptance-criteria behaviors: the demo loop end-to-end, crash-resume with no duplicate incident, owner authorization, live-mode signature refusal, and the fixture/demo-fixture invariants — no network, no credentials.

### Drive it

```bash
# arm a watch (creates the actor, saves config, arms the daily schedule)
curl -X POST https://<your-worker>/watch \
  -H 'content-type: application/json' \
  -d '{"url":"https://demo-shop.example.com/pricing","owner":"+15551234567"}'

# read the ledger (must present the owner as ?owner=)
curl "https://<your-worker>/status/demo-shop.example.com?owner=%2B15551234567"

# the fixture page the live run drives (works in demo mode too)
curl https://<your-worker>/fixture

# health
curl https://<your-worker>/health
```

Or just text the number: `watch https://demo-shop.example.com/pricing`, then `status`, then `recheck now`. Inbound SMS commands arrive on `POST /webhooks/messaging` and are Ed25519-verified in live mode; only the watch's owner phone can command or read the actor.

---

## 6. Walkthrough

### 6.1 The router — `src/index.ts` default export

A plain-fetch router with five routes:

- `GET /health` → `{ ok: true, demo_mode }`
- `GET /fixture` → serves the bundled static shop (identical to `fixture/index.html`; the smoke test enforces the sync)
- `POST /watch` → validates the URL (absolute, `https://`), resolves the actor via `idFromName(watchId(url))`, and forwards to `actor.fetch("/arm")`
- `GET /status/:id` → verifies the sender against the watch's owner, then forwards to `/status`
- `POST /webhooks/messaging` → inbound SMS webhook; see §6.4

The router never touches SQL or the browser API itself — it only resolves the actor stub and forwards. That keeps the durable entity the single owner of state.

### 6.2 Actor identity — `watchId()` + `idFromName`

```ts
export function watchId(targetUrl: string): string {
  return new URL(targetUrl).hostname;
}
```

One actor per watched **hostname**. `env.WATCHDOG.idFromName(watchId(url))` returns the same durable stub every time, so `watch https://shop.example.com/pricing` and `watch https://shop.example.com/checkout` land on the same watchdog — which is what you want, because the baseline is per-property, not per-path.

### 6.3 Actor state — `initialState()` / `WatchdogState`

```ts
export interface WatchdogState {
  target_url: string;
  allowed_domains: string[];
  baseline: Baseline | null;      // { price_text, form_labels[] }
  last_verdict: string | null;
  last_run_at: string | null;
  schedule_id: string | null;
  open_session_id: string | null; // for the 429 close-then-retry loop
  owner_phone: string;
}
```

State holds the **config and the baseline**. Incidents and run history live in SQL rows, not state — they grow unboundedly and need querying (`status`, `recheck <id>`). `setState()` is merge-patch, so `this.setState({ baseline })` updates only that field.

### 6.4 SMS intake — `POST /webhooks/messaging`

Inbound SMS arrives as a Telnyx messaging webhook and is handled in two steps.

**Signature verification.** The route reads `telnyx-signature-ed25519` + `telnyx-timestamp`, recomputes the Ed25519 signature over `${timestamp}|${rawBody}` with `TELNYX_PUBLIC_KEY`, and rejects anything that does not verify (`401`). In live mode a missing key refuses unsigned deliveries outright (`503`); in demo mode an unsigned webhook is accepted with a logged warning so the flow can be exercised offline.

**Command dispatch.** `message.received` payload (`data.payload.from.phone_number`, `data.payload.text`) is parsed by `parseCommand()` and routed by `dispatchSmsCommand()`:

| Command | Effect |
| --- | --- |
| `watch <url>` | `arm()` — save config, seed the KV index, arm the schedule |
| `status [url]` | `statusReport()` — last 3 runs + open incidents |
| `recheck now [url]` | `runCheck({ reason: "manual", target_url })` — force a run, optional one-shot URL override |
| `recheck <incident_id>` | `runCheck({ reason: "verify", incident_id })` — fix-verification run for that incident |

**Authorization.** Only the watch's owner may command it. The worker checks the sender against the KV index (`watch:<id>` → owner phone, `owner:<phone>` → watch ids) and the actor re-checks against its own durable `owner_phone` state. Unknown senders are refused (`403`) before anything is armed, run, or read — an untrusted text can never burn a paid browser session. When `WATCH_OWNER_PHONE` is unset, the first sender to arm a watch becomes its owner.

The optional URL override on `recheck now` is what makes the broken-price scenario reproducible any day: point it at `?price=0.00` without re-arming the watch. URL-less commands resolve through the KV index — one watch per owner routes directly; several watches ask the owner to specify the target URL.

### 6.5 Arming the watch — `arm()`

`arm()` does **not** create a browser session. It:

1. validates the URL (must be `https://`),
2. `replaceState({ target_url, allowed_domains: [hostname], owner_phone, baseline: keep-if-same-host })` — a re-arm of the same property keeps the stored baseline (the baseline is per-property, so re-pointing the same host at `?price=0.00` must not wipe it); a new host starts from scratch,
3. seeds the KV routing index (`watch:<id>` → owner phone, `owner:<phone>` → watch ids),
4. arms the recurring schedule with a **stable id**: `this.every(86400, "runCheck", { reason: "scheduled" }, { id: "daily-<watch>" })` — re-arming with the same id replaces the prior task instead of stacking a second daily timer,
5. schedules the first run in 5 seconds (`schedule(5, "runCheck", { reason: "first" }, { id: "first-<watch>" })`),
6. replies with a confirmation SMS.

This is design decision #3: **the baseline is captured on the first scheduled run, not at watch time.** It matches the demo narrative (Tuesday = day 1 baseline) and avoids burning a browser session just to acknowledge an SMS.

### 6.6 The scheduled run — `runCheck()`

This is the heart of the actor. In order:

1. **Guard** — bail if `target_url` is empty.
2. **Idempotency key** — `runKey` is the UTC run date for scheduled/first runs, or `<date>#<reason>` for manual/verify/retry runs.
3. **Prior-verdict check** — `SELECT verdict FROM runs WHERE run_key = ?`. If a verdict already exists and this is a scheduled/first run, return. This is the crash-resume guard: a re-activated actor re-arms the schedule, sees the run row incomplete (no verdict), and re-runs it with the same `idempotency_key` — the session replay returns the original, no duplicate session, no double-filed incident.
4. **Reset the per-run demo replay state** — an instance field, never a module-level global, so concurrent watches in one isolate can never interfere with each other's recorded `stale_ref`.
5. **Insert the run row** — `INSERT INTO runs (...) ON CONFLICT(run_key) DO NOTHING`.
6. **Open a session** — `openSession()`.
7. **Drive the page** — `drive()`.
8. **Judge** — `judge(pricingObservation, baseline)` against the pre-submit pricing observation.
9. **Capture the baseline** if none exists and the verdict is healthy.
10. **Record the run** — `recordRun()`.
11. **File or close an incident** — `fileIncident()` on broken, `closeIncident()` on healthy.
12. **`finally`** — `DELETE /browser_sessions/:id` after every run, successful or not.

Errors are caught, written to the run row's `reason`, and reported to the owner by SMS.

### 6.7 Opening a session — `openSession()`

```ts
POST /browser_sessions
{
  policy: { allowed_domains: [hostname] },
  limits: { lifetime_s: 900, idle_timeout_s: 120 },
  idempotency_key: runKey
}
```

The domain policy is scoped to the watched hostname — the session physically cannot navigate elsewhere. The `idempotency_key` is the run key, so a retried run reuses the same session instead of creating a duplicate.

**Quota handling (design decision #6):** a `429 quota_exceeded` is retryable. The actor closes any of its own still-open sessions first (`DELETE /browser_sessions/:id`), clears `open_session_id`, then `this.schedule(60, "runCheck", { reason: "retrySession", run_key: runKey })` — a 60-second backoff, never a hot retry. The retry reuses the same `run_key`, so the idempotency guard still holds.

### 6.8 The action loop — `drive()`

```
navigate(target, wait_until: "dom_stable")
  → observe()            → observation_id + refs + tree
  → extract()            → price_text, form_labels, refs (LLM or regex)
  → fill(price_ref)      → may fail stale_ref
      ↳ on stale: observe() again → extract() again → fill() once more
  → fill(name_ref, "Watchdog Bot")
  → fill(email_ref, "watchdog@example.com")
  → click(submit_ref)
  → observe()            → success-state text
  → screenshot()         → artifact_id
  → GET .../artifacts/:id → download_url
```

**`stale_ref` recovery (design decision #7):** `fill` returning `data.error.code: "stale_ref"` (HTTP 200, action status `failed`) is not an exception — it's a normal execution failure. The actor immediately re-`observe`s (fresh `observation_id` + refs), re-picks the price ref, and retries the fill **once**. A second consecutive staleness throws and files an **incident note** instead of a verdict. `staleRecovered` is recorded on the run row so `status` can show it.

**`execution_lost` is never blindly resubmitted.** The docs are explicit that a lost execution has an unproven effect, so both mutation helpers verify before retrying:

- **`fillWithRecovery()`** — on a lost fill: read the session status (a terminal `failed`/`expired` session throws `SessionLostError` and `runCheck()` opens a fresh one), re-observe, and if the fresh tree already shows the fill value the effect landed and no retry happens; otherwise re-fill with a fresh observation id and current ref.
- **`verifyAndResumeClick()`** — same idea for the submit click: re-observe; if the page already shows the success state, the click landed; otherwise re-click with a fresh observation.

If the session itself is `failed`/`expired`, `runCheck()` opens a new session under a `#recovered` idempotency key and drives the remainder of the run there.

### 6.9 The LLM turns — `extract()` and `judge()`

Two inference calls, both via the `TELNYX` binding:

```ts
this.env.TELNYX.ai.openai.chat.createCompletion({
  model: this.env.AI_MODEL || "moonshotai/Kimi-K2.6",
  messages: [system, user],
})
```

- **`extract()`** — "which ref is the price element?" It sees the observation `tree` + `refs` and returns strict JSON `{ price_text, form_labels[], refs: { price, name, email, submit } }`. Ref-picking is the same turn as price extraction.
- **`judge()`** — sees the stored baseline + the new observation tree and returns strict JSON `{ verdict: "healthy"|"broken", reason, price_text }`.

Both use `parseJson()` to strip code fences and fall back safely. The system prompt is *"Reply with strict JSON only, no prose, no code fences."*

**Baseline capture:** if `baseline` is `null`, `judge()` returns `healthy` with the extracted `price_text` and `form_labels` — that observation *becomes* the known-good baseline. Only those two fields are stored; the full tree is not.

In demo mode both functions short-circuit: `extract()` regexes `$X.XX` out of the tree, `judge()` string-compares against the baseline. No network, no model call.

### 6.10 Recording the run — `recordRun()`

One `UPDATE runs` writes the verdict, reason, price text, screenshot artifact id, screenshot download URL, observation id, refs JSON, the `stale_recovered` flag, and `finished_at`. Everything a human needs to audit the run lives in one row.

### 6.11 Incidents — `fileIncident()` / `closeIncident()`

**`fileIncident()`** is keyed by run date:

```ts
const existing = await this.rows("SELECT id FROM incidents WHERE run_date = ?", runDate);
if (existing.length > 0) return;
const incidentId = `${runDate}#${firstBrokenAt}`;
```

The upsert key is `run_date` + `first_broken_at`, so a crash-resumed run can never double-file. The incident stores `before_artifact_id` (Wednesday's screenshot) and sends the alert SMS with the download URL.

**`closeIncident()`** finds the most recent open incident, sets `status = 'closed'`, writes `after_artifact_id` (Thursday's screenshot), stamps `closed_at`, and sends the "FIXED" SMS with both artifact ids.

This is the load-bearing part of the demo: Thursday's run knows *which* Wednesday incident it is closing because the incident lives in the actor's SQL ledger, not in a model's context window.

### 6.12 Status report — `statusReport()`

Reads the last 3 runs and all open incidents from SQL and formats a multi-line reply:

```
Watch: https://demo-shop.example.com/pricing
Baseline: $24.00
Last runs: 2026-07-28: healthy | 2026-07-29: broken (price mismatch: expected $24.00, saw $0.00) | ...
Open incidents: 2026-07-29#2026-07-29T14:02:11Z: price mismatch...
```

### 6.13 SMS replies — `smsReply()`

```ts
if (isDemo(this.env)) {
  console.log(`[demo] SMS to ${maskPhone(target)}: ${text}`);
  return;
}
await this.env.TELNYX.messages.send({ to: target, from: this.env.FROM_NUMBER ?? "", text });
```

Demo mode logs with the phone number masked (`maskPhone()` keeps only the last four digits). Live mode sends through the zero-credential `TELNYX` binding. No credentials are ever logged.

### 6.14 SQL schema — `ensureSchema()`

Two tables, created idempotently on every entry point:

```sql
CREATE TABLE IF NOT EXISTS runs (
  run_key TEXT PRIMARY KEY, run_date TEXT NOT NULL, target_url TEXT NOT NULL,
  verdict TEXT, reason TEXT, price_text TEXT, screenshot_artifact_id TEXT, screenshot_url TEXT,
  observation_id TEXT, refs_json TEXT, stale_recovered INTEGER DEFAULT 0,
  started_at TEXT NOT NULL, finished_at TEXT);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY, run_date TEXT NOT NULL, first_broken_at TEXT NOT NULL, reason TEXT NOT NULL,
  before_artifact_id TEXT, after_artifact_id TEXT, status TEXT NOT NULL DEFAULT 'open', closed_at TEXT);
```

All queries are parameterized (`prepare(...).bind(...)`). `rows()` and `run()` are thin wrappers over `WATCHDOG_DB`.

### 6.15 The browser transport — `browser()`

One function, two modes:

- **Demo** — `demoBrowser(method, path, body)` replays the envelopes recorded in `demo/browser-fixtures.json`: session create → `bs_rec_7f3a91c2`, provisioning poll → `ready`, observe → recorded pricing/post-submit observations with their recorded `picked_refs`, the first price `fill` → `stale_ref`, the screenshot → `202 running` then the polled artifact envelope, artifact GET → the recorded `download_url`. The demo keeps this state in a per-actor instance field (never module-level), and applies the URL's `?price=` override to the recorded trees exactly the way the fixture page renders it.
- **Live** — reads `TELNYX_API_KEY` from `SECRETS`, `fetch`es `https://api.telnyx.com/v2${path}` with a Bearer header, and unwraps the `{ data, error }` envelope.

The `?price=` query param therefore produces a `$0.00` tree and a broken verdict in demo mode too — the Wednesday scenario, on demand.

### 6.16 The fixture — `fixture/index.html`

The page the live run drives. It is a single self-contained HTML file (no external assets), so it deploys to any static host — or is served by the worker itself at `GET /fixture`, built from the same content via `src/fixture-html.ts`. The smoke test fails if the two copies drift apart.

It contains exactly what the watch needs:

- the **price module** — an editable budget field rendered as `$24.00`, which the LLM picks as the price ref and the fill uses to exercise the interaction loop;
- the **contact form** — `name`, `email`, and a submit button whose post-submit success state the post-submit observation captures;
- **`?render_wave=N`** — rebuilds the `<main>` section `N` seconds after load, replacing every element instance, so any observation the actor is still holding goes stale → `stale_ref`;
- **`?price=X.XX`** — overrides the rendered price (`?price=0.00` reproduces the broken-verdict demo on any day).

### 6.17 Crash resume

Kill the actor between the screenshot and the verdict write and re-activate it:

1. The schedule re-arms (`every()` is durable).
2. `runCheck()` sees the run row exists but has no `verdict`.
3. It re-runs with the same `run_key` → the same `idempotency_key` → the session replay returns the original session, no duplicate.
4. `fileIncident()` checks `run_date` before inserting — no duplicate incident.
5. The baseline in state is untouched.

That's the acceptance criterion "actor restart mid-run: schedule re-arms, no duplicate incident, baseline intact."

---

## 7. The error model

Agent Browser execution failures ride **HTTP 200** with `data.status: "failed"` and `data.error.code`. This sample handles them explicitly:

| Code | Meaning | Recovery in this sample |
| --- | --- | --- |
| `stale_ref` | The ref no longer points at the element (page re-rendered) | Re-`observe`, re-pick the ref, retry the fill **once** |
| `stale_observation` | The whole observation is stale | Same — re-`observe` and continue |
| `execution_lost` | Effect unproven | **Never** blindly resubmit — re-observe, verify page state, open a new session if the old one is `failed`/`expired` |
| `policy_denied` | Navigation outside `allowed_domains` | Fails the run; the domain policy is intentional |
| `navigation_blocked` | Target refused the navigation | Fails the run, reported by SMS |
| `timeout` | Action exceeded its wait | Fails the run |
| `result_too_large` | Observation exceeded 256 KiB | Fails the run — narrow the page or the observation |
| `429 quota_exceeded` | Org session quota hit | Close own open sessions, `schedule(60, "retrySession")`, retry with the same `run_key` |

---

## 8. Demo mode vs live mode

| | Demo (`DEMO_MODE=true`, default) | Live (`DEMO_MODE=false` + `TELNYX_API_KEY`) |
| --- | --- | --- |
| Browser sessions | `demoBrowser()` fixtures | `POST https://api.telnyx.com/v2/browser_sessions` |
| `stale_ref` | Deliberately served on the first price `fill` | Real, from the fixture's `?render_wave=N` re-render |
| Verdict | Local regex + string compare | `TELNYX.ai.openai.chat.createCompletion` |
| SMS | Logged, phone masked | `TELNYX.messages.send` |
| Charges | None | Real session minutes + SMS |
| Network | None | Telnyx API |

Switch by setting `DEMO_MODE=false` and adding the `TELNYX_API_KEY` secret. Nothing else changes — the actor, the ledger, and the recovery rules are identical in both modes.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `session create failed (401 ...)` | Missing or wrong `TELNYX_API_KEY` | `npx telnyx-edge secrets add TELNYX_API_KEY "<key>"` |
| `session create failed (429 quota_exceeded)` | Org session quota | Expected — the actor closes its own sessions and retries in 60s |
| `stale_ref persisted` | The page re-rendered twice in a row | Increase `wait_until: "dom_stable"` tolerance or slow the fixture's `?render_wave` |
| `execution_lost: effect unproven` | The action's effect is unknown | Re-observe and verify page state; do not resubmit blind |
| `policy_denied` | The page redirected off the watched hostname | Add the redirect host to `allowed_domains` |
| Baseline never captured | First run failed before `judge()` | Check `status` — the run row will show the failure reason |
| No SMS in demo mode | Expected | Demo mode logs to the actor console with the number masked |
| `localhost` target never loads | Agent Browser runs in Telnyx's cloud | Deploy the `fixture/` to a public HTTPS host |

---

## 10. Next steps

- [Agent Browser overview](https://developers.telnyx.com/docs/agent-browser) — the beta surface this sample drives
- [Get started](https://developers.telnyx.com/docs/agent-browser/getting-started) — auth, first session
- [Sessions](https://developers.telnyx.com/docs/agent-browser/sessions) — policy, limits, lifecycle, `429` handling
- [Actions](https://developers.telnyx.com/docs/agent-browser/actions) — `navigate`, `observe`, `fill`, `click`, `screenshot`, `batch`
- [Observations](https://developers.telnyx.com/docs/agent-browser/observations) — trees, refs, and why refs beat pixels
- API reference: [create session](https://developers.telnyx.com/api-reference/browser-sessions/create-browser-session) · [get session](https://developers.telnyx.com/api-reference/browser-sessions/get-browser-session) · [close session](https://developers.telnyx.com/api-reference/browser-sessions/close-browser-session) · [execute action](https://developers.telnyx.com/api-reference/actions/execute-browser-action)
- [Agent SDK — Harness SDK](https://developers.telnyx.com/docs/agent-sdk/harness-sdk) — `Agent`, `schedule()`, `every()`, SQL, and the `TELNYX` binding

Ideas to extend the sample:

- Watch multiple paths on the same hostname and store a baseline per path.
- Add a `?render_wave=N` knob to the fixture to tune how aggressive the `stale_ref` demo is.
- Swap the price check for a checkout-flow check (add to cart → checkout → assert the total).
- Fan out to a second actor per region and compare baselines.
- Push incidents into a Telnyx queue or a webhook instead of SMS-only alerts.

Fingerprint: `cs23:sonam:agent-browser-watchdog`
