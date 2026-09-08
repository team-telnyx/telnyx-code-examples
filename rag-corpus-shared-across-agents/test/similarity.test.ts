import { describe, expect, it } from "vitest";
import { cosine } from "../src/similarity.js";

describe("cosine", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosine([1, 2], [-1, -2])).toBeCloseTo(-1, 10);
  });

  it("is magnitude-invariant", () => {
    expect(cosine([1, 1], [10, 10])).toBeCloseTo(1, 10);
  });

  it("returns 0 on length mismatch or empty input", () => {
    expect(cosine([], [])).toBe(0);
    expect(cosine([1], [1, 2])).toBe(0);
  });

  it("returns 0 when either vector is all zeros", () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});
