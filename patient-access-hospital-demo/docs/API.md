# API contract (frozen)

All routes are served by the Edge function's fetch handler (`src/index.ts`).
Errors are always `{"error": string, "details"?: unknown}` with an appropriate
status. `DemoState` is the type defined in `src/domain/types.ts`.

**Authentication:** the portal is gated. `/api/auth/login` and
`/api/auth/logout` are public; every other `/api/*` route (and the
dashboard at `/`) requires the session cookie — without it they return
`401 { "error": "not signed in" }`. Sessions live in the ACCOUNTS actor's
durable state (8-hour TTL, HttpOnly, Secure `pa_session` cookie). The Telnyx webhook
endpoint stays public — it is the provider's callback and requires signature
verification with `TELNYX_PUBLIC_KEY`.

| Endpoint | Method | Body | Response | Notes |
|---|---|---|---|---|
| `/api/auth/signup` | POST | `{}` | `403 { error }` | Disabled for the shared public demo; use the seeded demo staff login. |
| `/api/auth/login` | POST | `{ email, password }` | `200 { ok: true, email }` + session cookie · `401 { error }` | The seeded demo staff account is documented in the repo README only (never rendered on the login page). |
| `/api/auth/logout` | POST | — | `200 { ok: true }` + cleared session cookie | Closes the session for that token. |
| `/api/state` | GET | — | `200 { state: DemoState }` | Full state snapshot; polled by the UI (~1s while visible). |
| `/` | GET | — | `200` HTML | The single-file UI: the authed dashboard when a session cookie is present, the login page (sign in / create account) otherwise. |
| `/api/demo/start` | POST | `{ reset?: boolean; paceMs?: number }` | `200 { state }` · `409 { error }` if running or **no visit on file** | Starts the scripted call against the visit already on file. Requires a booked/missed visit — "Book an appointment first — use the intake card" otherwise (kept for API compatibility; the book-first flow's primary entry is `/api/demo/missed-call`). |
| `/api/demo/stop` | POST | `{}` | `200 { state }` | Stops a running script; phase → `stopped`. |
| `/api/demo/reset` | POST | `{}` | `200 { state }` | Stops if running (waits for a clean exit) and returns to the fresh intake state: no visit on file, today's intake slots regenerated (per the preserved calling hours), settings + the on-file number preserved. |
| `/api/intake` | POST | `{ fullName, phoneE164, dobIso, slotId }` | `200 { ok: true, state }` · `422 { error }` | Book-first intake. Validates the name (2–80 chars), E.164 phone, and non-future date of birth; the slot must be one of the current intake slots. Stores the patient on file, books the appointment with the phone and DOB recorded, consumes the slot, and updates `settings.targetPhoneE164` (the auto-call + the UI prefill). |
| `/api/demo/missed-call` | POST | `{ paceMs?: number }` | `200 { state }` · `409 { error, phase }` | Marks the on-file visit **missed** and AUTO-STARTS the AI call to the on-file number (identity → missed explanation → rebook slots → write-back → SMS → escalation handoff). Requires a visit; fails with a friendly message otherwise. In live mode this places the REAL call. |
| `/api/settings` | POST | partial `DemoSettings` | `200 { settings }` · `422 { errors: string[] }` | Validated (zod). Available slots regenerate within the new calling hours; staff phone becomes the warm-transfer target. |
| `/api/webhooks/telnyx` | POST | Telnyx webhook envelope | `200 {}` | Live mode only — `503 { error: "mock mode" }` in mock. Requires `TELNYX_PUBLIC_KEY`; verifies the Ed25519 signature over `${timestamp}.${rawBody}` using `telnyx-signature-ed25519` + `telnyx-signature-timestamp` headers; `401` on mismatch and `503` when verification is unavailable. |
