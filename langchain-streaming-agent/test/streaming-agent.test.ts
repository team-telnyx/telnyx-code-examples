import { describe, expect, it } from "vitest";
import { makeAgent, contentSse, toolCallSse, waitFor, type AgentFixture } from "./helpers.js";

async function runTurn(fixture: AgentFixture, text: string): Promise<void> {
  await fixture.agent.send(text);
  await waitFor(async () => {
    const state = await fixture.state();
    return state.status === "idle" && (state.answeredThrough ?? 0) >= state.turn;
  });
}

describe("StreamingAgent end-to-end over scripted inference", () => {
  it("answers a simple question, streaming token events and committing history", async () => {
    const fixture = makeAgent([contentSse("Your order ships today.")]);
    await runTurn(fixture, "Hello there");

    const transcript = await fixture.agent.transcript();
    expect(transcript.messages).toEqual([
      { role: "user", content: "Hello there" },
      { role: "assistant", content: "Your order ships today." },
    ]);

    const events = await fixture.events();
    const tokens = events.filter((e) => e.type === "token");
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.map((e) => (e.payload as { text: string }).text).join("")).toBe(
      "Your order ships today.",
    );
    expect(tokens.every((e) => (e.payload as { turn: number }).turn === 1)).toBe(true);

    const state = await fixture.state();
    expect(state.status).toBe("idle");
    expect(state.toolsUsed).toBe(0);
  });

  it("executes a tool call, then streams the final answer from tool context", async () => {
    const fixture = makeAgent([
      toolCallSse("lookup_order", '{"order_id": "ORD-1042"}'),
      contentSse("Order ORD-1042 is in transit and arrives September 3."),
    ]);
    await runTurn(fixture, "Where is my order ORD-1042?");

    expect(fixture.calls).toHaveLength(2);
    // Round 1 carried the tools; round 2 included the tool result as a `tool`
    // message with the call linkage intact (required by OpenAI-compatible APIs).
    expect(fixture.calls[0]!.params.tools?.map((t) => t.function.name)).toEqual([
      "lookup_order",
      "get_return_policy",
    ]);
    const finalMessages = fixture.calls[1]!.params.messages;
    expect(finalMessages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call_test_1" });
    expect(finalMessages.at(-2)).toMatchObject({
      role: "assistant",
      tool_calls: [{ type: "function", function: { name: "lookup_order" } }],
    });

    const transcript = await fixture.agent.transcript();
    expect(transcript.messages.at(-1)).toEqual({
      role: "assistant",
      content: "Order ORD-1042 is in transit and arrives September 3.",
    });

    const events = await fixture.events();
    const toolStart = events.find((e) => e.type === "tool_start");
    expect(toolStart?.payload).toMatchObject({ tool: "lookup_order", turn: 1 });
    const toolResult = events.find((e) => e.type === "tool_result");
    expect(String((toolResult?.payload as { output: string }).output)).toContain("in transit");

    const state = await fixture.state();
    expect(state.toolsUsed).toBe(1);
  });

  it("keeps multi-turn context from this.messages.toLangChain()", async () => {
    const fixture = makeAgent([contentSse("Hi!"), contentSse("You mentioned the headset.")]);
    await runTurn(fixture, "I bought a headset");
    await runTurn(fixture, "What did I buy?");

    expect(fixture.calls[1]!.params.messages[0]).toMatchObject({ role: "system" });
    expect(fixture.calls[1]!.params.messages.slice(1)).toEqual([
      { role: "user", content: "I bought a headset" },
      { role: "assistant", content: "Hi!" },
      { role: "user", content: "What did I buy?" },
    ]);

    const state = await fixture.state();
    expect(state.turn).toBe(2);
    expect(state.answeredThrough).toBe(3);
  });

  it("answers every pending user turn when sends arrive back-to-back", async () => {
    const fixture = makeAgent([
      contentSse("Returns are free within 30 days."),
      contentSse("Send a photo for a prepaid label."),
    ]);
    // Rapid sends: no waiting between them.
    await fixture.agent.send("Can I return a headset?");
    await fixture.agent.send("My webcam arrived cracked — what do I do?");
    await waitFor(async () => {
      const state = await fixture.state();
      const transcript = await fixture.agent.transcript();
      const replies = transcript.messages.filter((m) => m.role === "assistant");
      return state.status === "idle" && replies.length >= 2;
    });

    const transcript = await fixture.agent.transcript();
    const replies = transcript.messages.filter((m) => m.role === "assistant");
    expect(replies).toHaveLength(2);
    // Each model call must answer ITS OWN question, not just the latest one.
    expect(fixture.calls[0]!.params.messages.at(-1)).toMatchObject({
      role: "user",
      content: "Can I return a headset?",
    });
    expect(fixture.calls[1]!.params.messages.at(-1)).toMatchObject({
      role: "user",
      content: "My webcam arrived cracked — what do I do?",
    });
  });

  it("ignores empty input without touching the model", async () => {
    const fixture = makeAgent([]);
    await fixture.agent.send("   ");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fixture.calls).toHaveLength(0);
  });
});
