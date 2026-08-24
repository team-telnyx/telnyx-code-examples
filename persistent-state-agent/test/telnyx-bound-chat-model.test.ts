import { describe, it, expect, vi } from "vitest";
import { SimpleChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { TelnyxBoundChatModel } from "../src/telnyx-bound-chat-model.js";
import type { Env } from "../src/types.js";

type CreateCompletionRequest = { model: string; messages: Array<{ role: string; content: string }> };

function makeMockEnv(createCompletion: ReturnType<typeof vi.fn>): Env {
  return {
    TELNYX: {
      ai: {
        openai: {
          chat: {
            createCompletion: createCompletion as never,
          },
        },
      },
    },
  } as unknown as Env;
}

function mockCall(fn: ReturnType<typeof vi.fn>, index: number): CreateCompletionRequest {
  return fn.mock.calls[index]![0] as CreateCompletionRequest;
}

describe("TelnyxBoundChatModel", () => {
  it("is a SimpleChatModel subclass", () => {
    const env = makeMockEnv(vi.fn());
    const model = new TelnyxBoundChatModel({ env, model: "zai-org/GLM-5.2" });
    expect(model).toBeInstanceOf(SimpleChatModel);
    expect(model._llmType()).toBe("telnyx-bound");
  });

  it("calls env.TELNYX.ai.openai.chat.createCompletion with { model, messages }", async () => {
    const createCompletion = vi.fn(async () => ({
      choices: [{ message: { content: "Hello back" } }],
    }));
    const env = makeMockEnv(createCompletion);
    const model = new TelnyxBoundChatModel({ env, model: "zai-org/GLM-5.2" });

    const result = await model.invoke([new HumanMessage("hello")]);

    expect(createCompletion).toHaveBeenCalledTimes(1);
    const call = mockCall(createCompletion, 0);
    expect(call.model).toBe("zai-org/GLM-5.2");
    expect(call.messages).toEqual([{ role: "user", content: "hello" }]);
    const content = typeof result === "string" ? result : result.content;
    expect(content).toBe("Hello back");
  });

  it("maps SystemMessage to role 'system' and HumanMessage to role 'user'", async () => {
    const createCompletion = vi.fn(async () => ({
      choices: [{ message: { content: "ok" } }],
    }));
    const env = makeMockEnv(createCompletion);
    const model = new TelnyxBoundChatModel({ env, model: "zai-org/GLM-5.2" });

    await model.invoke([
      new SystemMessage("you are helpful"),
      new HumanMessage("hi"),
    ]);

    const call = mockCall(createCompletion, 0);
    expect(call.messages[0]).toEqual({ role: "system", content: "you are helpful" });
    expect(call.messages[1]).toEqual({ role: "user", content: "hi" });
  });

  it("maps AIMessage to role 'assistant'", async () => {
    const createCompletion = vi.fn(async () => ({
      choices: [{ message: { content: "continuing" } }],
    }));
    const env = makeMockEnv(createCompletion);
    const model = new TelnyxBoundChatModel({ env, model: "zai-org/GLM-5.2" });

    await model.invoke([
      new HumanMessage("hi"),
      new AIMessage("hello"),
      new HumanMessage("more?"),
    ]);

    const call = mockCall(createCompletion, 0);
    expect(call.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "more?" },
    ]);
  });

  it("throws when createCompletion returns no content", async () => {
    const createCompletion = vi.fn(async () => ({
      choices: [{ message: { content: null } }],
    }));
    const env = makeMockEnv(createCompletion);
    const model = new TelnyxBoundChatModel({ env, model: "zai-org/GLM-5.2" });

    await expect(model.invoke([new HumanMessage("hi")])).rejects.toThrow(/no content/);
  });

  it("throws when createCompletion returns empty choices", async () => {
    const createCompletion = vi.fn(async () => ({ choices: [] }));
    const env = makeMockEnv(createCompletion);
    const model = new TelnyxBoundChatModel({ env, model: "zai-org/GLM-5.2" });

    await expect(model.invoke([new HumanMessage("hi")])).rejects.toThrow(/no content/);
  });
});
