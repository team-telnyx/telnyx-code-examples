import { describe, expect, it } from "vitest";
import { makeActor, stateOf, type MockInferenceCall } from "./helpers.js";

describe("DocActor", () => {
  it("starts with empty initial state", async () => {
    const actor = makeActor("improved text");
    const state = await stateOf(actor);
    expect(state.text).toBe("");
    expect(state.cursors).toEqual({});
    expect(state.suggestions).toEqual([]);
    expect(state.lastSuggestionAt).toBe(0);
  });

  it("edit replaces the document text", async () => {
    const actor = makeActor(null);
    await actor.edit("alice", "hello world");
    expect((await stateOf(actor)).text).toBe("hello world");
  });

  it("setCursor merges cursors per user", async () => {
    const actor = makeActor(null);
    await actor.setCursor("alice", { line: 1, col: 2 });
    await actor.setCursor("bob", { line: 3, col: 4 });
    expect((await stateOf(actor)).cursors).toEqual({
      alice: { line: 1, col: 2 },
      bob: { line: 3, col: 4 },
    });
  });

  it("runCopilot calls the Telnyx binding and stores a suggestion", async () => {
    const calls: MockInferenceCall[] = [];
    const actor = makeActor("improved text", calls);
    await actor.edit("alice", "rough draft text");
    const result = await actor.runCopilot();
    expect(result.status).toBe("ok");
    expect(calls).toHaveLength(1);
    expect(calls[0].messages[0].role).toBe("system");
    expect(calls[0].messages[1].content).toContain("rough draft text");
    const state = await stateOf(actor);
    expect(state.suggestions).toHaveLength(1);
    expect(state.suggestions[0].suggestedText).toBe("improved text");
    expect(state.suggestions[0].id).toBeTruthy();
  });

  it("runCopilot is rate-limited by lastSuggestionAt", async () => {
    const calls: MockInferenceCall[] = [];
    const actor = makeActor("improved", calls);
    await actor.edit("alice", "some text");
    expect((await actor.runCopilot()).status).toBe("ok");
    expect((await actor.runCopilot()).status).toBe("rate_limited");
    expect(calls).toHaveLength(1);
  });

  it("runCopilot skips empty documents", async () => {
    const calls: MockInferenceCall[] = [];
    const actor = makeActor("improved", calls);
    expect((await actor.runCopilot()).status).toBe("empty");
    expect(calls).toHaveLength(0);
  });

  it("respondSuggestion with accepted applies the suggested text", async () => {
    const actor = makeActor("better text");
    await actor.edit("alice", "rough");
    await actor.runCopilot();
    const { suggestions } = await stateOf(actor);
    const after = await actor.respondSuggestion(suggestions[0].id, true);
    expect(after.text).toBe("better text");
    expect(after.suggestions).toHaveLength(0);
  });

  it("respondSuggestion with rejected only removes the suggestion", async () => {
    const actor = makeActor("better text");
    await actor.edit("alice", "rough");
    await actor.runCopilot();
    const { suggestions } = await stateOf(actor);
    const after = await actor.respondSuggestion(suggestions[0].id, false);
    expect(after.text).toBe("rough");
    expect(after.suggestions).toHaveLength(0);
  });

  it("respondSuggestion with unknown id is a no-op", async () => {
    const actor = makeActor("better text");
    await actor.edit("alice", "rough");
    await actor.runCopilot();
    const before = await stateOf(actor);
    const after = await actor.respondSuggestion("nope", true);
    expect(after).toEqual(before);
  });

  it("respects AI_MODEL env var in inference calls", async () => {
    const calls: MockInferenceCall[] = [];
    const actor = makeActor("improved", calls, { AI_MODEL: "test/model-1" });
    await actor.edit("alice", "text");
    await actor.runCopilot();
    expect(calls[0].model).toBe("test/model-1");
    expect((await stateOf(actor)).suggestions[0].model).toBe("test/model-1");
  });
});
