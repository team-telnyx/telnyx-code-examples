# PatientAgent (DEV-841)

A Telnyx Edge Compute + Agent SDK example: **the actor IS the patient.** One stable `PatientAgent` actor per patient ID owns appointments, medication schedules, escalation state, and a bounded event timeline — it wakes itself on durable timers, talks SMS through the Telnyx binding, and routes concerns to a human with a separate approval capability.

Not a chatbot: conversations are just one input. The patient exists between messages.

## Why Telnyx

Telnyx provides the AI Communications Infrastructure that powers durable, programmable messaging workflows with low-latency global delivery. By combining the Telnyx Edge Agent SDK with the native `[telnyx]` binding, this sample demonstrates zero-credential API access to Telnyx messaging, AI inference, and Stateful Actors directly from the edge runtime — appointment reminders, no-show detection, medication loops, and LLM-triaged escalations run as one long-lived patient entity, without managing API keys in application code.

## Demo flow (ticket DEV-841)

1. Appointment scheduled → agent SMS reminder 24h before (production) or immediately (demo mode)
2. Patient misses appointment → agent detects after a grace window → "reply RESCHEDULE"
3. Patient replies → agent offers three deterministic slots → patient picks → clinic API rebooks + SMS confirmation
4. Medication reminder → `TAKEN` acknowledged into durable state
5. `feeling worse` → LLM summarizes (never diagnoses) → human review queue
6. Human approves → agent relays + schedules a self-waking follow-up
7. Demo expires or patient STOPs → everything cancels

## Production vs demo timing

Production is the default and is what the example teaches: 24-hour reminder lead, 15-minute no-show grace, medication anchored to a daily patient-local hour (self-rescheduling durable timer), no auto-stop (STOP opts out). `mode:"demo"` compresses every timing for watchability and is labeled as such everywhere. Both modes run the same durable state machine.

## Quickstart

```bash
npm ci
npm test && npm run typecheck
```

Deploy per the repo's Edge Compute guide, configure the secrets named in `telnyx.toml` with `telnyx-edge secrets add`, point a dedicated messaging profile webhook at `/webhooks/patients/<patientId>`, then follow `GUIDE.md` for the live sequence and `API.md` for the request contracts.

## Architecture

- `src/patient.ts` — `PatientAgent` (the patient entity: enrollment, durable outbox, schedules, reschedule slots, escalation, call transfer) and `DemoClinic` (mock EHR adapter; swap for authenticated FHIR in real use).
- `src/index.ts` — routing, operator auth, Ed25519 Telnyx webhook signature verification, payload normalization, mock clinic HTTP fallback API.
- `src/ui.ts` — operator dashboard (no framework, one HTML template, CSP-free, no storage).
- `test/` — actor workflow tests against the real Agent SDK, dashboard behavior tests, HTTP contract tests, Ed25519 signature round-trip test.

## Security posture

- Operator routes require the admin token; nurse sends require a **separate** nurse capability — an LLM can never impersonate the human.
- Inbound webhooks require a valid Ed25519 Telnyx signature; unsigned or tampered requests are rejected with 401.
- The recipient is pinned to one allowlisted number; provider event IDs are deduplicated.
- Ambiguous sends are flagged `needs-reconciliation` in a durable outbox instead of being blindly retried.

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Enrollment returns 400 `invalid_request` | Phone not the allowlisted recipient, appointment in the past, or demo fields in production mode | Use the exact `DEMO_RECIPIENT` number in E.164, future `appointmentAt`, match fields to the selected `mode` |
| Replies never reach the actor | Messaging profile webhook points at a different patient path | Point the dedicated profile webhook at `/webhooks/patients/<patientId>` and re-test |
| Inbound webhook returns 401 | Missing or invalid Ed25519 signature headers | Confirm the profile delivers Telnyx-signed webhooks and `WEBHOOK_PUBLIC_KEY` holds the org public key |
| No-show never detected | Grace window not yet elapsed | Demo grace is 60s, production 900s — the check fires once after appointment time + grace |
| Prescription reminder repeats | Demo mode uses an `every()` interval | Expected in demo mode; production anchors to a daily patient-local hour instead |
| `schedule()` jobs not firing | Actor runtime alarm not dispatched | Verify the function deployed `deploy_ok` and the actor bindings show `ready` in `telnyx-edge inspect` |

## Agent Discovery

- **Agent Signup:** [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md)
- **Telnyx AI GitHub:** [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLMs.txt:** [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [sms-two-factor-agent](../sms-two-factor-agent) — Two-factor authentication agent on Edge with the `[telnyx]` binding
- [conference-agent-mediator](../conference-agent-mediator) — Conference moderation agent with durable state
- [agent-fleet-shared-workspace](../agent-fleet-shared-workspace) — Multiple agents sharing a durable workspace

## Honest limits

Synthetic clinic, self-reported adherence, unverified LLM summaries, no PHI handling, no real clinical governance. This is an educational sample — see `VERIFICATION.md` for exactly what has and has not been proven.
