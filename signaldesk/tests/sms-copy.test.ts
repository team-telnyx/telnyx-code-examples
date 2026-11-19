import { describe, expect, it } from "vitest";
import {
  HELP_TEXT,
  OPT_OUT_CONFIRMATION,
  incidentConfirmationText,
  resolutionText,
  statusNotFoundText,
  statusQueryText,
  statusUpdateText,
  truncate,
} from "../src/lib/sms-copy";

describe("SMS copy", () => {
  it("includes the incident number in incident-related messages", () => {
    const confirmation = incidentConfirmationText({
      incidentNumber: "INC-000123",
      title: "Checkout API down",
      severity: "SEV1",
    });
    expect(confirmation).toContain("INC-000123");

    const update = statusUpdateText({
      incidentNumber: "INC-000123",
      previousStatus: "INVESTIGATING",
      newStatus: "IDENTIFIED",
      operatorNote: "Root cause found",
    });
    expect(update).toContain("INC-000123");
    expect(update).toContain("INVESTIGATING");
    expect(update).toContain("IDENTIFIED");
    expect(update).toContain("Root cause found");

    const resolution = resolutionText({
      incidentNumber: "INC-000123",
      operatorNote: null,
    });
    expect(resolution).toContain("INC-000123");
    expect(resolution).toContain("RESOLVED");

    const status = statusQueryText("INC-000999", "MONITORING");
    expect(status).toContain("INC-000999");
    expect(status).toContain("MONITORING");
  });

  it("keeps transactional messages concise", () => {
    const confirmation = incidentConfirmationText({
      incidentNumber: "INC-000123",
      title: "x".repeat(200),
      severity: "SEV2",
    });
    expect(confirmation.length).toBeLessThan(320);
    expect(HELP_TEXT.length).toBeLessThan(200);
    expect(OPT_OUT_CONFIRMATION.length).toBeLessThan(160);
  });

  it("provides a usable not-found reply", () => {
    expect(statusNotFoundText("INC-777777")).toContain("INC-777777");
  });

  it("truncates operator notes for SMS length", () => {
    expect(truncate("a ".repeat(100), 80)).toHaveLength(80);
    expect(truncate("short", 80)).toBe("short");
  });
});
