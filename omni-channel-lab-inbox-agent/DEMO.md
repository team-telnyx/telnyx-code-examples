# Demo Script: Omni-Channel Lab Inbox Agent

The narrated run-through — what to click, what to say, and what the audience sees at every step. Everything is one click or one phone call; no terminal work during the demo.

## Before the audience arrives

1. Open the deployed inbox UI: `https://<your-func>.telnyxcompute.com/`
2. Reset state for a clean start: `curl -X POST https://<your-func>.telnyxcompute.com/api/demo/reset`
3. Phone nearby, ready to receive SMS and to place a call to the intake number
4. Optional: pre-open the Database viewer (`/db`) in a second tab

## Act 1 — The fax arrives (30 sec)

**Say:** *"City General's lab has finalized a patient's results and faxed them to our hospital intake line. Watch the inbox."*

**Click:** **Simulate incoming fax** (top-right of the dashboard).

**Audience sees:** a new document appears in **Lab Documents** — `LAB-20260901-XXX`, status **received**.

> Talking point: "The fax came over the phone network. Our intake number received it, and it's already in the unified inbox — one place for every channel. No one had to refresh a thing."

## Act 2 — Human review + the safety boundary (45 sec)

**Say:** *"Now I do my job as intake staff. I'm the only person in this workflow who sees the document. The AI never does."*

**Click:** **Download PDF** — the sample lab report opens.

**Point out:** the status flips to **reviewed** the moment it's downloaded.

**Click:** **Accept**.

**Audience sees:** the toast confirms the fax was deleted; the download link disappears from the card.

> Talking point: "The moment I accepted, the original fax was deleted from Telnyx — permanently. The download is gone; try the API and it returns 410 Gone. Only the reference number, the status, and timestamps survive. That's privacy by design: there is no lab content sitting in a database waiting to leak."

## Act 3 — AI drafts, human approves (45 sec)

**Say:** *"The AI now drafts the patient's confirmation — from metadata only. It knows a document arrived and its reference. It has never seen a lab value."*

**Do:** open the fax conversation in **Conversations**; the AI's draft is there.

**Click:** **Approve & send** — the patient email comes from the case automatically.

**Audience sees:** the delivery timeline renders under the message: **⏳ queued ✉️ sent ✅ delivered**.

> Talking point: "The system knows the patient received it. Full loop: fax → human review → AI draft → human approval → patient email. The AI did the typing; a human made every decision."

**Click:** **Simulate: patient opened email** on the document card.

> Talking point: "And we know they opened it. In production that's a real webhook from the email platform — the state is identical."

## Act 4 — The appointment, by SMS (60 sec)

**Say:** *"But the workflow started before the fax. Watch the appointment flow — all over SMS."*

**Click:** **Book appointment** — your phone buzzes with a real SMS:
> *"Hi! You're booked for Friday, Sep 5 at 10:00 AM — Floor 2, 500 University Ave, San Francisco. Reply with any questions."*

**You text:** *"what floor is it on?"*
**AI replies:** *"Floor 2 — elevator's just past the main entrance. See you Friday!"*

> Talking point: "The auto-reply pulls the floor from the patient's own appointment record — it's not a template, it's their state."

**Click:** **Mark visit complete** — your phone buzzes:
> *"Thanks for coming in today! Your visit is all set — lab results will land in your email within 1–3 business days."*

## Act 5 — The patient calls (90 sec)

**Say:** *"The next day, I missed the email. I call the hospital."* — dial the intake number.

| You say | The voice agent does |
|---|---|
| *(it answers, natural voice)* | Greets you |
| *"I'm calling about my lab results"* | Asks for your case reference |
| *"2026 09 01 XXX"* (say it sloppy — no prefix, no dashes) | Calls the lookup tool → **found** |
| | *"Your results were already emailed to you on [date] — please check your email, including spam."* |
| *"What did my results actually show?"* | **The escalation moment:** *"I'm not able to discuss lab results or medical questions, but your full results are in your email, and I can connect you with our staff who can help."* |
| *"I only remember the last 3 digits"* | Still finds it — the lookup tolerates partial references |
| *(give a wrong reference)* | *"I couldn't find that — please double-check... I can connect you with staff."* Never invents a status |

> Closing talking point: "That escalation is the whole point. The AI is useful for logistics and absolutely refuses to practice medicine. It handles the routine; humans handle the clinical."

## Act 6 — One case, every channel (30 sec)

Open the conversation thread for the case: the fax, the AI draft, the sent email with delivery chips, the SMS exchange, and the voice transcript — all on one patient, in one inbox. Optionally open the Database viewer and show the `documents` row: `fax_id: null`, `deleted_at` set, `emailed_to` filled.

---

# Technical Walkthrough (for the engineering audience)

## Stack

| Layer | Technology |
|---|---|
| Runtime | Telnyx Edge Compute — one function, deployed with `telnyx-edge ship`, no servers |
| Stateful agent | Agent SDK: `InboxAgent extends Agent<Env, State>` — one durable actor instance per customer, addressed by `env.INBOX.idFromName(customerId)` |
| Case storage | Per-actor embedded SQLite via `ctx.storage.sql` — `documents`, `appointments`, `conversations`, `messages` tables, durable across deployments |
| Voice | Telnyx managed AI Assistant (natural Ultra voice) + a webhook tool that calls back into the Edge function mid-call; plus Call Control answer/speak/transcribe for the webhook-driven loop |
| Fax | Programmable Fax — `fax.ended` webhook, `GET /v2/faxes/{id}` for the signed media URL, `DELETE /v2/faxes/{id}` for privacy deletion |
| SMS | `POST /v2/messages` outbound + `message.received` webhook with a context-aware auto-replier |
| Email | Email API `POST /v2/email_messages` + per-message delivery events + `email.received` webhook for inbound replies |
| Inference | Zero-credential `env.TELNYX.ai.openai.chat.createCompletion` — no API key in code |

## The five design decisions worth explaining

**1. One fax = one case.** Each incoming fax creates its own conversation and document record on the patient's actor. The case reference (`LAB-YYYYMMDD-NNN`) is generated at intake and becomes the patient-facing handle for everything that follows.

**2. The fax deletion is the privacy boundary.** On Accept, the function calls `DELETE /v2/faxes/{fax_id}` against Telnyx, then nulls `fax_id`/`fax_url` in SQLite and sets `deleted_at`. Download after that returns `410 Gone` — enforced in the UI (link removed) and the API. Nothing to breach later.

**3. The AI's tool returns status, never content.** `lookup_lab_document` matches a reference (exact, spoken-variant, or 3-digit suffix) and returns a sentence like *"results were already emailed to the patient on 9/1/2026."* The tool schema makes lab content architecturally unreachable. The assistant's instructions hard-escalate anything clinical.

**4. Caller ID is not authentication — the reference is.** The reference number arrives by email, so possessing it is the verification factor. Spoofing a phone number gets appointment logistics only; lab status requires the reference. (Production would add DOB-last-4 or OTP as a second factor.)

**5. Human approval on every outbound.** The AI drafts; the operator edits and approves. There is no autonomous send on any channel.

## Gotchas we hit (and fixed) — good war stories

- **Actor names must be RFC 1123-safe.** `+1...` and `@` in actor keys crash Dapr's reminder system at runtime. All actor names are stripped to alphanumerics.
- **Fax webhooks don't carry the media URL.** The handler must call `GET /v2/faxes/{id}` after `fax.ended` to fetch the signed S3 URL.
- **S3 media URLs expire after one hour.** Downloads mint a fresh URL at click time (refresh action + re-fetch) instead of storing the expiring link.
- **AI Assistant tool schema:** `name` and `description` live *inside* the nested `webhook` object, not at the tool root — the API's validation error is misleading about where the problem is.
- **`[env_vars]` land in `process.env`, not the `env` parameter** — read runtime config accordingly.
- **TeXML vs Call Control:** a TeXML application speaks XML (GET webhooks); a Call Control application fires JSON POST events. Mixing them produces "application error" voice prompts.

## Reset between runs

```bash
curl -X POST https://<your-func>.telnyxcompute.com/api/demo/reset
```

Clears appointments, documents, conversations, and messages on the demo patient's actor.
