# DEV-841 verification status

This is an evidence ledger, not a production-readiness certification.

## Verified locally (2026-09-02/03)

- 25 tests pass: 12 actor/workflow tests against the actual Agent SDK, 10 dashboard behavior tests, 2 authenticated HTTP contract tests, and 1 Ed25519 webhook-signature round-trip test (valid signature accepted, tampered and unsigned rejected).
- TypeScript type checking passes.
- Production dependency audit reports zero known vulnerabilities at the time of the check.
- Tests cover schedules, demo/production enrollment contracts, reschedule slot offering and booking, medication re-timing on reschedule, nurse wait/resume, follow-up, consent/expiry, durable SMS deduplication, tolerant command matching, signature rejection, and authenticated mock EHR fallback without sibling bindings.

## Verified on Edge (2026-09-01/02, function week9-patient-agent)

- The function serves authenticated patient state across separate requests.
- Unauthenticated patient state, enrollment, and clinic reads return 401.
- Unsigned inbound SMS webhook requests return 401.
- The authenticated mock clinic API returns a valid empty record before enrollment.
- Actor clinic preflight succeeded using the secret-bound HTTPS fallback.
- Live enrollment returned 200 and persisted four schedules with a 15-minute expiry.
- The appointment timer woke the actor and sent through its Telnyx binding. Provider record `4031a05e-5c59-4bb1-82a4-4f213f86f246` was delivered at 2026-09-01 19:05:06 UTC.
- The missed-appointment timer independently woke the actor, persisted `noshow`, and sent outreach. Provider record `4031a05e-5e9d-44ee-87e1-ba4a8ab35b16` was delivered at 2026-09-01 19:07:35 UTC.
- The recurring medication job was accepted at 19:12:05 UTC; a real inbound TAKEN command persisted the acknowledgement at 19:12:31 UTC.
- The automatic stop ran at 19:20:04 UTC. A later state read confirmed consent false and an empty schedule list.
- Sep 2 session (16:31–17:35 PDT): two live runs (patient-demo-9, demo-11) exercised the reschedule slot flow end to end — RESCHEDULE inbound → three slot options offered via real carrier SMS → slot chosen via inbound digit → clinic rebooked → confirmation; TAKEN acknowledged twice; "feeling worse" escalated with a live AI summary; the human-in-the-loop waited in durable state across multiple state reads.
- Inbound delivery split-test: a `message.received` webhook for a test reply was captured on a neutral collector with `webhook_delivered` status, `is_spam: false`, from the allowlisted recipient — proving carrier→Telnyx→webhook delivery for this number and profile.

## Not yet verified end to end

- The final live RESCHEDULE-slot selection on the Sep 3 revision (`7eaa92fb4fdc`, deployed with two-day demo slots and the reworked SMS copy) — verified on prior revisions; retest on the current one.
- Optional call transfer (no nurse-demo destination configured).

The separate direct-API SMS transport test does not satisfy the actor workflow checks above. Blog, Medium, and YouTube deliverables in the ticket also remain unfinished.

## Simulator note (2026-09-03)

The dashboard includes a demo-mode **patient reply simulator** (`simulate-inbound`, admin token, demo actors only): it injects patient replies through the same durable state machine so the UI can present the full flow without a carrier. Simulated replies are recorded in the timeline as operator-injected. This is a presentation affordance — the carrier path (signed inbound webhooks, event-ID deduplication, delivery status) was verified separately and remains the proof standard. Production deployments have no simulator.

## Incident notes (2026-09-02)

1. The original working copy lived in `/tmp` and was destroyed by macOS periodic cleanup at ~15:41 PDT before it was committed. The example was rebuilt from the session's verified state; the live Edge function was never affected. Lesson applied: never keep uncommitted work in `/tmp`.
2. Post-recovery ships silently failed: the rebuilt `telnyx.toml` lacked the `[edge_compute]` func_id block, and the reconstructed `index.ts` did not export the actor classes from the entry module — the platform build rejected the revision (`deploy_failed`) while function status still read `deploy_ok`. Fixed by restoring `[edge_compute]`, exporting `PatientAgent`/`DemoClinic` from `src/index.ts`, and verifying deploys via the revision list instead of the function status flag. Lesson applied: verify deploys at the revision level, and treat a missing `[edge_compute]` block as a hard ship failure.
