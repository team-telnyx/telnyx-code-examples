/**
 * Shared types for the omni-channel inbox agent.
 *
 * Conventions:
 * - One actor instance per customer, addressed via `env.INBOX.idFromName(customerId)`.
 * - Customer id: E.164 number (voice/SMS/RCS/WhatsApp) or lowercased email address.
 * - Channel-typed conversations; messages within a conversation share a channel.
 * - v1: voice is live; email + SMS/RCS/WhatsApp are stubbed.
 * - v1.1: email goes live (gated on Telnyx Email API GA).
 * - v2: SMS/RCS/WhatsApp go live (gated on compliance registrations).
 */

import type { SqlValue } from "@telnyx/edge-runtime";

/** Messaging channels the inbox understands. */
export type Channel = "voice" | "email" | "sms" | "rcs" | "whatsapp" | "fax";

/** Channels enabled in v1. Stubs return ChannelDisabledError for the rest. */
export const ENABLED_CHANNELS: ReadonlyArray<Channel> = ["voice", "email", "fax"];

/** Conversation lifecycle. */
export type ConversationStatus =
  | "open" // active, agent may auto-reply
  | "awaiting_human" // operator needs to act
  | "closed"; // terminal

/** Message direction relative to the agent. */
export type Direction = "inbound" | "outbound";

/** Outbound message lifecycle. */
export type MessageStatus =
  | "draft" // agent drafted, awaiting human approval
  | "approved" // human approved, queued to send
  | "sent" // delivered to the channel
  | "failed"; // send failed

/** Who authored a message. */
export type Sender =
  | { kind: "agent" } // AI assistant
  | { kind: "human"; operatorId: string } // human operator (admin UI)
  | { kind: "customer" }; // inbound from the customer

/** Row in the `conversations` SQLite table (per-actor). */
export interface ConversationRow extends Record<string, SqlValue> {
  id: string;
  customer_id: string;
  customer_label: string | null;
  channel: Channel;
  status: ConversationStatus;
  agent_id: string | null;
  assignee: string | null;
  last_channel: Channel;
  last_message_at: number | null;
  created_at: number;
  updated_at: number;
}

/** Row in the `messages` SQLite table (per-actor). */
export interface MessageRow extends Record<string, SqlValue> {
  id: string;
  conversation_id: string;
  channel: Channel;
  direction: Direction;
  status: MessageStatus;
  sender_kind: "agent" | "human" | "customer";
  sender_op_id: string | null;
  body: string;
  subject: string | null;
  message_id_hdr: string | null;
  in_reply_to: string | null;
  references_hdr: string | null;
  call_control_id: string | null;
  email_tracking_id: string | null;
  ts: number;
}

/** DTO for the admin UI: a conversation with its most recent message preview. */
export interface ConversationView {
  conversation: ConversationRow;
  last_message_preview: string | null;
  last_message_at: number | null;
  unread: boolean;
}

/** DTO for the admin UI: a message with human-readable sender label. */
export interface MessageView {
  message: MessageRow;
  sender_label: string;
}

/** Filter for `listConversations`. */
export interface ConversationFilter {
  channel?: Channel;
  status?: ConversationStatus;
  assignee?: string | null;
  limit?: number;
  offset?: number;
}

/** Actor state (durable, mirrored to clients). */
export interface InboxState extends Record<string, unknown> {
  customer_id: string;
  open_conversation_id: string | null;
  enabled_channels: Channel[];
  voice_assistant_id: string;
  total_messages: number;
  last_webhook_ts: number | null;
}

/** Document workflow status for lab-result faxes. */
export type DocumentStatus =
  | "received" // fax arrived, awaiting human review
  | "reviewed" // operator downloaded/opened the PDF
  | "accepted" // operator clicked Accept — fax deleted, metadata retained
  | "rejected" // operator rejected — fax deleted, no follow-up drafted
  | "followed_up"; // confirmation email sent

/** Row in the `documents` SQLite table (per-actor). */
export interface DocumentRow extends Record<string, SqlValue> {
  id: string; // internal UUID — survives fax deletion
  fax_id: string | null; // Telnyx fax id — nulled after deletion
  reference: string; // human-readable case ref (LAB-YYYY-MMDD-NNN)
  status: DocumentStatus;
  fax_url: string | null; // temporary PDF download URL — nulled after deletion
  file_name: string | null;
  from_number: string | null;
  to_number: string | null;
  received_at: number;
  reviewed_at: number | null;
  accepted_at: number | null;
  deleted_at: number | null;
  metadata: string | null; // JSON — safe metadata only, never lab content
  conversation_id: string | null; // linked conversation in the inbox
  customer_id: string | null; // actor name that owns this doc — lets the UI address the right actor
  patient_email: string | null; // patient email on file for this case — used for confirmations
  email_sent_at: number | null; // when the results email was sent
  emailed_to: string | null; // address the results email was sent to
  created_at: number;
  updated_at: number;
}

/** Telnyx fax.received webhook payload (subset we consume). */
export interface FaxReceivedPayload {
  id?: string; // fax id
  from?: string;
  to?: string;
  direction?: string;
  status?: string;
  media_urls?: string[];
  pages?: number;
  quality?: string;
}

/** Telnyx binding surface used by the actor (zero-credential). */
export interface InboxEnv {
  TELNYX: {
    ai: {
      openai: {
        chat: {
          createCompletion(req: {
            model: string;
            messages: Array<{ role: string; content: string }>;
            max_tokens?: number;
            temperature?: number;
          }): Promise<{ choices: Array<{ message: { content: string } }> }>;
        };
      };
    };
  };
  AI_MODEL?: string;
  TTS_VOICE?: string;
  VOICE_ASSISTANT_ID?: string;
}

/** Error thrown when an actor method is called for a channel not enabled in this version. */
export class ChannelDisabledError extends Error {
  constructor(public channel: Channel, public currentVersion: string) {
    super(
      `channel '${channel}' is not enabled in ${currentVersion}; ` +
        `see PRD.md for the version this channel is gated on`,
    );
    this.name = "ChannelDisabledError";
  }
}

/** Normalize a caller number / from-email into a stable actor name. */
export function customerIdForChannel(
  channel: Channel,
  raw: string,
): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "unknown";
  if (channel === "email") {
    return trimmed.toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  return trimmed.replace(/[^0-9a-zA-Z]/g, "");
}
