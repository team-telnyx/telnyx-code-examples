import Telnyx from "telnyx";
import type { EmailReceivedPayload } from "./types.js";

/**
 * Thin wrapper around the Telnyx Email API.
 *
 * Used by the live-mode fetch handler. In DEMO_MODE this module is never
 * reached — the demo seeder writes directly to the local SQLite cache so the
 * UI feels alive without an account, ngrok, or a verified domain.
 */
export type CreateInboxArgs = {
  /** Telnyx-managed subdomain (e.g. "shared_inbound") or a custom domain_id. */
  domain: string;
  /** Required for shared_inbound; optional for verified custom domains. */
  username?: string;
  /** Friendly name shown in the inbox UI. */
  displayName?: string;
};

export type CreatedInbox = {
  id: string;
  email_address: string;
  domain_id: string;
  status: string;
};

export class TelnyxEmailClient {
  private telnyx: Telnyx;

  constructor(apiKey: string) {
    this.telnyx = new Telnyx({ apiKey, maxRetries: 0, timeout: 10000 });
  }

  async createInbox(args: CreateInboxArgs): Promise<CreatedInbox> {
    const body: Record<string, unknown> = {
      domain: args.domain,
      inbound_enabled: true,
    };
    if (args.username) body.username = args.username;
    if (args.displayName) body.name = args.displayName;

    const res = (await this.telnyx.emailInboxes.create({ ...body })) as any;
    return {
      id: res.id,
      email_address: res.email_address,
      domain_id: res.domain_id,
      status: res.status ?? "active",
    };
  }

  async listInboxes(): Promise<Array<{ id: string; email_address: string; domain_id: string }>> {
    const list = (await this.telnyx.emailInboxes.list()) as any;
    return (list.data ?? []).map((ib: any) => ({
      id: ib.id,
      email_address: ib.email_address,
      domain_id: ib.domain_id,
    }));
  }

  /** Configure a domain's webhook so email.received events hit our endpoint. */
  async registerWebhook(args: {
    domainId: string;
    url: string;
    events?: string[];
  }): Promise<{ id: string }> {
    const events = args.events ?? [
      "email.received",
      "email.delivered",
      "email.opened",
      "email.clicked",
      "email.bounced",
      "email.failed",
    ];
    const res = (await (this.telnyx.emailDomains as any).webhooks.create(args.domainId, {
      url: args.url,
      events,
    })) as any;
    return { id: res.id };
  }
}

/**
 * Convert a Telnyx email.received payload into the row fields we store.
 * Pure function — no I/O — so the same code path serves live webhooks and
 * the demo seeder.
 */
export function payloadToMessageFields(payload: EmailReceivedPayload, inboxId: string) {
  const d = payload.data ?? {};
  const p = d.payload ?? {};
  const from = p.from ?? {};
  const toList = (p.to ?? []).map((t) => t.email).filter(Boolean) as string[];
  const ccList = (p.cc ?? []).map((t) => t.email).filter(Boolean) as string[];
  const subject = p.subject ?? "(no subject)";
  const text = p.text ?? "";
  const html = p.html ?? "";
  const preview = text.slice(0, 160).replace(/\s+/g, " ").trim();
  return {
    inbox_id: inboxId,
    telnyx_id: (p.message_id ?? d.id ?? null) as string | null,
    thread_id: (p.thread_id ?? null) as string | null,
    from_address: (from.email ?? "unknown@example.com") as string,
    from_name: (from.name ?? null) as string | null,
    to_addresses: toList.join(", "),
    cc_addresses: ccList.length ? ccList.join(", ") : null,
    subject,
    preview: preview || null,
    body_html: html || null,
    body_text: text || null,
    headers_json: p.headers ? JSON.stringify(p.headers) : null,
    attachments_json: p.attachments ? JSON.stringify(p.attachments) : null,
  };
}
