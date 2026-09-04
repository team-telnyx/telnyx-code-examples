import { describe, expect, it } from "vitest";
import { clampPlayhead, isSpeed, SPEEDS } from "../src/types.js";

describe("clampPlayhead", () => {
  it("keeps an in-range index unchanged", () => {
    expect(clampPlayhead(3, 10)).toBe(3);
  });

  it("floors negative and non-numeric input to 0", () => {
    expect(clampPlayhead(-5, 10)).toBe(0);
    expect(clampPlayhead(Number.NaN, 10)).toBe(0);
  });

  it("caps at total (the finished position)", () => {
    expect(clampPlayhead(99, 10)).toBe(10);
  });

  it("truncates fractional input", () => {
    expect(clampPlayhead(4.7, 10)).toBe(4);
  });
});

describe("isSpeed", () => {
  it("accepts every advertised speed", () => {
    for (const speed of SPEEDS) expect(isSpeed(speed)).toBe(true);
  });

  it("rejects unadvertised multipliers", () => {
    expect(isSpeed(3)).toBe(false);
    expect(isSpeed("2")).toBe(false);
    expect(isSpeed(0)).toBe(false);
  });
});
