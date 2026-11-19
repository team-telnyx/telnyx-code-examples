import { describe, expect, it } from "vitest";
import { isValidE164, lastFour, maskPhone, normalizeE164 } from "../src/lib/phone";

describe("normalizeE164", () => {
  it("normalizes common US formats", () => {
    expect(normalizeE164("(800) 555-0123")).toBe("+18005550123");
    expect(normalizeE164("+1 800 555 0123")).toBe("+18005550123");
    expect(normalizeE164("800-555-0123")).toBe("+18005550123");
    expect(normalizeE164("+18005550123")).toBe("+18005550123");
  });

  it("handles 1-prefixed 11-digit input", () => {
    expect(normalizeE164("18005550123")).toBe("+18005550123");
  });

  it("keeps explicit + numbers from other countries", () => {
    expect(normalizeE164("+44 20 7183 8750")).toBe("+442071838750");
  });

  it("rejects junk", () => {
    expect(normalizeE164("nope")).toBeNull();
    expect(normalizeE164("")).toBeNull();
    expect(normalizeE164("12345")).toBeNull();
    expect(normalizeE164("+")).toBeNull();
  });
});

describe("isValidE164", () => {
  it("validates normalized values", () => {
    expect(isValidE164("+18005550123")).toBe(true);
    expect(isValidE164("8005550123")).toBe(true);
    expect(isValidE164("not-a-phone")).toBe(false);
  });
});

describe("maskPhone", () => {
  it("keeps country code and last four only", () => {
    expect(maskPhone("+18005550123")).toBe("+1 ••• ••• 0123");
  });

  it("handles partial input safely", () => {
    expect(maskPhone("junk")).toBe("•••");
  });

  it("handles short numbers without throwing", () => {
    // +1234 is not a valid E.164 (too short) — degrades to a fully masked value.
    expect(maskPhone("+1234")).toBe("•••");
  });
});

describe("lastFour", () => {
  it("extracts last four digits", () => {
    expect(lastFour("+18005550123")).toBe("0123");
  });

  it("returns null for junk input", () => {
    expect(lastFour("junk")).toBeNull();
  });
});
