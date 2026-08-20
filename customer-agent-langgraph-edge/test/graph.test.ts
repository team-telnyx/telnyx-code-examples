import { describe, it, expect, vi } from "vitest";
import { HumanMessage } from "@langchain/core/messages";

// Mock the TelnyxBoundChatModel so graph tests focus on routing, not LLM
vi.mock("../src/telnyx-bound-chat-model.js", () => {
  return {
    TelnyxBoundChatModel: vi.fn().mockImplementation((opts: { env: unknown; model: string }) => ({
      invoke: vi.fn(async (messages: Array<{ _getType: () => string; content: unknown }>) => {
        const systemMsg = messages.find((m) => m._getType() === "system");
        const systemContent = typeof systemMsg?.content === "string" ? systemMsg.content : "";
        if (systemContent.toLowerCase().includes("classify")) {
          return { content: "lead" };
        }
        return { content: "The latest Salesforce lead is Anusha Demo Lead at Telnyx, status MQL." };
      }),
      _llmType: () => "telnyx-bound-mock",
    })),
  };
});

import { buildGraph } from "../src/graph.js";
import type { Env } from "../src/types.js";

function makeMockEnv(): Env {
  return {
    TELNYX: {
      ai: {
        openai: {
          chat: {
            createCompletion: vi.fn(),
          },
        },
      },
    },
  } as unknown as Env;
}

describe("LangGraph StateGraph routing", () => {
  it("routes 'lead' intent through the action node", async () => {
    const env = makeMockEnv();
    const graph = buildGraph(env, "zai-org/GLM-5.2");

    const result = await graph.invoke({
      messages: [new HumanMessage("show me the latest Salesforce lead")],
    });

    expect(result.intentLabel).toBe("lead");
    expect(result.actionResult).toContain("Anusha Demo Lead");
    expect(result.actionResult).toContain("MQL");
    expect(result.replyText).toBeTruthy();
  });

  it("routes 'smalltalk' intent directly to response (skips action)", async () => {
    const env = makeMockEnv();
    const graph = buildGraph(env, "zai-org/GLM-5.2");

    // Override the mock to classify as smalltalk
    const { TelnyxBoundChatModel } = await import("../src/telnyx-bound-chat-model.js");
    vi.mocked(TelnyxBoundChatModel).mockImplementationOnce(() => ({
      invoke: vi.fn(async (messages: Array<{ _getType: () => string; content: unknown }>) => {
        const systemMsg = messages.find((m) => m._getType() === "system");
        const systemContent = typeof systemMsg?.content === "string" ? systemMsg.content : "";
        if (systemContent.toLowerCase().includes("classify")) {
          return { content: "smalltalk" };
        }
        return { content: "Hi there! How can I help with your customer context?" };
      }),
      _llmType: () => "telnyx-bound-mock",
    }) as never);

    const graph2 = buildGraph(env, "zai-org/GLM-5.2");
    const result = await graph2.invoke({
      messages: [new HumanMessage("hi there")],
    });

    expect(result.intentLabel).toBe("smalltalk");
    expect(result.actionResult).toBeUndefined();
    expect(result.replyText).toBeTruthy();
  });

  it("action node runs for Salesforce lead requests", async () => {
    const env = makeMockEnv();
    const graph = buildGraph(env, "zai-org/GLM-5.2");

    const result = await graph.invoke({
      messages: [new HumanMessage("any latest CRM prospect?")],
    });

    expect(result.intentLabel).toBe("lead");
    expect(result.actionResult).toContain("Anusha Demo Lead");
  });

  it("skips action for non-lead messages", async () => {
    const env = makeMockEnv();
    const { TelnyxBoundChatModel } = await import("../src/telnyx-bound-chat-model.js");
    vi.mocked(TelnyxBoundChatModel).mockImplementationOnce(() => ({
      invoke: vi.fn(async (messages: Array<{ _getType: () => string; content: unknown }>) => {
        const systemMsg = messages.find((m) => m._getType() === "system");
        const systemContent = typeof systemMsg?.content === "string" ? systemMsg.content : "";
        if (systemContent.toLowerCase().includes("classify")) {
          return { content: "smalltalk" };
        }
        return { content: "You're welcome." };
      }),
      _llmType: () => "telnyx-bound-mock",
    }) as never);

    const graph = buildGraph(env, "zai-org/GLM-5.2");
    const result = await graph.invoke({
      messages: [new HumanMessage("thanks")],
    });

    expect(result.intentLabel).toBe("smalltalk");
    expect(result.actionResult).toBeUndefined();
  });
});
