import { describe, expect, it } from "vitest";
import { formatIncidentNumber, parseIncidentNumber } from "../src/lib/incident-number";
import { SEVERITIES, severityLabel, severityRank } from "../src/lib/severity";
import { STATUSES, allowedTransitions, isStatus, isTransitionValid } from "../src/lib/status";
import { incidentClassificationSchema, mockClassify } from "../src/lib/classify";

describe("incident numbers", () => {
  it("formats zero-padded numbers", () => {
    expect(formatIncidentNumber(1)).toBe("INC-000001");
    expect(formatIncidentNumber(123456)).toBe("INC-123456");
    expect(formatIncidentNumber(999999)).toBe("INC-999999");
  });

  it("rejects invalid sequences", () => {
    expect(() => formatIncidentNumber(0)).toThrow();
    expect(() => formatIncidentNumber(-3)).toThrow();
    expect(() => formatIncidentNumber(Number.NaN)).toThrow();
  });

  it("parses incident numbers", () => {
    expect(parseIncidentNumber("INC-000123")).toBe(123);
    expect(parseIncidentNumber("inc-123")).toBe(123);
    expect(parseIncidentNumber("INC-ABC")).toBeNull();
    expect(parseIncidentNumber("INC-")).toBeNull();
  });
});

describe("severity validation", () => {
  it("accepts only the four defined severities", () => {
    expect(SEVERITIES).toEqual(["SEV1", "SEV2", "SEV3", "SEV4"]);
  });

  it("maps severities to human labels and ordering", () => {
    expect(severityLabel("SEV1")).toBe("Critical");
    expect(severityLabel("SEV4")).toBe("Low");
    expect(severityRank("SEV1")).toBe(0);
    expect(severityRank("SEV4")).toBe(3);
  });
});

describe("status transitions", () => {
  it("follows the lifecycle", () => {
    expect(isTransitionValid("INVESTIGATING", "IDENTIFIED")).toBe(true);
    expect(isTransitionValid("IDENTIFIED", "MONITORING")).toBe(true);
    expect(isTransitionValid("MONITORING", "RESOLVED")).toBe(true);
  });

  it("allows reopening and self-resolution", () => {
    expect(isTransitionValid("RESOLVED", "INVESTIGATING")).toBe(true);
    expect(isTransitionValid("INVESTIGATING", "RESOLVED")).toBe(true);
  });

  it("rejects same-status transitions", () => {
    expect(isTransitionValid("RESOLVED", "RESOLVED")).toBe(false);
    expect(isTransitionValid("INVESTIGATING", "INVESTIGATING")).toBe(false);
  });

  it("exposes the allowed transitions per status", () => {
    expect(allowedTransitions("INVESTIGATING")).toEqual([
      "IDENTIFIED",
      "MONITORING",
      "RESOLVED",
    ]);
  });

  it("guards isStatus", () => {
    expect(isStatus("RESOLVED")).toBe(true);
    expect(isStatus("SHIPPED")).toBe(false);
    expect(STATUSES.includes("MONITORING" as never)).toBe(true);
  });
});

describe("classification schema", () => {
  const valid = {
    title: "Checkout API returning 500s",
    summary: "Every order is failing with HTTP 500 since 14:05 UTC.",
    severity: "SEV1",
    affectedService: "checkout-api",
    affectedRegion: "us-east-1",
    symptoms: "500 errors on all orders",
    suggestedNextAction: "Roll back the last deploy",
    confidence: 0.91,
    missingInformation: null,
  };

  it("accepts a fully-populated classification", () => {
    expect(() => incidentClassificationSchema.parse(valid)).not.toThrow();
  });

  it("rejects unknown severity values", () => {
    expect(() =>
      incidentClassificationSchema.parse({ ...valid, severity: "SEV5" }),
    ).toThrow();
  });

  it("rejects out-of-range confidence", () => {
    expect(() =>
      incidentClassificationSchema.parse({ ...valid, confidence: 1.4 }),
    ).toThrow();
    expect(() =>
      incidentClassificationSchema.parse({ ...valid, confidence: -0.1 }),
    ).toThrow();
  });

  it("requires region to be null or a short string", () => {
    expect(() =>
      incidentClassificationSchema.parse({ ...valid, affectedRegion: null }),
    ).not.toThrow();
    expect(() =>
      incidentClassificationSchema.parse({ ...valid, affectedRegion: "x".repeat(200) }),
    ).toThrow();
  });

  it("rejects missing symptoms", () => {
    const missing = { ...valid, symptoms: "" };
    expect(() => incidentClassificationSchema.parse(missing)).toThrow();
  });
});

describe("mock classifier", () => {
  it("maps total-down language to SEV2 or higher", () => {
    const out = mockClassify("Everything is down, total outage, nobody can use the app");
    expect(["SEV1", "SEV2"]).toContain(out.severity);
    expect(out.missingInformation).toBeTruthy();
  });

  it("maps degraded language to SEV3", () => {
    const out = mockClassify("the api is slow and laggy for some users");
    expect(out.severity).toBe("SEV3");
  });

  it("defaults unknown content to SEV4 with low confidence", () => {
    const out = mockClassify("hello?");
    expect(out.severity).toBe("SEV4");
    expect(out.confidence).toBeLessThanOrEqual(0.6);
  });

  it("never invents a region it did not see", () => {
    const out = mockClassify("database is down");
    expect(out.affectedRegion).toBeNull();
  });
});
