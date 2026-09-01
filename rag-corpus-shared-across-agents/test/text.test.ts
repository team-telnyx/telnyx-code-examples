import { describe, expect, it } from "vitest";
import { chunkText } from "../src/text.js";

describe("chunkText", () => {
  it("returns an empty list for blank input", () => {
    expect(chunkText("  \n \n  ", 800, 150)).toEqual([]);
  });

  it("keeps a short document as a single chunk", () => {
    expect(chunkText("One short paragraph.", 800, 150)).toEqual(["One short paragraph."]);
  });

  it("collapses whitespace inside paragraphs and keeps oversized sets separate", () => {
    expect(chunkText("Line one\ncontinues here.\n\nLine two.", 26, 0)).toEqual([
      "Line one continues here.",
      "Line two.",
    ]);
  });

  it("packs small paragraphs into one chunk when they fit", () => {
    expect(chunkText("Line one continues here.\n\nLine two.", 800, 0)).toEqual([
      "Line one continues here. Line two.",
    ]);
  });

  it("packs paragraphs into chunks within the size limit", () => {
    const paragraphs = ["aaaa", "bbbb", "cccc"].join("\n\n");
    const chunks = chunkText(paragraphs, 10, 0);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(10);
    }
    expect(chunks.join(" ")).toContain("aaaa");
    expect(chunks.join(" ")).toContain("cccc");
  });

  it("hard-splits an oversized paragraph on word boundaries", () => {
    const long = "word ".repeat(60).trim();
    const chunks = chunkText(long, 40, 0);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(40);
    }
  });

  it("carries overlap between consecutive chunks", () => {
    const text = `${"a".repeat(50)}\n\n${"b".repeat(50)}`;
    const [first, second] = chunkText(text, 60, 20);
    expect(first.endsWith("a")).toBe(true);
    expect(second.startsWith("a".repeat(20))).toBe(true);
    expect(second.endsWith("b")).toBe(true);
  });
});
