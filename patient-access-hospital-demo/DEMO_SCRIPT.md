# DEMO_SCRIPT — 4-minute screen recording

Product message: **Telnyx builds it, then the hospital runs it.**

- Audience: hospital AEs and forward-deployed engineers; also sent as a video.
- Runtime: the app runs as a Telnyx Edge Compute function. Boot the local Edge
  stack BEFORE recording: `colima start` (if needed) then `npm run demo`, and
  wait for `✓ Ready on http://127.0.0.1:8787` — nothing builds on camera.
- Pacing: default 9000 ms per beat (the AI call runs ≈ 2:10). The intake beat
  is operator-paced. Timestamps below assume the defaults; the total lands
  ≈ 3:55–4:00 and trims tight in the edit.
- Recording setup: one browser window at **http://127.0.0.1:8787**,
  full-screen, zoom ~125%. The MOCK banner stays visible the whole time
  (synthetic data, no calls or texts — say it once).
- Sign-in on camera: the demo staff account is documented in the repo README
  (staff@windervalmedical.health / winderval-demo) — never shown on the login
  page itself; either type it or use **Create account** live.
- The call target: the PATIENT'S number typed at the intake beat — on demo
  day that is YOUR number (per policy the live/real call always goes to your
  phone; mock simulates everything).

## Timeline (mm:ss — target ≈ 4:00, trim in the edit)

| Time | Beat | On screen | Narration |
|---|---|---|---|
| 0:00–0:10 | Sign in | Login card: Winderval Medical mark, Sign in / Create account tabs; type the staff email + password (from the README), land on the console | "This is the clinic's own scheduling console, running on Telnyx Edge — the hospital signs into its own system, and new staff can self-register right here." |
| 0:10–0:45 | Intake booking | The intake card; type the patient's full name + phone on camera; tap today's slot; **Book appointment** → the "on the books" card appears with the number noted | "First — book a visit like the front desk does. Name, phone, a time — the phone goes straight into the clinic's record, and when the patient misses the visit, the system already knows who to call." |
| 0:45–1:00 | Courts the miss | The missed-appointment banner appears; one click on **Mark missed & auto-call now** — no staff lift a finger; the call activity panel goes Preparing → Calling | "No-shows kill revenue. Watch this — nobody picked up the phone. The agent calls the patient the moment the visit is flagged missed." |
| 1:00–1:20 | Identity check | The transcript: the agent ("Hi, this is Ava calling from Winderval Medical… Am I speaking with {patient}?") and the patient confirming | "The agent confirms who it's talking to before anything else — and every word streams into the clinic's own record." |
| 1:20–1:40 | Missed explanation | "I'm calling because you missed your appointment — your {visit} was scheduled for {when}… I'd like to help you find a new time" | "It explains exactly what was missed — with the details from the clinic's own booking." |
| 1:40–1:55 | Real availability | The three rebook slots appear on the Scheduling tab; the agent offers them aloud | "It pulls real availability from the clinic's scheduling system — three open slots, right now." |
| 1:55–2:10 | The patient picks | "Tomorrow at 2 PM works for me." The chosen slot card highlights | "The patient answers in plain conversation — no keypresses, no portal login." |
| 2:10–2:25 | Booking write-back | "Done — you're rebooked…" The green **Booked** card appears; the slot leaves availability | "The booking is written back to the scheduling system instantly. What the agent hears is what the calendar shows." |
| 2:25–2:50 | SMS confirmation | The SMS bubble advances queued → sent → delivered — to the number saved on file | "And the patient gets the confirmation by text — same source of truth." |
| 2:50–3:05 | The medical question | "Quick question — can I take my medication before the appointment?" | "Now watch the guardrail." |
| 3:05–3:30 | Refusal + escalation | The agent refuses medical advice; the amber **Escalation** card (Patient Record tab) shows the handoff context — patient, MRN, appointment, selected slot, the question — transfer status Pending → Connected | "The agent does not diagnose, does not advise — it warm-transfers to the nurse line with full context so nobody repeats themselves. One direct transfer. No contact center." |
| 3:30–3:40 | Close of call | "Hi {patient}, this is Nurse Priya…" → "Call ended"; phase → Done | "The call ends with the handoff complete — every step of this was visible in the hospital's own systems." |
| 3:40–3:50 | The handover | The Settings beat: change the staff/nurse number or calling hours → Save → the Scheduling tab regenerates slots instantly | "And here's the handover: call-flow settings are the hospital's own — change them on this screen and they're live. Telnyx builds it, then the hospital runs it." |
| 3:50–4:00 | Outro | The final dashboard (Scheduling with the regenerated slots) | "If you want this for your health system, talk to us at telnyx.com." |

Total ≈ 4:00.

## Operator notes

- Anchor narration to screen events, not the clock — beats drift but the
  story holds.
- Type the PATIENT'S number at intake on camera — that is the whole story
  (the number goes on file with the booking; the agent dials it when the
  visit is flagged missed). On demo day use your own phone; mock mode never
  dials it.
- The Booking button enables only with a valid name (2–80 chars) + E.164
  phone + a selected slot — validation errors show inline.
- If a take is lost mid-call: **Reset** (ends cleanly) → re-book → Mark
  missed again. Deterministic every time.
- The Settings change should be visibly instant — Save confirms and the slot
  times move on the Scheduling tab.
- MOCK banner visible throughout: the honesty marker (synthetic data, no real
  calls).
- The escalation card on the Patient Record tab is the money shot — transfer
  of context in ONE line while it is on screen.

## Alternative: interactive manual mode

For live AE meetings: sign in, book the patient live, click **Mark missed &
auto-call now**, and interject between beats; use **Reset** between demos.
The Settings tab doubles as the "hospital controls it" conversation —
call-flow settings (calling hours, transfer target) take effect on screen
with no redeploy.

---

# FILM SCRIPT — live deployment (recovery storyline, one take, ~4 min)

**The story: every clinic already sends reminders — texts, emails, calls. Some patients still miss it. This is the recovery layer: the AI receptionist saves the patient with one call.**

## Scene 1 — THE HOOK (0:00–0:30) · *screen: sign-in page*

**VO (no screen action needed yet — this is you talking over the sign-in card):**

> "Every clinic does prevention: you send the reminder text, the email, the phone call before every visit. And you know what? It still doesn't stop everything. Some patients will miss it no matter what you send — and every one of those misses is a lost revenue slot.

> So we built the layer that comes after. This is Winderval Medical's patient-access portal — live, on Telnyx — and when a patient misses, the AI receptionist calls them and saves the visit."

**TYPE:** staff@windervalmedical.health / winderval-demo → **Sign in**

## Scene 2 — WHAT YOU'RE LOOKING AT (0:30–0:50) · *screen: dashboard*

**VO:** "This is the clinic's live dashboard. Everything here is real: the patient on file, the appointment slots, the call log, the texts. All running on Telnyx — one platform."

## Scene 3 — BOOKING THE VISIT (0:50–1:20) · *screen: intake card*

**TYPE:** Priya Nair → the phone (masked on screen) → **tap the 3:00 PM slot** → **Book appointment**.

**VO:** "A new patient calls in. Front desk books her in seconds — inside business hours, 8 to 5 — and her number is saved on file the moment the visit is booked. That number-on-file is what makes everything else possible."

## Scene 4 — THE MISS, AND THE CALL (1:20–1:50) · *screen: appointment card*

**CLICK:** "Mark missed & auto-call now."

**VO:** "Now the visit goes missed. But this time it's not a lost slot with a callback queue behind it — the AI receptionist is already calling her. Real call, from the clinic's own number. **Answer your phone.**"

## Scene 5 — THE AI CALL (1:50–3:00) · *phone on speaker + dashboard*

**AVA (beats):** greeting → identity check → explains the missed visit → **"The first openings are: tomorrow at 9 AM with Dr. Chen, or tomorrow at 2 PM with Dr. Chen."** → waits.

**YOU:** "Tomorrow at 2 PM works for me."

**AVA:** "Perfect — you're rebooked for tomorrow at 2:00 PM with Dr. Chen. See you then."

**YOU:** hang up.

> **VO:** "Identity confirmed, the miss acknowledged, the visit rebooked — in one call. The patient didn't have to call back, hold, or visit a portal."

## Scene 6 — THE PROOF (3:00–3:30) · *dashboard, scroll slowly*

**VO:** "And the dashboard? The transcript of the entire call, the appointment already moved, the confirmation text already sent. Nothing typed, nothing looked up — the AI did the work, the front desk just watched."

## Scene 7 — THE CLOSE (3:30–4:00) · *screen: dashboard wide*

**VO:** "So: prevention with reminders and calls before the visit — and recovery when patients miss it anyway. Built into the platform. The clinic keeps the revenue; the patient keeps the care. Built on Telnyx, live today."

## SCENE 7b — CLONE IT, BUILD YOUR OWN (optional, 4:00–4:20) · *screen: github.com/team-telnyx/telnyx-code-examples*

**VO:** "And it's open — clone it, point it at your own Telnyx account, and build it for your use case."

## OPTIONAL — THE ESCALATION BEAT (film last, only if you want it)
During the call, ask: "Can I take my medication before the visit?" → Ava gives the policy line and warm-transfers to the nurse line → your phone rings a second time. Answer for the bridge. Unanswered, the call ends — film this last, Reset available.

## FILMING NOTES
- Reset between takes (clears calls, re-seeds slots; sign-in survives).
- The transcript fills right after hang-up — the natural cut is: call ends → transcript appears.
- Every missed-call is a real dial to the number typed at intake.
- The intake card rolls over around 5:00 PM PT — film earlier.
- Film solo — the demo state is shared.
- The `meridianclinic.health` login is retired; use the Winderval cred in Scene 1.
