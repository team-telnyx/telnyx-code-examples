import { SEVERITIES, type Severity } from "./severity";
import { STATUSES, type Status } from "./status";

/**
 * Parses the body of an inbound SMS into a SignalDesk command.
 * All command keywords are case-insensitive.
 */
export type SmsCommand =
  | { type: "stop" }
  | { type: "start" }
  | { type: "help" }
  | { type: "status"; incidentNumber: string }
  | { type: "report"; body: string };

const STOP_KEYWORDS = new Set(["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const INCIDENT_NUMBER_PATTERN = /^INC-\d{6}$/i;

export function parseSmsCommand(rawBody: string): SmsCommand {
  const trimmed = rawBody.trim();
  if (trimmed === "") {
    // Empty or whitespace-only: unusable, treat as an empty report so callers
    // can decide to ignore it. The webhook pipeline filters these out.
    return { type: "report", body: "" };
  }

  const words = trimmed.split(/\s+/);
  const head = words[0]?.toUpperCase() ?? "";

  if (STOP_KEYWORDS.has(head)) return { type: "stop" };
  if (head === "START") return { type: "start" };
  if (head === "HELP") return { type: "help" };

  if (head === "STATUS") {
    const candidate = words[1]?.toUpperCase() ?? "";
    if (INCIDENT_NUMBER_PATTERN.test(candidate)) {
      return { type: "status", incidentNumber: candidate.toUpperCase() };
    }
    return {
      type: "status",
      incidentNumber: "",
    };
  }

  return { type: "report", body: trimmed };
}

export { STOP_KEYWORDS };

/** Formatting helper shared by command reply senders. */
export function describeSeverity(severity: Severity): string {
  return SEVERITIES.includes(severity) ? severity : "SEV3";
}

export function describeStatus(status: Status): string {
  return STATUSES.includes(status) ? status : "INVESTIGATING";
}
