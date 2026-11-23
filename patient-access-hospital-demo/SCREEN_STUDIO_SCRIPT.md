# Screen Studio Demo Script

Target runtime: 3–4 minutes. Record the 20–30 second section marked **Clean clip** as one uninterrupted take so it can be reused as an ad or social clip.

## 0:00–0:05 — Hook

**On screen:** Start on the completed appointment and SMS confirmation.

**Say:**

> “This AI agent just recovered a missed appointment by phone, updated the schedule, and texted the patient the confirmation.”

Hold on the result long enough for viewers to read it.

## 0:05–0:15 — Setup

**On screen:** Show the dashboard and the configured assistant/tool briefly.

**Say:**

> “The setup is a Telnyx phone number, a Telnyx Voice AI assistant, one scheduling webhook, and an SMS confirmation flow. The app runs on Telnyx Edge Compute, and the patient record is synthetic.”

## 0:15–0:30 — What was built

**On screen:** Dashboard overview.

**Say:**

> “Clinic staff use this console to book an appointment, mark it missed, and watch the recovery flow. The agent verifies the patient, offers live availability, writes the new appointment back, and sends the confirmation text.”

## 0:30–1:00 — Book the appointment

**Action:** Reset if needed. Enter a synthetic patient name and phone number, select an available slot, and click **Book appointment**.

**Say:**

> “First, the front desk books the visit. The patient’s phone number is saved on file with the appointment, so if the patient misses the visit, the agent already knows who to call.”

## 1:00–1:15 — Trigger the recovery call

**Action:** Click **Mark missed & auto-call now**.

**Say:**

> “Now the appointment is marked as missed. Nobody has to open a callback queue or dial the patient manually. The AI agent starts the call automatically.”

## 1:15–1:45 — Verify identity

**Phone call:** Answer the call.

The assistant should ask for the caller’s full name, then ask for their date of birth. It must verify both before revealing appointment details.

**Say:**

> “The first guardrail is identity verification. The agent asks one question at a time and does not disclose the appointment until the patient is verified.”

## 1:45–2:05 — Offer availability

**Assistant:**

> “I found your clinic appointment. Would you like to reschedule?”

After confirmation:

> “I can offer tomorrow at 9:00 AM or tomorrow at 2:00 PM. Which works better for you?”

**Say:**

> “The assistant offers only the slots returned by the scheduling system. It does not invent availability or read out the whole schedule.”

## 2:05–2:20 — Confirm and book

**You:**

> “Tomorrow at 9:00 AM works for me.”

**Assistant:**

> “To confirm, that’s tomorrow at 9:00 AM. Would you like me to book that?”

**You:**

> “Yes, confirm it.”

**Say:**

> “Only after explicit confirmation does the assistant call the rescheduling tool.”

**On screen:** Show the appointment moving to the new slot.

## 2:20–2:35 — SMS confirmation

**Say:**

> “The booking is written back to the clinic system, and the patient receives a confirmation SMS automatically.”

**On screen:** Show the updated date, time, clinician, and SMS status.

## Clean clip — 20–30 seconds

Record this section separately as one clean take.

> “A patient missed their appointment, so the AI agent called them automatically. It verified their identity, offered two available times, got explicit confirmation, updated the appointment, and sent the confirmation text. No hold music, no portal login, and no manual callback.”

**On screen:** Call activity → updated appointment → SMS confirmation.

## 2:35–3:10 — How it was made

**On screen:** Show the architecture diagram or repository.

**Say:**

> “Under the hood, the dashboard runs as a Telnyx Edge Compute function with durable patient state. The call uses a Telnyx AI Assistant. At call time, the assistant receives the current patient, missed appointment, and available slots.”

> “After confirmation, the webhook validates the patient identity, matches the requested slot against current availability, writes the appointment update, and sends the SMS confirmation.”

## 3:10–3:35 — How someone else can use it

**On screen:** GitHub repository.

**Say:**

> “The example is available in the Telnyx code examples repository under `patient-access-hospital-demo`. You can run mock mode locally without Telnyx credentials, then switch to live mode by configuring your Telnyx connection, assistant, phone number, public function URL, and secrets.”

> “From there, replace the synthetic clinic, patient record, scheduling adapter, branding, and SMS copy with your own workflow.”

## 3:35–3:50 — Close

**On screen:** Final dashboard with the updated appointment and SMS.

**Say:**

> “The recovery loop is simple: the patient misses the appointment, the AI takes action immediately, the schedule stays current, and the patient gets the next step by text. Telnyx provides the voice, messaging, assistant, and edge infrastructure to make it real.”

## Screen Studio recording notes

- Open with the finished result, not the login screen.
- Mention the setup immediately after the hook.
- Use synthetic patient data and mask phone numbers.
- Zoom into the call status, updated appointment, webhook/tool result, and SMS.
- Keep the clean clip as one uninterrupted take.
- If you stumble, pause and repeat the entire sentence before editing.
- Do not stop recording until the updated appointment and SMS are visible.
