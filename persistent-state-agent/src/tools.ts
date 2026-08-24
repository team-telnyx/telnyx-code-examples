import { lookupLatestLead } from "./salesforce.js";
import type { Env } from "./types.js";

export async function lookupLead(env: Env): Promise<{ recordId: string; summary: string }> {
  const lead = await lookupLatestLead(env);
  if (!lead) return { recordId: "", summary: "No Salesforce leads were found." };

  const parts = [
    `Latest Lead ${lead.name}`,
    `company=${lead.company}`,
    lead.email ? `email=${lead.email}` : "",
    `status=${lead.status}`,
    lead.lead_source ? `source=${lead.lead_source}` : "",
  ].filter(Boolean);

  return { recordId: lead.id, summary: parts.join(", ") };
}

export function smalltalkFallback(): string {
  return "I'm here to help with Anusha's onboarding context, Salesforce status, and escalation.";
}

export function asksForLead(text: string): boolean {
  return /\b(lead|salesforce|crm|prospect|mql|latest record|onboarding|package|status update|status)\b/i.test(text);
}

export function asksForMeeting(text: string): boolean {
  return /\b(schedule|book|arrange|set up|organize)\s+(a\s+)?(meeting|call|appointment|session)\b/i.test(text)
    || /\b(meeting|call|appointment)\s+(with|for|at|on)\b/i.test(text)
    || /\bi\s+(want|need|would like)\s+to\s+(schedule|book|arrange)\b/i.test(text);
}
