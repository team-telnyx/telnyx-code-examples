export const SEVERITIES = ["SEV1", "SEV2", "SEV3", "SEV4"] as const;

export type Severity = (typeof SEVERITIES)[number];

export function isSeverity(value: unknown): value is Severity {
  return typeof value === "string" && SEVERITIES.includes(value as Severity);
}

/** Human-facing label used across the UI. */
export function severityRank(severity: Severity): number {
  const index = SEVERITIES.indexOf(severity);
  return index === -1 ? SEVERITIES.length : index;
}

export function severityLabel(severity: Severity): string {
  switch (severity) {
    case "SEV1":
      return "Critical";
    case "SEV2":
      return "High";
    case "SEV3":
      return "Medium";
    case "SEV4":
      return "Low";
  }
}
