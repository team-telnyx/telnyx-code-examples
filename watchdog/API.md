# API Reference — Browser Watchdog

Typed contract for the `watchdog` Edge sample. Everything below is derived from `src/index.ts`; nothing here is aspirational.

The sample exposes **five HTTP routes** (plain-fetch router), an **SMS command surface** on `POST /webhooks/messaging`, and a **scheduled task surface** (`runCheck`). All three are part of the public contract.

- **Base URL:** `https://<your-edge-deployment-host>` (the host printed by `telnyx-edge ship`)
- **Content type:** `application/json` on every request and response body
- **Auth:** the actor authenticates *outbound* to Telnyx with `TELNYX_API_KEY` from `SECRETS`, and the `[telnyx]` binding carries runtime-injected credentials. SMS commands are authorized against the watch's owner phone; the webhook route is Ed25519-verified in live mode.
- **Watch identity:** `watch_id = new URL(target_url).hostname`. One actor per hostname (`idFromName(watch_id)`), so two URLs on the same host share a watch.

---

## `GET /health`

Liveness probe. Reports whether the deployment is replaying recorded Agent Browser fixtures or driving the live beta API.

### Request

No parameters, no body.

```bash
curl -s https://<your-edge-deployment-host>/health
```

### Response

| Status | Body |
| --- | --- |
| `200` | `{ "ok": true, "demo_mode": boolean }` |

```json
{
  "ok": true,
  "demo_mode": true
}
```

`demo_mode` is `true` unless `DEMO_MODE` is set to the literal string `false` (case-insensitive).

---

## `GET /fixture`

Serves the bundled demo shop — the exact same document as `fixture/index.html` (kept in sync by the smoke test). This is the page a live run drives, so it must be reachable from Telnyx's cloud; serving it from the same worker makes the live demo self-contained.

Query knobs (applied by the page itself):

| Param | Effect |
| --- | --- |
| `?price=X.XX` | Overrides the rendered price (e.g. `?price=0.00` → broken verdict on demand) |
| `?render_wave=N` | Rebuilds the page's `<main>` section `N` seconds after load → deliberately invalidates the watcher's observation → `stale_ref` |

---

## `POST /watch`

Arms a watch. Resolves the actor for the target hostname and calls `arm(url, owner)` on it.

This route **does not create a browser session and does not capture a baseline.** It stores config, arms the recurring daily schedule, and queues a first run ~5 seconds out. The baseline is captured by that first run (see [Scheduled task surface](#scheduled-task-surface)).

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `url` | `string` | **yes** | Absolute URL of the page to watch. Must parse via `new URL()` and use the `https:` scheme. |
| `owner` | `string` | no | E.164 phone number that receives alert/reply SMS and may issue commands. Falls back to the `WATCH_OWNER_PHONE` env var. |

```bash
curl -s -X POST https://<your-edge-deployment-host>/watch \
  -H 'content-type: application/json' \
  -d '{
    "url": "https://demo-shop.example.com/pricing",
    "owner": "+1555XXXXXXXX"
  }'
```

### Response

| Status | Body | Meaning |
| --- | --- | --- |
| `202` | `{ "ok": true, "watch_id": string, "schedule_id": string }` | Watch armed. `watch_id` is the target hostname. |
| `400` | `{ "error": "url is required" }` | Body missing, unparseable JSON, or `url` absent. |
| `400` | `{ "error": "url must be an absolute URL" }` | `url` present but `new URL(url)` threw. |
| `400` | `{ "error": "only https:// targets are supported" }` | Scheme is not `https:`. |
| `500` | `{ "error": string }` | Unhandled runtime failure (actor dispatch, storage). |

```json
{
  "ok": true,
  "watch_id": "demo-shop.example.com",
  "schedule_id": "daily-demo-shop.example.com"
}
```

### Notes

- **Idempotent per hostname.** Re-posting the same host routes to the same actor. `arm()` **resets `baseline` to `null`** and re-arms the daily schedule (stable task ids dedup the timers), so the next run re-captures the known-good state.
- **Scheme validation is synchronous.** A non-`https` URL is rejected with `400` here — not deferred to the SMS path.
- The `202` is returned after `arm()` resolves; the first browser session is created by the scheduled run, not by this request.

---

## `GET /status/{watch_id}`

Reads the actor's SQL ledger and returns a human-readable report: current target, stored baseline, the last three runs, and all open incidents.

### Path parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `watch_id` | `string` | **yes** | Target hostname, URL-encoded. This is the `watch_id` returned by `POST /watch`. |

### Query parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `owner` | `string` | yes (unless the sender is the account-level owner) | The requesting sender's phone; matched against the watch's owner. Non-owners get `403`. |

```bash
curl -s "https://<your-edge-deployment-host>/status/demo-shop.example.com?owner=%2B15551234567"
```

### Response

| Status | Body | Meaning |
| --- | --- | --- |
| `200` | `{ "status": string }` | Multi-line report (see shape below). |
| `400` | `{ "error": "watch id is required" }` | Path segment after `/status/` is empty. |
| `403` | `{ "error": "not_authorized" }` | The requesting sender is not the watch's owner. |
| `500` | `{ "error": string }` | Unhandled runtime failure. |

```json
{
  "status": "Watch: https://demo-shop.example.com/pricing\nBaseline: $24.00\nLast runs: 2026-07-29: healthy (price and form match baseline) | 2026-07-28: broken (price mismatch: expected $24.00, saw $0.00) | 2026-07-27: healthy (baseline captured)\nOpen incidents: 2026-07-28#2026-07-28T14:02:11.004Z: price mismatch: expected $24.00, saw $0.00"
}
```

The `status` string is always four newline-separated lines, in this order:

| Line | Content |
| --- | --- |
| 1 | `Watch: <target_url>` or `Watch: not armed` |
| 2 | `Baseline: <price_text>` or `Baseline: not captured` |
| 3 | `Last runs: ` + up to 3 entries `YYYY-MM-DD: <verdict|incomplete> (<reason>)`, joined with ` \| `, or `none` |
| 4 | `Open incidents: ` + entries `<incident_id>: <reason>`, joined with ` \| `, or `none` |

### Notes

- A watch that was never armed returns `Watch: not armed` with `200`, not `404` — the actor is created lazily by `idFromName` and answers with its initial state.
- `verdict` is `null` for a run that started but never wrote a verdict (crash, quota retry pending, or in-flight). Those render as `incomplete`.

---

## SMS command surface

Inbound SMS arrives on `POST /webhooks/messaging` as a Telnyx `message.received` envelope. The route is **Ed25519-verified** in live mode (`401` on a bad signature; `503` when `TELNYX_PUBLIC_KEY` is missing) and unsigned deliveries are only accepted in `DEMO_MODE`. Commands are authorized against the watch's owner: senders that are neither the env owner nor a registered owner of any watch are refused with `403` before anything is armed, run, or read.

| Command | Arguments | Effect | Reply |
| --- | --- | --- | --- |
| `watch <url>` | `url` — absolute https URL | Stores `target_url`, `allowed_domains: [hostname]`, `owner_phone`; seeds the KV index; resets `baseline`; arms daily `every(86400, "runCheck")` with a stable id; queues a first run in 5s | `Watching <hostname>. First check in ~5s, then daily.` |
| `status [url]` | optional `url` selects the watch | Runs `statusReport()` against the SQL ledger | The same four-line report as `GET /status/{watch_id}` |
| `recheck now [url]` | optional `url` — one-shot override | Forces an immediate run with `reason: "manual"`. With a URL, that run targets the override instead of the stored `target_url` (this is how the `?price=0.00` broken-verdict demo is reproduced without re-arming) | Run outcome, or an incident/fix SMS |
| `recheck <incident_id>` | `incident_id` — e.g. `2026-07-28#2026-07-28T14:02:11.004Z` | Fix-verification run with `reason: "verify"`; closes that specific incident on a healthy verdict | `FIXED <url> — incident <id> closed. Before: <artifact> After: <artifact>` on success |
| *(anything else)* | — | Status of the sender's single watch, or a hint | `Commands: watch <url> \| status \| recheck now [url] \| recheck <incident_id>` |

**Rejection replies from `watch`:**

| Condition | Reply |
| --- | --- |
| URL fails `new URL()` | `Invalid URL.` |
| Scheme is not `https:` | `Only https:// targets are supported.` |

**Unsolicited SMS the actor sends:**

| Trigger | Text |
| --- | --- |
| Broken verdict, new incident | `BROKEN <url> — <reason>. Incident <incident_id>. Screenshot: <download_url or n/a>` |
| Broken verdict, incident already open | `BROKEN (again) <url> — <reason>. Existing incident <id>. Screenshot: <download_url or n/a>` |
| Persistent staleness | `Watchdog note: <url> kept re-rendering mid-run (stale_ref x2). Incident note <id>. Check ?render_wave.` |
| Healthy verdict with an open incident | `FIXED <url> — incident <id> closed. Before: <artifact_id> After: <artifact_id>` |
| Run threw (non-quota) | `Watchdog run failed: <message>` |

In `DEMO_MODE=true` every outbound SMS is logged as `[demo] SMS to <masked>: <text>` and **nothing is sent**. Recipient numbers are masked to last-4 in logs.

---

## Scheduled task surface

`runCheck` is the only scheduled method. It is dispatched by name from `schedule()`, `every()`, and the SMS handler.

### Payload (`RunPayload`)

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `reason` | `"first" \| "scheduled" \| "manual" \| "verify" \| "retrySession"` | no | Defaults to `"scheduled"`. Controls the run key and whether an already-completed run is skipped. |
| `incident_id` | `string` | no | Set by `recheck <incident_id>`; a healthy verdict closes that specific incident. Without it, a healthy verdict closes the newest open incident. |
| `run_key` | `string` | no | Explicit idempotency key. Supplied by the quota-retry path so the retry reuses the original key. |
| `target_url` | `string` | no | One-shot override of the stored `target_url` for this run only. |

### Run key derivation

| `reason` | `run_key` |
| --- | --- |
| `first` | `YYYY-MM-DD#first` (UTC run date) |
| `scheduled` | `YYYY-MM-DD` (UTC run date) |
| `manual`, `verify`, `retrySession` | `YYYY-MM-DD#<reason>#<HHMMSS>` (fresh each invocation) |
| any, with explicit `run_key` | the supplied value |

The run key is also the Agent Browser `idempotency_key`, so a retried run replays the original session instead of creating a duplicate. If the idempotent replay returns a terminal (`closed`/`failed`/`expired`) session, the actor re-creates with a fresh `#s<n>` suffix.

### Skip semantics

If a row for `run_key` already has a non-null `verdict` **and** `reason` is `scheduled` or `first`, the run returns immediately. Manual and verify runs always execute (fresh run keys).

### Schedule registration

| Call | Interval | Payload |
| --- | --- | --- |
| `every(86400, "runCheck", { reason: "scheduled" }, { id: "daily-<watch>" })` | daily, stable id (dedup on re-arm) | `{ reason: "scheduled" }` |
| `schedule(5, "runCheck", { reason: "first" }, { id: "first-<watch>" })` | one-shot, +5s, stable id | `{ reason: "first" }` |
| `schedule(60, "runCheck", { reason: "manual", run_key, target_url })` | one-shot, +60s | quota-retry path only |

---

## Persistence contract

Two SQL tables in the `WATCHDOG_DB` binding, created idempotently by `ensureSchema()` on first use.

### `runs`

| Column | Type | Notes |
| --- | --- | --- |
| `run_key` | `TEXT PRIMARY KEY` | Run date, or `date#reason` |
| `run_date` | `TEXT NOT NULL` | `YYYY-MM-DD` UTC |
| `target_url` | `TEXT NOT NULL` | URL actually driven this run |
| `verdict` | `TEXT` | `healthy` \| `broken` \| `NULL` (incomplete) |
| `reason` | `TEXT` | Verdict reason, or the failure message on a thrown run |
| `price_text` | `TEXT` | Price observed this run |
| `screenshot_artifact_id` | `TEXT` | Agent Browser `artifact_id` |
| `screenshot_url` | `TEXT` | `download_url` resolved from the artifact |
| `observation_id` | `TEXT` | Final observation the verdict was rendered against |
| `refs_json` | `TEXT` | JSON map of the refs used (`price`, `name`, `email`, `submit`) |
| `stale_recovered` | `INTEGER` | `1` when a `stale_ref` was recovered mid-run |
| `started_at` | `TEXT NOT NULL` | ISO 8601 |
| `finished_at` | `TEXT` | ISO 8601; `NULL` while in flight |

### `incidents`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `TEXT PRIMARY KEY` | `<run_date>#<first_broken_at>` for breaks, `<run_date>#stale` for persistent-staleness notes |
| `run_date` | `TEXT NOT NULL` | Date the break was first observed |
| `first_broken_at` | `TEXT NOT NULL` | ISO 8601 |
| `reason` | `TEXT NOT NULL` | Verdict reason, truncated to 500 chars |
| `before_artifact_id` | `TEXT` | Screenshot from the breaking run |
| `after_artifact_id` | `TEXT` | Screenshot from the closing run |
| `status` | `TEXT NOT NULL` | `open` \| `closed` |
| `closed_at` | `TEXT` | ISO 8601 |

**Deduplication:** `fileIncident` returns early (with a `BROKEN (again)` re-alert) if a break incident already exists for `run_date`, so a replayed or crash-resumed run cannot double-file. `closeIncident` closes the newest `open` row (or the `incident_id` supplied by `recheck <incident_id>`); stale notes are excluded from automatic closure.

---

## Upstream Telnyx calls

Issued by the actor with `Authorization: Bearer <TELNYX_API_KEY>` against `https://api.telnyx.com/v2`. In `DEMO_MODE=true` they are served from recorded fixtures and never hit the network.

| Method | Path | Purpose | Handled failures |
| --- | --- | --- | --- |
| `POST` | `/browser_sessions` | Create session. Body: `{ policy: { allowed_domains: [hostname] }, limits: { lifetime_s: 900, idle_timeout_s: 120 }, idempotency_key: <run_key> }` | `429 quota_exceeded` → close own open session, `schedule(60, ...)`, return without a verdict; terminal replay → fresh key |
| `GET` | `/browser_sessions/{id}` | Poll provisioning until `ready`; verify session state after `execution_lost` | Terminal session → `SessionLostError` → fresh session for the remainder of the run |
| `POST` | `/browser_sessions/{id}/actions?wait_seconds=25` | `navigate` → `observe` → `fill` ×3 → `click` → `observe` → `screenshot` | `stale_ref`/`stale_observation` → re-observe, re-pick refs, retry once; `execution_lost` → verify page state, only re-mutate if the effect did not land; `202` → poll by action id |
| `GET` | `/browser_sessions/{id}/actions/{action_id}` | Poll a still-running action to a terminal state | No tree/refs in polls — the actor re-observes when it needs them |
| `GET` | `/browser_sessions/{id}/artifacts/{artifact_id}` | Resolve `download_url` for the screenshot | Missing `download_url` → stored as `NULL` |
| `DELETE` | `/browser_sessions/{id}` | Close session in the `finally` path, success or failure | Best-effort; failure does not mask the run outcome |

### Agent Browser error codes the actor branches on

| `data.error.code` | HTTP | Actor behaviour |
| --- | --- | --- |
| `stale_ref` | `200` | Re-observe, re-extract refs, retry the fill once. Second consecutive staleness files an incident note instead of a verdict. |
| `stale_observation` | `200` | Same recovery path as `stale_ref`. |
| `execution_lost` | `200`/`503` | Never resubmitted blind: session status checked, page state re-observed, mutation repeated only if it did not land; a terminal session hands the rest of the run to a fresh session. |
| `policy_denied` | `200` | Fails the run; the domain policy is intentional. |
| `navigation_blocked` / `timeout` / `result_too_large` | `200` | Fails the run; recorded on the row and reported by SMS. |
| `quota_exceeded` | `429` | Close-then-retry via `schedule(60, ...)` with the same `run_key`. |
| any other | any | Throws; the run row records the message and the owner gets a failure SMS. |

### Inference

`this.env.TELNYX.ai.openai.chat.createCompletion({ model: AI_MODEL ?? "DeepSeek-V4.1-Flash", messages })`. Two turns: ref picking (the four `picked_refs`) and the verdict (`healthy` \| `broken` + `reason`). Both expect strict JSON; unparseable output falls back to `{ verdict: "broken", reason: "unparseable model output" }` for the verdict and throws for ref picking. The baseline capture turn (`describe()`) records `price_text` + `form_labels`.

---

## Status codes

| Code | Where | Meaning |
| --- | --- | --- |
| `200` | `GET /health`, `GET /fixture`, `GET /status/{watch_id}` (owner), `POST /webhooks/messaging` | Success. |
| `202` | `POST /watch` | Watch armed. The first browser session is created by the scheduled run. |
| `400` | `POST /watch`, `GET /status/{watch_id}`, `POST /webhooks/messaging` | Missing/invalid `url`, empty `watch_id`, or invalid JSON. |
| `401` | `POST /webhooks/messaging` | Signature header missing/invalid (live mode, key configured). |
| `403` | `GET /status/{watch_id}`, `POST /webhooks/messaging` | The sender is not the watch's owner. |
| `503` | `POST /webhooks/messaging` | Live mode without `TELNYX_PUBLIC_KEY` — unsigned deliveries are refused. |
| `404` | any unmatched path or method | `{ "error": "not found" }` |
| `500` | any route | Unhandled runtime exception (actor dispatch, SQL, secrets). Body is `{ "error": string }`; details are not leaked. |

---

## Configuration affecting the contract

| Variable | Default | Effect on requests |
| --- | --- | --- |
| `DEMO_MODE` | `true` | `true` → Agent Browser calls replay recorded fixtures, SMS is logged not sent, verdict is derived locally. `false` → live beta API + `TELNYX.messages.send`. Surfaced by `GET /health`. |
| `WATCH_OWNER_PHONE` | — | The account-level owner. Fallback recipient when `POST /watch` omits `owner`; also authorizes SMS commands. |
| `FROM_NUMBER` | — | Sender for outbound SMS in live mode. |
| `AI_MODEL` | `DeepSeek-V4.1-Flash` | Model used for ref picking, baseline capture and the verdict. |
| `WATCH_TARGET_URL` | — | Documented default target; used by URL-less `status` / `recheck now` SMS commands and by `POST /watch` without a `url`. |
| `TELNYX_API_KEY` | — | Secret read from `SECRETS` for outbound Agent Browser REST calls. Missing in live mode → `TELNYX_API_KEY is not configured`. |
| `TELNYX_PUBLIC_KEY` | — | Secret read from `SECRETS` to verify the Ed25519 webhook signature on `POST /webhooks/messaging`. Missing in live mode → `503` on unsigned deliveries. |
