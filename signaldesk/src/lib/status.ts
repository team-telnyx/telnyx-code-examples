export const STATUSES = [
  "INVESTIGATING",
  "IDENTIFIED",
  "MONITORING",
  "RESOLVED",
] as const;

export type Status = (typeof STATUSES)[number];

export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && STATUSES.includes(value as Status);
}

/**
 * Allowed status transitions for the MVP lifecycle:
 *
 *   INVESTIGATING → IDENTIFIED → MONITORING → RESOLVED
 *
 * Backward transitions are allowed (an operator can reopen an incident that
 * turns out to be worse than expected), and jumping straight from
 * INVESTIGATING to RESOLVED is allowed when the issue fixes itself.
 */
const ALLOWED: Record<Status, Status[]> = {
  INVESTIGATING: ["IDENTIFIED", "MONITORING", "RESOLVED"],
  IDENTIFIED: ["INVESTIGATING", "MONITORING", "RESOLVED"],
  MONITORING: ["INVESTIGATING", "IDENTIFIED", "RESOLVED"],
  RESOLVED: ["INVESTIGATING", "IDENTIFIED", "MONITORING"],
};

export function isTransitionValid(
  from: Status,
  to: Status,
): boolean {
  if (from === to) return false;
  return ALLOWED[from].includes(to);
}

export function allowedTransitions(from: Status): Status[] {
  return ALLOWED[from];
}

/** A status change toward RESOLVED closes the incident. */
export function isTerminalStatus(status: Status): boolean {
  return status === "RESOLVED";
}
