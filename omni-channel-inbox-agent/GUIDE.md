# Guide — Run the Omni-Channel Lab-Results Journey

This guide walks the full patient journey end-to-end on Telnyx Edge Compute. Everything runs on one durable actor per patient — the same actor remembers the appointment, the fax documents, the email status, and every conversation.

## Prerequisites

- A Telnyx account with Edge Compute, a phone number, a fax number, and an email domain.
- The Edge CLI (`telnyx-edge`) installed and authenticated.
- Node.js 18+.

## 1. Deploy

```bash
telnyx-edge new-func --actor --name=omni-channel-inbox-agent
# copy this sample's src/, docs, dependencies, and binding blocks into the generated project
npm install && npm run typecheck
telnyx-edge secrets add TELNYX_API_KEY "$TELNYX_API_KEY"
telnyx-edge ship
```

Set `PUBLIC_BASE_URL` in `telnyx.toml` to the deployed function URL, then re-ship.

## 2. Book the appointment

Open the admin UI and click **Book appointment**. The patient gets an SMS confirmation with the visit date and address — no floor info, on purpose. The patient can text the hotline "what floor?" and the agent answers from the appointment record.

## 3. The visit

When the patient completes the visit, click **Mark visit complete**. The system records it on the actor and texts the patient: *"Your visit is all set — lab results will land in your email within 1-3 business days."*

## 4. The lab faxes the result

Click **Simulate incoming fax** (or send a real fax to your `FAX_NUMBER`). The document lands in the inbox with a generated `LAB-YYYYMMDD-NNN` reference, status `received`.

## 5. Review and accept

Click **Download PDF** to review the result — the human is the only persona that sees it. The AI only ever sees document metadata.

Click **Accept**. Two things happen: the original fax is deleted from Telnyx storage (`DELETE /v2/faxes/{id}` — only the UUID, reference, and status survive), and the AI drafts the results-ready email for approval.

## 6. Approve the email

Edit the draft if needed, then **Approve & send**. The email goes out from your configured sender with:

- a proper display name ("Telnyx Lab Results"),
- an HTML body,
- a self-hosted open-tracking pixel,
- portal links rewritten through the click-tracking redirect.

## 7. The patient calls

Call the hotline and ask: *"I haven't received my lab results."* The voice agent reads its actor state — the appointment, the lab documents, and whether the results email went out — and answers accordingly. If the results were emailed, it confirms and suggests checking spam. If they're still in review, it reassures the patient the results are ready and will land in the inbox shortly.

## 8. Watch the open rate

Open the results email on your phone. The tracking pixel inside it records the open on the patient's actor. Then open `/insights` and refresh: the email flips to **Opened** and the open rate updates live.

## Demo reset

Run `POST /api/demo/reset` between takes — it sweeps conversations, messages, documents, and appointments on every registered actor.

## Production notes

- Set `DEMO_MODE=false` and store `TELNYX_PUBLIC_KEY` to enforce Ed25519 webhook verification.
- Add real authentication in front of the `/api/*` routes before exposing the admin UI.
- Register the fax sender and patient identities for production routing (this demo routes everything to one demo patient for simplicity).
- Telnyx shared email domains have open/click tracking locked; use a verified custom domain with `tracking.open_tracking = true`, or keep the self-hosted pixel.
