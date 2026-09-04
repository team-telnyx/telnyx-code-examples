# PatientAgent API

All operator routes require `Authorization: Bearer TOKEN`. Use the separate nurse token only for `nurse-reply`. Never put credentials in a URL. Every patient ID must match `[a-z0-9][a-z0-9-]{0,63}`.

## Enroll

`POST /api/patients/{id}/enroll`

```json
{"phone":"+12025550123","consent":true,"appointmentAt":"2099-01-01T10:00:00Z","mode":"production","medicationHourLocal":20,"utcOffsetMinutes":0}
```

- `phone`: exact allowlisted E.164 recipient.
- `consent`: must be `true`. Patient consent is captured at intake and recorded here; the enrollment confirmation SMS includes STOP instructions.
- `appointmentAt`: future ISO UTC timestamp.
- `mode`: `"production"` (default) or `"demo"`.
- Production mode: `medicationHourLocal` 0–23 (default 20) — daily reminder at that patient-local hour via a self-rescheduling durable timer; `utcOffsetMinutes` −720–840 (default 0). No-show grace defaults to 900 seconds (15 minutes); override with `noShowGraceSeconds` 60–86400. No automatic stop: the patient opts out with STOP. Demo-compression fields (`medicationIntervalSeconds`, `demoDurationSeconds`) are rejected.
- Demo mode (`mode:"demo"`): `medicationIntervalSeconds` integer 60–604800 (default 86400) and `demoDurationSeconds` optional integer 120–1800 (auto-stop). Timings are compressed for watchability: no-show grace 60 seconds, reminder immediate for appointments within 24 hours.

Returns the durable state and schedules. Existing enrollment is not overwritten. Enrollment is multi-step; inspect state after an interrupted request before retrying.

## Read and stop

- `GET /api/patients/{id}`: state and schedule metadata; treat as sensitive, even when synthetic.
- `GET /api/patients/{id}/preflight`: binding/secret availability only; never secret values.
- `POST /api/patients/{id}/stop`: returns `{"stopped":true}` after consent is revoked and jobs are cancelled.
- `POST /api/patients/{id}/clinic-status`: `{ "status": "fulfilled" }`; values are `booked`, `fulfilled`, `noshow`, `cancelled`.

## Human approval

`POST /api/patients/{id}/nurse-reply`, using the nurse token:

```json
{"escalationId":"concern-1","text":"A human-approved response.","followUpSeconds":60}
```

Requires a waiting escalation. Sends the approved text with the nurse capability, marks the escalation resolved, and schedules a follow-up wake-up. `followUpSeconds` 60–1209600, default 604800. Follow-ups after a demo expiry do not send.

## Inbound webhooks

`POST /webhooks/patients/{id}` — Telnyx-signed (Ed25519, `telnyx-signature-ed25519` + `telnyx-signature-timestamp` over `<timestamp>.<body>`). Invalid or missing signatures return 401. `message.received` updates the actor; other message events are acknowledged and ignored; `call.*` events answer and transfer per the (optional) nurse number.

Commands (case-insensitive, punctuation-tolerant): `STOP`/`STOPALL`/`UNSUBSCRIBE`/`CANCEL`/`END`/`QUIT` opt out; `START` re-enables (and re-arms production medication); `TAKEN` records a self-reported medication acknowledgement; `RESCHEDULE` (and `Reschedule.`-style variants) offers three deterministic slots — reply `1`, `2`, or `3` to book one via the clinic API; anything else escalates to human review with an unverified AI summary.

After a demo expiry, inbound messages receive a single "demo has ended" notice and no further processing.

## Patient reply simulator (demo mode only)

`POST /api/patients/{id}/simulate-inbound`, admin token:

```json
{"text":"RESCHEDULE"}
```

Injects a patient reply through the same state machine as a carrier SMS — demo mode only (production and unenrolled/expired/stopped actors return 400). The injected event uses the patient's own number as sender and is recorded in the timeline as operator-injected. This is a presentation affordance, not a carrier test.

## Mock clinic API (fallback EHR)

`GET|POST|PATCH /api/clinic/{id}` with the admin token — read, book, and status transitions for the synthetic appointment record. The actor uses this authenticated HTTP fallback when sibling actor bindings are unavailable.
