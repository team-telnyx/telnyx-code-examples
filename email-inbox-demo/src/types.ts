/**
 * Shared types for the email-inbox-demo.
 *
 * Every persisted entity has a row type. Every Telnyx payload maps to one of
 * the InboundEmail or InboxEvent shapes below. Webhook payloads from Telnyx
 * are deliberately loose (the API adds fields over time), so the JSON
 * envelopes here are `Record<string, unknown>` plus the fields we read.
 */

export type InboxRow = {
  id: string;
  email_address: string;
  display_name: string | null;
  domain_id: string;
  inbound_enabled: 0 | 1;
  status: string;
  created_at: number;
  updated_at: number;
  /** "demo" for simulated inboxes, "telnyx" for real ones. */
  source: "demo" | "telnyx";
};

export type MessageRow = {
  id: string;
  inbox_id: string;
  /** Telnyx message id, or a demo-prefixed synthetic id. */
  telnyx_id: string | null;
  thread_id: string | null;
  from_address: string;
  from_name: string | null;
  to_addresses: string;
  cc_addresses: string | null;
  subject: string | null;
  preview: string | null;
  body_html: string | null;
  body_text: string | null;
  headers_json: string | null;
  attachments_json: string | null;
  status: "received" | "read" | "archived" | "deleted";
  received_at: number;
  read_at: number | null;
};

export type EventRow = {
  id: number;
  inbox_id: string;
  message_id: string;
  kind: string;
  detail: string | null;
  ts: number;
};

/** Telnyx `email.received` webhook payload (the fields we read). */
export type EmailReceivedPayload = {
  data?: {
    event_type?: string;
    id?: string;
    occurred_at?: string;
    payload?: {
      message_id?: string;
      inbox_id?: string;
      from?: { email?: string; name?: string | null };
      to?: Array<{ email?: string; name?: string | null }>;
      cc?: Array<{ email?: string; name?: string | null }>;
      subject?: string;
      text?: string;
      html?: string;
      headers?: Record<string, string>;
      attachments?: Array<{
        id?: string;
        filename?: string;
        content_type?: string;
        size?: number;
      }>;
      thread_id?: string;
    };
  };
  meta?: Record<string, unknown>;
};
