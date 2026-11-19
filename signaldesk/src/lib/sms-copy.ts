import type { Severity } from "@/lib/severity";
import { severityLabel } from "@/lib/severity";
import type { Status } from "@/lib/status";

export interface ConfirmationSmsInput {
  incidentNumber: string;
  title: string;
  severity: Severity;
}

export interface StatusUpdateSmsInput {
  incidentNumber: string;
  previousStatus: Status;
  newStatus: Status;
  operatorNote: string | null;
}

export interface ResolutionSmsInput {
  incidentNumber: string;
  operatorNote: string | null;
}

export const SMS_MAX_LENGTH = 480;

export const HELP_TEXT =
  "SignalDesk: text an incident report any time. Commands: STATUS INC-000123, HELP, STOP. Msg&data rates may apply.";

export const OPT_OUT_CONFIRMATION =
  "SignalDesk: you're opted out and will receive no further updates. Reply START to resume.";

export const OPT_IN_CONFIRMATION =
  "SignalDesk: messaging re-enabled. You'll receive updates again. Reply HELP for help.";

export const STATUS_NOT_FOUND_PREFIX =
  "SignalDesk: no incident found for";

export function incidentConfirmationText(
  input: ConfirmationSmsInput,
): string {
  return (
    `SignalDesk [${input.incidentNumber}] received: "${input.title}" ` +
    `${input.severity} (${severityLabel(input.severity)}). ` +
    "You'll get status updates here. Reply HELP for help, STOP to opt out."
  );
}

export function statusUpdateText(input: StatusUpdateSmsInput): string {
  const note = input.operatorNote ? ` ${truncate(input.operatorNote, 80)}` : "";
  const suffix = input.newStatus === "RESOLVED" ? " Reply STOP to opt out." : "";
  return (
    `SignalDesk [${input.incidentNumber}] ${input.previousStatus} → ${input.newStatus}.${note}${suffix}`
  );
}

export function resolutionText(input: ResolutionSmsInput): string {
  const note = input.operatorNote ? ` ${truncate(input.operatorNote, 80)}` : "";
  return `SignalDesk [${input.incidentNumber}] RESOLVED.${note} Thanks for the report.`;
}

export function statusQueryText(incidentNumber: string, status: Status): string {
  return `SignalDesk [${incidentNumber}] current status: ${status}. Reply HELP for help.`;
}

export function statusNotFoundText(input: string): string {
  return `SignalDesk: no incident found for "${input}". Send STATUS INC-000123 (incident number from your report).`;
}

export function reportRejectedText(reason: string): string {
  return `SignalDesk: ${reason} Reply HELP for help.`;
}

export function truncate(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}
