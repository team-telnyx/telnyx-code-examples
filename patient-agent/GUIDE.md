# Run a bounded PatientAgent demo

This walkthrough demonstrates DEV-841 with synthetic data and a consenting real SMS recipient. It does not simulate successful delivery: verify messages in provider records and on the receiving phone.

## Start with the dashboard or the terminal, not the phone

Open the deployed function's root page, or attach the terminal tool. Both show the same durable actor state; neither sends SMS by itself.

**Dashboard:** enter the patient ID and admin token, then click **Load patient**. Tokens are kept in page memory, not browser storage.

- **Appointment** shows the saved clinic time and status. No appointment is displayed as booked until the API has persisted it.
- **Patient timeline** explains the trigger behind each saved SMS event. “Accepted” is not a carrier delivery receipt.
- **Next scheduled actions** shows real durable actor jobs sorted by due time. Browser polling only refreshes the display; it does not run the jobs.
- **Human review queue** shows the concern and unverified AI summary, with a separate nurse capability and explicit human approval before sending a reply.
- **Schedule a synthetic appointment** works only for an unused patient ID. Choose a future local time, consenting allowlisted number, and bounded duration. An expired enrolled patient remains read-only for booking; it is never silently reset.

Before using a different patient ID, update the dedicated messaging profile webhook to that ID. Otherwise incoming replies will still go to the previous actor. The dashboard states the required webhook path but does not change account routing automatically.

For the recording, keep the appointment card and timeline visible alongside the phone. Explain each state change before moving to the next step. The 15-minute mode compresses time, not the durable scheduling mechanism.

## Live test sequence

1. Install dependencies with `npm ci`; run `npm test` and `npm run typecheck`.
2. Create a fresh Edge function and copy its generated `[edge_compute]` block into `telnyx.toml`. Configure secrets without committing them. Provision `week9-patient-clinic-url` with that function's HTTPS URL; the manifest maps it to `CLINIC_BASE_URL`. This binding is used because some actor hosts omit function environment variables and sibling actor namespaces.
3. Deploy and wait until the new revision is active. Confirm unauthorized state access returns 401, then check the authenticated `preflight` endpoint. `CLINIC_READ` must report `ok` before enrollment.
4. Select an approved SMS-enabled sender. Give it a dedicated messaging profile, preserving the previous profile ID for rollback. Point the new profile at `/webhooks/patients/<patientId>`. Do not redirect a shared profile used by other demos.
5. Enroll the patient in demo mode (`mode:"demo"`) with a synthetic appointment about 90 seconds ahead, medication interval 180 seconds, and `demoDurationSeconds:900`. Use the real consenting recipient only in the request, never in source code. Production timing (`mode:"production"`, the default) sends a 24-hour-out reminder, marks a no-show only after a 15-minute grace window, anchors medication to a daily patient-local hour, and never auto-stops.
6. Inspect the saved state. In demo mode there should be a reminder, missed-appointment check, medication interval, and automatic-stop job. The appointment reminder runs immediately because the appointment is less than 24 hours away.
7. Let the appointment pass. After the grace window, verify that the actor changes the mock clinic appointment to `noshow` and sends outreach.
8. Reply `RESCHEDULE` to the actual message. Verify the agent offers three slots, reply with a digit, verify the confirmation arrives and the same actor contains a new mock appointment. Do not submit a fake webhook and call that an inbound carrier test.
9. Reply `TAKEN` after the medication reminder; verify the self-reported acknowledgement timestamp. Send a synthetic `feeling worse` message; verify a waiting escalation and an inference summary in the operator panel.
10. A human reviews the synthetic concern. Submit that person's approved demo text through `nurse-reply`, using the nurse token and a 60-second follow-up. Verify the follow-up comes from a scheduled actor wake-up.
11. Stop the test via the admin endpoint, or let the 15-minute expiry run. Confirm consent is false and the schedule list is empty. Check that subsequent inbound `START` does not restart an expired demo.

## What counts as proof

- Durable state read in a separate request after each step.
- Real provider delivery status, not just HTTP 200 from the send API.
- Real signed inbound webhook and a deduplicated provider event ID.
- A scheduled wake-up, not a manually invoked send helper.
- Explicit human approval, not an LLM impersonating a nurse.

## Honest limits

Clinic appointments are synthetic. Self-reported `TAKEN` is not evidence of medication ingestion. LLM output is an unverified summary for review, not symptom diagnosis. Full production readiness requires clinical governance, consent management, authentication and authorization, data retention and privacy controls, alerting, provider receipt handling, and failure reconciliation beyond this educational sample.
