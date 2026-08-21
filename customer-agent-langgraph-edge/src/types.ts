import type { CustomerAgent } from "./customer-agent.js";
import type { ActorNamespace } from "@telnyx/edge-runtime";
import type Telnyx from "telnyx";

export type SmsTransport = "demo" | "production";
export type Intent = "lead" | "schedule_meeting" | "smalltalk" | "unknown" | "confirm_reschedule";
export type PreferredChannel = "sms" | "voice";

export interface Env {
  CUSTOMERS: ActorNamespace<CustomerAgent>;
  TELNYX: Telnyx;
  [key: string]: unknown;
  DEMO_MODE?: string;
  SMS_TRANSPORT?: SmsTransport;
  DEMO_FROM_NUMBER?: string;
  DEMO_SENDER_NUMBER?: string;
  DEMO_CUSTOMER_NAME?: string;
  DEMO_CUSTOMER_SALESFORCE_ID?: string;
  USE_MOCK_SALESFORCE?: string;
  SF_WRITE_MODE?: string;
  SF_CLIENT_ID?: string;
  SF_CLIENT_SECRET?: string;
  SF_DOMAIN?: string;
  SF_API_VERSION?: string;
  SF_DEMO_LEAD_EMAIL?: string;
  MODEL?: string;
  AGENTMAIL_API_KEY?: string;
  AGENTMAIL_INBOX?: string;
  AGENTMAIL_WEBHOOK_SECRET?: string;
  USE_MOCK_AGENT_MAIL?: string;
  SDR_EMAIL?: string;
  SDR_NAME?: string;
  SECRETS?: {
    get(binding: string): Promise<string | undefined>;
  };
}

export interface PendingOutbound {
  turn: number;
  reply: string;
  clientRef: string;
}

export interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
  at: number;
}

export interface TicketRef {
  id: string;
  subject: string;
  status: string;
}

export interface ShipmentRef {
  id: string;
  carrier: string;
  status: string;
  eta: string;
  salesforce_id?: string;
  tracking_number?: string;
}

export interface LeadRef {
  id: string;
  name: string;
  company: string;
  email: string;
  phone?: string;
  status: string;
  lead_source?: string;
  last_modified?: string;
  demo_note?: string;
  demo_field?: string;
  shipment?: string;
  requested_meeting_time?: string;
  meeting_time?: string | null;
  meeting_status?: string;
  customer_context?: string;
  assigned_sdr?: string;
  sdr_confirmation?: string;
  customer_confirmation?: string;
  previous_meeting_time?: string | null;
}

export interface LeadCreateInput {
  name?: string;
  company?: string;
  email: string;
  phone?: string;
  shipment?: string;
  requested_meeting_time?: string;
  customer_context?: string;
  meeting_status?: string;
}

export interface LeadCreateResult {
  lead: LeadRef;
  created: boolean;
}

export interface SdrAssignmentResult {
  assigned_sdr: string;
}

export interface SdrAvailabilityResult {
  available: boolean;
  sdr: string;
  requested_time: string;
}

export interface LeadMeetingUpdateInput {
  lead_id: string;
  meeting_status?: string;
  meeting_time?: string;
  requested_meeting_time?: string;
  assigned_sdr?: string;
  sdr_confirmation?: string;
  customer_confirmation?: string;
  customer_context?: string;
  shipment?: string;
}

export interface LeadMeetingUpdateResult {
  lead: LeadRef;
  fields_updated: string[];
}

export interface LeadCurrentMeeting {
  lead_id: string;
  meeting_time: string | null;
  meeting_status: string | null;
  assigned_sdr: string | null;
  requested_meeting_time: string | null;
  previous_meeting_time: string | null;
}

export interface EscalationRef {
  reason: string;
  started_at: number;
  ticket_id?: string;
}

export interface CustomerState extends Record<string, unknown> {
  phone_e164: string;
  to: string;
  name: string;
  salesforce_id: string;
  preferred_channel: PreferredChannel;
  proactive_consent: boolean;
  open_tickets: TicketRef[];
  shipments: ShipmentRef[];
  latest_lead: LeadRef | null;
  escalation_pending: EscalationRef | null;
  active_schedule_ids: string[];
  history: HistoryEntry[];
  turn: number;
  queuedTurn: number;
  processingTurn: number;
  lastSentTurn: number;
  pendingOutbound: PendingOutbound | null;
  lastIntent: Intent;
  at: number;
  reschedule_event: RescheduleEvent | null;
}

export interface ReceiveMessageInput {
  text: string;
  from: string;
  to: string;
  eventId: string;
}

export interface SalesforceUpdateInput {
  phone_e164: string;
  order_id: string;
  salesforce_id: string;
  status: string;
  tracking_number?: string;
  estimated_delivery?: string;
}

export interface SalesforceLeadChangeInput {
  phone_e164: string;
  lead_id: string;
  meeting_time?: string | null;
  meeting_status?: string;
  assigned_sdr?: string;
  requested_meeting_time?: string | null;
  customer_context?: string;
  shipment?: string;
}

export interface LeadUpdateInput {
  phone_e164: string;
  lead_id?: string;
  field?: string;
  value?: string;
  reason?: string;
  send_sms?: boolean;
}

export interface HumanEscalationInput {
  phone_e164: string;
  reason: string;
}

export interface HumanReplyInput {
  phone_e164: string;
  reply_text: string;
}

export interface ScheduleFollowupInput {
  phone_e164: string;
  delay_seconds?: number;
  reason?: string;
}

export interface VoiceCallInput {
  from: string;
  to: string;
  call_control_id?: string;
  call_session_id?: string;
}

export interface AgentMailSendInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
  reply_to?: string;
}

export interface AgentMailSendResult {
  message_id: string;
  thread_id: string;
}

export interface AgentMailInboundMessage {
  inbox_id: string;
  thread_id: string;
  message_id: string;
  timestamp: string;
  from: string;
  to: string[];
  subject?: string;
  text?: string;
  extracted_text?: string;
  html?: string;
  in_reply_to?: string;
  references?: string[];
}

export interface AgentMailInboundPayload {
  type: "event";
  event_type:
    | "message.received"
    | "message.received.spam"
    | "message.received.blocked"
    | "message.received.unauthenticated";
  event_id: string;
  message: AgentMailInboundMessage;
}

export interface AgentMailReplyParsed {
  from: string;
  subject: string;
  text: string;
  thread_id: string;
  message_id: string;
  in_reply_to: string | null;
}

export interface SdrConfirmationInput {
  phone_e164: string;
  lead_id?: string;
  requested_time?: string;
  customer_name?: string;
  customer_context?: string;
}

export interface SdrReplyInput {
  phone_e164: string;
  from: string;
  reply_text: string;
  thread_id?: string;
  message_id?: string;
  in_reply_to?: string;
}

export interface RescheduleEvent {
  old_meeting_time: string | null;
  new_meeting_time: string | null;
  detected_at: number;
  proactive_sms_sent: boolean;
  source: "salesforce_manual";
}

export interface CallResultInput {
  from: string;
  to?: string;
  call_control_id?: string;
  call_session_id?: string;
  intent: Intent;
  requested_meeting_time?: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  customer_context?: string;
  customer_approved?: boolean;
  meeting_time?: string;
  transcript_summary?: string;
}

export interface ResponderContext {
  phone_e164: string;
  name: string;
  salesforce_id: string;
  is_returning_caller: boolean;
  latest_lead: LeadRef | null;
  original_requested_meeting_time: string | null;
  original_confirmed_meeting_time: string | null;
  assigned_sdr: string | null;
  sdr_confirmation: string | null;
  new_meeting_time: string | null;
  salesforce_manually_changed: boolean;
  reschedule_detected_at: number | null;
  proactive_sms_sent: boolean;
  meeting_status: string | null;
  customer_confirmation: string | null;
  history: HistoryEntry[];
  narrative_summary: string;
}

export interface WebhookEventRow {
  event_id: string;
  at: number;
}

export interface ProcessLogRow {
  [key: string]: string | number;
  id: number;
  turn: number;
  phase: string;
  intent: string;
  note: string;
  at: number;
}

export interface ProcessLogEvent {
  id: number;
  turn: number;
  phase: string;
  intent: string;
  note: string;
  at: number;
}

export interface GraphExecutionRow {
  [key: string]: string | number;
  id: number;
  turn: number;
  intent: string;
  path: string;
  history_count: number;
  order_id: string;
  action_result: string;
  reply: string;
  at: number;
}

export interface GraphExecution {
  turn: number;
  intent: string;
  path: string;
  historyCount: number;
  orderId: string;
  actionResult: string;
  reply: string;
  at: number;
}

export interface EventsResponse {
  conversation: HistoryEntry[];
  processLog: ProcessLogEvent[];
  graphExecution: GraphExecution | null;
  turnState: {
    turn: number;
    queuedTurn: number;
    processingTurn: number;
    lastSentTurn: number;
    pendingOutbound: PendingOutbound | null;
  };
}

export interface CustomerContext {
  customer: {
    phone_e164: string;
    name: string;
    salesforce_id: string;
    preferred_channel: PreferredChannel;
    proactive_consent: boolean;
    open_tickets: TicketRef[];
    shipments: ShipmentRef[];
    latest_lead: LeadRef | null;
    escalation_pending: EscalationRef | null;
    active_schedule_ids: string[];
    turn: number;
    queuedTurn: number;
    processingTurn: number;
    lastSentTurn: number;
    lastIntent: Intent;
    at: number;
  };
  history: HistoryEntry[];
}

export interface TelnyxMessageWebhook {
  data: {
    id: string;
    event_type: string;
    occurred_at?: string;
    payload: {
      from: { phone_number: string };
      to: Array<{ phone_number: string }>;
      text: string;
    };
  };
}

export interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string | null;
    };
    finish_reason?: string;
  }>;
}

export interface TelnyxEdgeClient {
  messages: {
    send(message: { from: string; to: string; text: string }): Promise<{ data?: { id?: string } }>;
  };
  ai: {
    openai: {
      chat: {
        createCompletion(request: {
          model: string;
          messages: Array<{ role: string; content: string }>;
        }): Promise<ChatCompletionResponse>;
      };
    };
  };
}

export function normalizePhoneE164(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const phone = value.trim();
  return /^\+[1-9]\d{6,14}$/.test(phone) ? phone : fallback;
}

export function actorNameForCustomer(phoneE164: string): string {
  const digits = phoneE164.replace(/\D/g, "");
  return digits ? `customer-${digits}` : "";
}

export const DEFAULT_DEMO_FROM_NUMBER = "+16282564467";
export const DEFAULT_DEMO_SENDER_NUMBER = "+14157986793";
export const DEFAULT_DEMO_CUSTOMER_NAME = "Anusha";
export const DEFAULT_DEMO_CUSTOMER_SALESFORCE_ID = "mock-anusha-salesforce-id";
export const DEFAULT_MODEL = "zai-org/GLM-5.2";

export function demoFromNumber(env: Env): string {
  return env.DEMO_FROM_NUMBER || DEFAULT_DEMO_FROM_NUMBER;
}

export function demoSenderNumber(env: Env): string {
  return env.DEMO_SENDER_NUMBER || DEFAULT_DEMO_SENDER_NUMBER;
}

export function demoCustomerName(env: Env): string {
  return env.DEMO_CUSTOMER_NAME || DEFAULT_DEMO_CUSTOMER_NAME;
}

export function demoCustomerSalesforceId(env: Env): string {
  return env.DEMO_CUSTOMER_SALESFORCE_ID || DEFAULT_DEMO_CUSTOMER_SALESFORCE_ID;
}

export function modelId(env: Env): string {
  return env.MODEL || DEFAULT_MODEL;
}

export function smsTransportEnabled(env: Env): boolean {
  return env.SMS_TRANSPORT !== "demo";
}

export function demoUiEnabled(env: Env): boolean {
  return env.DEMO_MODE !== "false";
}
