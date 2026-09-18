import { randomBytes } from "node:crypto";
import type { InboxDb } from "./db.js";
import { payloadToMessageFields } from "./telnyxClient.js";
import type { EmailReceivedPayload } from "./types.js";

/**
 * Fake inbound seeder for DEMO_MODE.
 *
 * Periodically injects a realistic-looking inbound email into the local DB so
 * the dashboard feels alive without a verified domain, ngrok, or actual
 * inbound mail traffic. The injected payload has the same shape as a real
 * `email.received` Telnyx webhook so the rendering path is identical.
 */
export class DemoSeeder {
  private timer: NodeJS.Timeout | null = null;
  private senders = [
    { email: "priya.sharma@acme-robotics.com", name: "Priya Sharma" },
    { email: "ops-alerts@cloudstatus.io", name: "Cloud Status" },
    { email: "lena.bauer@munichfinanz.de", name: "Lena Bauer" },
    { email: "stripe-receipts@stripe.com", name: "Stripe" },
    { email: "no-reply@github.com", name: "GitHub" },
    { email: "samira.k@globextraders.ae", name: "Samira K." },
    { email: "kevin.tan@singpost.sg", name: "Kevin Tan" },
    { email: "ana.fonseca@saudeclinicas.br", name: "Ana Fonseca" },
  ];

  private subjectTemplates = [
    "Re: Order #{n} — shipping confirmation",
    "Action required: verify your account by Friday",
    "Your weekly report is ready",
    "New invoice INV-{n} from Acme Robotics",
    "Two-factor authentication code: {code}",
    "Re: Q3 contract — final version attached",
    "Heads up: maintenance window Saturday 02:00 UTC",
    "Welcome to Cloud Status — confirm your subscription",
    "Customer support ticket #{n} escalated to engineering",
    "Meeting notes from Tuesday — please review",
  ];

  private bodySnippets = [
    "Hi team,\n\nQuick update on the attached — let me know if anything looks off and I'll jump on a call this afternoon.\n\nThanks,\n{name}",
    "We've detected an unusual sign-in from a new device. If this was you, no action is required. If not, please reset your password immediately and reply to this email so we can lock the account.\n\n— The Security Team",
    "Your invoice for this month is attached. The total of ${amount} will be charged to your card on file in 3 business days. Reply to this thread if you have any questions about the line items.\n\nBest,\nBilling",
    "Here's a summary of the meeting. Three action items:\n  1. {item}\n  2. {item}\n  3. {item}\n\nPlease reply with anything we missed.\n\nThanks,\n{name}",
  ];

  constructor(
    private db: InboxDb,
    private intervalMs: number,
  ) {}

  start(): void {
    if (this.timer) return;
    // Fire one immediately so the dashboard isn't empty on first load.
    queueMicrotask(() => this.tick());
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    // Don't keep the event loop alive just for the seeder.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    const inboxes = this.db.listInboxes().filter((ib) => ib.source === "demo");
    if (inboxes.length === 0) return;
    const inbox = inboxes[Math.floor(Math.random() * inboxes.length)];
    const message = this.synthesize(inbox.id, inbox.email_address);
    this.db.insertMessage({ ...message, status: "received", read_at: null });
    this.db.appendEvent({
      inbox_id: inbox.id,
      message_id: message.id,
      kind: "email.received",
      detail: "Simulated inbound via DEMO_MODE seeder",
      ts: Date.now(),
    });
  }

  /** Public — exposed via the API for the demo "Trigger inbound" button. */
  triggerNow(inboxId: string): string | null {
    const inbox = this.db.getInbox(inboxId);
    if (!inbox) return null;
    const message = this.synthesize(inboxId, inbox.email_address);
    this.db.insertMessage({ ...message, status: "received", read_at: null });
    this.db.appendEvent({
      inbox_id: inboxId,
      message_id: message.id,
      kind: "email.received",
      detail: "Manually triggered via UI",
      ts: Date.now(),
    });
    return message.id;
  }

  private synthesize(inboxId: string, toAddress: string) {
    const sender = this.senders[Math.floor(Math.random() * this.senders.length)];
    const subjectTpl = this.subjectTemplates[Math.floor(Math.random() * this.subjectTemplates.length)];
    const bodyTpl = this.bodySnippets[Math.floor(Math.random() * this.bodySnippets.length)];
    const name = sender.name.split(" ")[0];
    const n = Math.floor(Math.random() * 9000) + 1000;
    const code = String(Math.floor(Math.random() * 900000) + 100000);
    const amount = (Math.random() * 800 + 50).toFixed(2);
    const items = [
      "draft the proposal and circulate by Wednesday",
      "schedule a follow-up call with the customer",
      "file the support ticket with engineering",
    ];
    const fill = (s: string) =>
      s
        .replaceAll("{n}", String(n))
        .replaceAll("{code}", code)
        .replaceAll("{amount}", amount)
        .replaceAll("{name}", name)
        .replaceAll("{item}", items[Math.floor(Math.random() * items.length)]);

    const subject = fill(subjectTpl);
    const bodyText = fill(bodyTpl);
    const bodyHtml =
      `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.55;color:#1f2328;">` +
      bodyText
        .split(/\n\n+/)
        .map((para) => `<p style="margin:0 0 12px 0;">${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
        .join("") +
      `</div>`;

    const payload: EmailReceivedPayload = {
      data: {
        event_type: "email.received",
        id: `demo_${Date.now()}_${randomBytes(3).toString("hex")}`,
        occurred_at: new Date().toISOString(),
        payload: {
          message_id: `demo_msg_${Date.now()}_${randomBytes(4).toString("hex")}`,
          inbox_id: inboxId,
          from: { email: sender.email, name: sender.name },
          to: [{ email: toAddress, name: null }],
          subject,
          text: bodyText,
          html: bodyHtml,
          headers: {
            "message-id": `<${randomBytes(8).toString("hex")}@${sender.email.split("@")[1]}>`,
            "from": `${sender.name} <${sender.email}>`,
            "to": toAddress,
            "subject": subject,
            "date": new Date().toUTCString(),
            "mime-version": "1.0",
            "content-type": "text/html; charset=UTF-8",
          },
          attachments: [],
        },
      },
    };
    const fields = payloadToMessageFields(payload, inboxId);
    return {
      id: `msg_demo_${Date.now()}_${randomBytes(4).toString("hex")}`,
      ...fields,
      received_at: Date.now(),
    } as const;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
