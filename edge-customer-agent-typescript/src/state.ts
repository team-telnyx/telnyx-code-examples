/**
 * CustomerState — the durable shape of a customer entity.
 *
 * This is NOT conversation state. This is ENTITY state. The actor IS the
 * customer (Ian), and this interface describes what Ian's actor remembers
 * across days, channels, and interactions.
 *
 * The AI Assistant (the LLM) is a reasoning harness that lives INSIDE the
 * agent. The Assistant is not durable — Ian is. When Ian calls again
 * tomorrow, the Assistant is reconstructed from this state + the MessageLog,
 * but Ian's identity, preferences, and history are already here.
 */

/** A single interaction record — voice call, SMS, WhatsApp, or human escalation. */
export interface InteractionRecord {
  /** ISO timestamp of the interaction. */
  at: string;
  /** Which channel the interaction came through. */
  channel: "voice" | "sms" | "whatsapp" | "human-escalation";
  /** Short summary for display and LLM context. */
  summary: string;
  /** Direction of the interaction. */
  direction: "inbound" | "outbound" | "proactive";
}

/** A shipment the agent is tracking for this customer. */
export interface ShipmentRecord {
  /** Salesforce shipment/order ID. */
  salesforce_id: string;
  /** Current status from Salesforce. */
  status: string;
  /** When the status last changed. */
  last_updated: string;
  /** Tracking number, if available. */
  tracking_number?: string;
  /** Estimated delivery date, if available. */
  estimated_delivery?: string;
}

/** An open support ticket. */
export interface TicketRecord {
  /** Salesforce ticket/case ID. */
  salesforce_id: string;
  /** Short description. */
  subject: string;
  /** Current priority. */
  priority: "low" | "medium" | "high" | "urgent";
  /** Whether this ticket is awaiting human action. */
  escalation_pending: boolean;
}

/**
 * The full durable state of a CustomerAgent actor.
 *
 * One actor instance per customer (addressed by E.164 phone number via
 * `idFromName`). This state survives across days, calls, SMS messages,
 * and actor evictions. No external database. No Redis. No context
 * reconstruction. The actor IS Ian.
 */
export interface CustomerState {
  // ── Identity ──────────────────────────────────────────────────────────

  /** Salesforce customer ID — links the actor to the CRM record. */
  salesforce_id: string;
  /** Customer's display name (e.g., "Ian Reither"). */
  name: string;
  /** E.164 phone number — the actor's identity key. */
  phone_e164: string;

  // ── Interaction history (summaries, not full transcripts) ──────────────

  /** Recent interaction summaries for LLM context. */
  history: InteractionRecord[];
  /** ISO timestamp of the last interaction (any channel). */
  last_interaction_at: string | null;
  /** Total number of interactions across all channels. */
  interaction_count: number;

  // ── Customer preferences ───────────────────────────────────────────────

  /** Preferred contact channel. */
  preferred_channel: "voice" | "sms" | "whatsapp";
  /** Language preference for AI responses. */
  language: string;
  /** Whether the customer has opted into proactive outreach. */
  proactive_consent: boolean;

  // ── Shipments being tracked ────────────────────────────────────────────

  /** Active shipments the agent is watching. */
  shipments: ShipmentRecord[];

  // ── Support tickets ───────────────────────────────────────────────────

  /** Open support tickets. */
  open_tickets: TicketRecord[];

  // ── Escalation state (human-in-the-loop) ──────────────────────────────

  /** Whether the agent is currently waiting for a human to respond. */
  escalation_pending: boolean;
  /** ISO timestamp when escalation started, if pending. */
  escalation_started_at: string | null;
  /** The reason for the current escalation, if pending. */
  escalation_reason: string | null;

  // ── Scheduled actions ─────────────────────────────────────────────────

  /** IDs of active schedule tasks, for tracking and cancellation. */
  active_schedule_ids: string[];

  // ── Index signature for merge-patch compatibility ─────────────────────

  [key: string]: unknown;
}

/**
 * Create the initial state for a new CustomerAgent actor.
 *
 * Called by `initialState()` when the actor is first activated for a
 * phone number that has never been seen before. The actor starts with
 * minimal identity (phone + name from the demo persona) and grows its
 * state as interactions happen.
 */
export function initialCustomerState(phone_e164: string, name = "Ian"): CustomerState {
  return {
    salesforce_id: "",
    name,
    phone_e164,

    history: [],
    last_interaction_at: null,
    interaction_count: 0,

    preferred_channel: "voice",
    language: "en",
    proactive_consent: true,

    shipments: [],

    open_tickets: [],

    escalation_pending: false,
    escalation_started_at: null,
    escalation_reason: null,

    active_schedule_ids: [],
  };
}

/**
 * Create an interaction record.
 */
export function recordInteraction(
  channel: InteractionRecord["channel"],
  summary: string,
  direction: InteractionRecord["direction"] = "inbound",
): InteractionRecord {
  return {
    at: new Date().toISOString(),
    channel,
    summary,
    direction,
  };
}
