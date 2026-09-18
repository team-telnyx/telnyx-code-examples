import { describe, expect, it } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import { TelnyxStreamingChatModel } from "../src/telnyx-chat-model.js";
import { contentSse, toolCallSse, type RecordedCall } from "./helpers.js";
import type { TelnyxInferenceClient } from "../src/telnyx-client.js";
import type { Env } from "../src/types.js";
function envWith(scripted: string[], calls: RecordedCall[]): Env {
  let index = 0;
  const telnyx: TelnyxInferenceClient = {
    ai: {
      openai: {
        chat: {
          createCompletion: async (params) => {
            calls.push({ params });
            const body = scripted[index];
            index += 1;
            if (body === undefined) throw new Error("script exhausted");
            return body;
          },
        },
      },
    },
  };
  return { AGENTS: {}, TELNYX: telnyx, AI_MODEL: "test-model" } as unknown as Env;
}

function makeModel(env: Env): TelnyxStreamingChatModel {
  return new TelnyxStreamingChatModel({ env, model: "test-model" });
}

describe("TelnyxStreamingChatModel", () => {
  it("streams content deltas as AIMessageChunks", async () => {
    const calls: RecordedCall[] = [];
    const model = makeModel(envWith([contentSse("Order is in transit.")], calls));

    const chunks: string[] = [];
    for await (const generation of model._streamResponseChunks([])) {
      chunks.push(generation.text);
    }
    expect(chunks.join("")).toBe("Order is in transit.");
  });

  it("sends stream:true, model, and mapped messages to the binding", async () => {
    const calls: RecordedCall[] = [];
    const model = makeModel(envWith([contentSse("ok")], calls));

    const { HumanMessage, SystemMessage } = await import("@langchain/core/messages");
    await model.invoke([new SystemMessage("be brief"), new HumanMessage("hi")]);

    expect(calls).toHaveLength(1);
    const params = calls[0]!.params;
    expect(params.stream).toBe(true);
    expect(params.model).toBe("test-model");
    expect(params.messages).toEqual([
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" },
    ]);
    expect(params.tools).toBeUndefined();
  });

  it("accumulates streamed tool-call deltas into parsed tool_calls on invoke", async () => {
    const calls: RecordedCall[] = [];
    const model = makeModel(
      envWith([toolCallSse("lookup_order", '{"order_id": "ORD-1042"}')], calls),
    );

    const result = await model.invoke([]);
    expect(result).toBeInstanceOf(AIMessage);
    const merged = result as AIMessage;
    expect(merged.tool_calls).toHaveLength(1);
    expect(merged.tool_calls?.[0]?.name).toBe("lookup_order");
    expect(merged.tool_calls?.[0]?.args).toEqual({ order_id: "ORD-1042" });
  });

  it("bindTools forwards OpenAI-schema tools to the wire", async () => {
    const calls: RecordedCall[] = [];
    const model = makeModel(envWith([toolCallSse("lookup_order", "{}")], calls));
    const bound = model.bindTools([
      {
        name: "lookup_order",
        description: "Look up an order",
        schema: {
          type: "object",
          properties: { order_id: { type: "string" } },
          required: ["order_id"],
        },
      },
    ]);

    await bound.invoke([]);
    expect(calls[0]!.params.tools).toHaveLength(1);
    expect(calls[0]!.params.tools?.[0]).toMatchObject({
      type: "function",
      function: { name: "lookup_order" },
    });
    expect(calls[0]!.params.tool_choice).toBe("auto");
  });

  it("rejects a non-SSE (parsed object) response with a clear error", async () => {
    const env = envWith([], []);
    const client = env.TELNYX as unknown as {
      ai: { openai: { chat: { createCompletion: () => Promise<Record<string, unknown>> } } };
    };
    client.ai.openai.chat.createCompletion = async () => ({ choices: [] });
    const model = makeModel(env);
    await expect(model.invoke([])).rejects.toThrow(/raw SSE body/);
  });

  it("skips reasoning-only deltas (GLM reasoning_content chunks)", async () => {
    const raw =
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "thinking" }, finish_reason: null }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: { content: "answer" }, finish_reason: null }] })}\n\n`;
    const calls: RecordedCall[] = [];
    const model = makeModel(envWith([raw], calls));

    const texts: string[] = [];
    for await (const generation of model._streamResponseChunks([])) {
      texts.push(generation.text);
    }
    expect(texts).toEqual(["answer"]);
  });
});
