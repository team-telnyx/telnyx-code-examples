import { describe, expect, it } from "vitest";
import { buildGraph } from "../src/graph.js";

describe("LangGraph wiring", () => {
  it("builds a ReAct graph without running a model request", () => {
    const graph = buildGraph({ apiKey: "test-key" });
    expect(typeof graph.invoke).toBe("function");
  });
});

