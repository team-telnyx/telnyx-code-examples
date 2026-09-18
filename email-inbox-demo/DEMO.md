# Demo Script: Email Inbox Demo

The narrated run-through for the TRUST-286 YouTube recording. Target: ~4 minutes. Click-by-click + what the audience sees at each step.

## Before recording

1. `npm install && npm start` (DEMO_MODE — no credentials needed)
2. Open `http://localhost:8788` in a fresh tab at full width (1280×800 or larger)
3. Confirm the seeded demo inbox shows: `support@telnyx-demo.msgtelnyx.com`
4. Confirm the message list is empty or has one or two seeded messages from the auto-injector
5. Optional: open `/health` in a second tab to show `demoMode: true` and `inboxes: 1`

## Act 1 — Show the empty (or near-empty) inbox (15 sec)

**Screen:** Dashboard at `/`, full width.

**Say:** *"This is a focused look at the inbound side of the Telnyx Email API. No outbound, no AI replies — just receive, list, and read. And it runs in DEMO_MODE without any Telnyx credentials or ngrok."*

> Talking point: *"The seeder is firing in the background, but I'm starting from a clean slate so you can see one message arrive on cue."*

## Act 2 — Recording view (10 sec)

**Click:** **Recording view** in the top right.

**Audience sees:** Type enlarges, the "Trigger inbound" debug button hides, a demo banner appears.

**Say:** *"For the recording I switch to a presentation-friendly layout."*

## Act 3 — Trigger an inbound (60 sec)

**Click:** **Trigger inbound** — but **before** you click, the button is hidden in recording view.

**Screen direction:** Switch back to normal view briefly to click the button, or click the **+ Add inbox** first to demonstrate that, then come back. *Decision: keep recording view off until Act 4 to keep this realistic.*

**Click:** Trigger inbound.

**Audience sees:** A toast flashes ("Injected simulated inbound"), a new message appears in the list, the reader pane opens automatically with the full HTML body, the message is marked as read.

**Say:** *"A Stripe receipt just landed. The message list updated live over Server-Sent Events — no refresh. The reader opened automatically, rendered the HTML body safely in a sandboxed iframe, and marked the message as read."*

> Talking point: *"The seeder synthesizes the exact payload shape Telnyx would send for `email.received`. The rendering path is identical to live mode — only the input source differs."*

**Click:** Trigger inbound twice more. Show variety: a GitHub two-factor code email, then a meeting notes email.

**Say:** *"Three different senders, three different formats — receipts, security alerts, internal updates. The dashboard handles each the same way."*

## Act 4 — Add a second inbox (30 sec)

**Click:** **Recording view** again to hide debug controls before showing the create flow.

**Click:** **+ Add inbox** at the bottom of the left pane. Type `sales` as the username and `acme-robotics` as the subdomain. Hit Enter.

**Audience sees:** A new inbox appears in the sidebar (`sales@acme-robotics.msgtelnyx.com`) with 0 unread. The header count updates from "1 total" to "2 total". The message list clears because the new inbox has no messages yet.

**Say:** *"Creating an inbox is one API call — `POST /v2/email_inboxes` with `inbound_enabled: true`. In DEMO_MODE this creates a synthetic one locally; in live mode it calls the real Telnyx API and registers the inbox on the shared_inbound subdomain. No DNS, no MX records, no SMTP plumbing."*

## Act 5 — Independent message streams (30 sec)

**Click:** into the new `sales@acme-robotics` inbox.

**Click:** Trigger inbound twice. The new inbox gets its own randomized emails.

**Audience sees:** The sidebar unread badge for `sales@acme-robotics` ticks from 0 to 2. The message list shows two new emails.

**Click:** back into the original `support@telnyx-demo` inbox. The previous messages are still there.

**Say:** *"Each inbox is independent — its own message stream, its own unread badge. Messages update live over SSE the moment a webhook fires."*

## Act 6 — Archive and delete (20 sec)

**Click:** into a message in any inbox.

**Click:** **Archive**. The message disappears from the default list.

**Click:** the **All** filter dropdown and switch to **Archived**. The archived message reappears.

**Say:** *"Archive is a soft delete — the row stays, but it's filtered out of the default view. Switch to the Archived filter and it comes back. Delete is the same pattern, but more final."*

## Act 7 — Plain-text toggle (10 sec)

**Click:** into any HTML message with a longer body.

**Click:** **Plain text** (the disclosure under the iframe).

**Audience sees:** A monospaced text rendering of the same message body, in case the HTML is broken or suspicious.

**Say:** *"And the plain-text body is always available — useful when the HTML is broken, or when you want to copy a snippet without the markup."*

## Act 8 — Outro (10 sec)

**Click:** Recording view off, switch back to clean dashboard state.

**Say:** *"Inbound email on the Telnyx Email API: one platform, one API key, one signed webhook. Clone the repo, run `npm start` in DEMO_MODE, and you have a working demo on your machine in under a minute."*

---

## Total runtime: ~3 minutes 5 seconds

If you have more time, add:
- **Live mode walkthrough** (2 min): set `DEMO_MODE=false`, add real credentials, point ngrok at the webhook, send a real email to the inbox. Audience sees the message arrive in the dashboard.
- **Ed25519 verification demo** (1 min): show the verification code path, generate a tampered payload in DevTools, watch the 401 response. Good for the security-focused audience.

If you have less time, cut Act 6 (archive/delete) and Act 7 (plain-text toggle).
