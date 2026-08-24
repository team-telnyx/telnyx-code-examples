import { describe, it, expect, vi } from "vitest";
import { SimpleChatModel } from "@langchain/core/language_models/chat_models";
import {
  type BaseMessage,
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { StateGraph, Annotation, END, START } from "@langchain/langgraph";

// ============================================================================
// Q1 SPIKE: TelnyxBoundChatModel drives a real LangGraph StateGraph node
// against a mocked Telnyx API binding.
//
// PASS criteria:
//   1. TelnyxBoundChatModel compiles as a SimpleChatModel subclass.
//   2. A StateGraph with 2 nodes (intent, response) using the model invokes.
//   3. The mocked env.TELNYX.ai.openai.chat.createCompletion is called with
//      { model, messages: [{role, content}, ...] }.
//   4. The graph's final state contains the reply from the binding.
//
// FAIL → fall back to ChatOpenAI+key path (PRD §6.2 fallback).
// ============================================================================

// --- Minimal TelnyxBoundChatModel (the production adapter will be richer) ---

interface BoundEnv {
  TELNYX: {
    ai: {
      openai: {
        chat: {
          createCompletion: (req: {
            model: string;
            messages: Array<{ role: string; content: string }>;
          }) => Promise<{
            choices: Array<{ message: { content: string } }>;
          }>;
        };
      };
    };
  };
}

class TelnyxBoundChatModel extends SimpleChatModel {
  declare env: BoundEnv;
  declare model: string;

  constructor(opts: { env: BoundEnv; model: string }) {
    super({});
    this.env = opts.env;
    this.model = opts.model;
  }

  async _call(messages: BaseMessage[]): Promise<string> {
    const mapped = messages.map((m) => ({
      role: m._getType() === "human" ? "user" : m._getType() === "system" ? "system" : "assistant",
      content: typeof m.content === "string" ? m.content : String(m.content),
    }));
    const res = await this.env.TELNYX.ai.openai.chat.createCompletion({
      model: this.model,
      messages: mapped,
    });
    return res.choices[0]?.message?.content ?? "";
  }

  _llmType(): string {
    return "telnyx-bound";
  }
}

// --- Minimal 2-node StateGraph (intent → response) using the adapter ---

const SpikeState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: (_, y) => y }),
  intentLabel: Annotation<string>(),
  replyText: Annotation<string>(),
});

async function intentNode(state: typeof SpikeState.State) {
  const llm = spikeModel;
  const result = await llm.invoke([
    new SystemMessage("Classify the user message as 'order' or 'smalltalk'. Reply with one word."),
    ...state.messages,
  ]);
  const content = typeof result === "string" ? result : String((result as AIMessage).content);
  return { intentLabel: content.trim() };
}

async function responseNode(state: typeof SpikeState.State) {
  const llm = spikeModel;
  const result = await llm.invoke([
    new SystemMessage(`The intent is ${state.intentLabel}. Reply to the user in one sentence.`),
    ...state.messages,
  ]);
  const content = typeof result === "string" ? result : (result as AIMessage).content;
  return { replyText: content };
}

// --- Shared model + mock binding for the spike ---

let mockCreateCompletion: ReturnType<typeof vi.fn>;
let spikeModel: TelnyxBoundChatModel;

function buildSpikeModel() {
  mockCreateCompletion = vi.fn(async (req: { model: string; messages: Array<{ role: string; content: string }> }) => {
    // Simulate a model that classifies then replies
    const systemMsg = req.messages.find((m) => m.role === "system")?.content ?? "";
    if (systemMsg.toLowerCase().includes("classify")) {
      return { choices: [{ message: { content: "order" } }] };
    }
    const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
    return { choices: [{ message: { content: `Reply about: ${lastUser?.content ?? ""}` } }] };
  });
  const env: BoundEnv = {
    TELNYX: { ai: { openai: { chat: { createCompletion: mockCreateCompletion } } } },
  };
  spikeModel = new TelnyxBoundChatModel({ env, model: "zai-org/GLM-5.2" });
}

function buildSpikeGraph() {
  const graph = new StateGraph(SpikeState)
    .addNode("intent", intentNode)
    .addNode("response", responseNode)
    .addEdge(START, "intent")
    .addEdge("intent", "response")
    .addEdge("response", END);
  return graph.compile();
}

// --- The spike tests ---

describe("Q1 spike: TelnyxBoundChatModel + StateGraph", () => {
  it("compiles as a SimpleChatModel subclass and exposes _llmType", () => {
    buildSpikeModel();
    expect(spikeModel).toBeInstanceOf(SimpleChatModel);
    expect(spikeModel._llmType()).toBe("telnyx-bound");
  });

  it("invokes the mocked binding with { model, messages } and returns content", async () => {
    buildSpikeModel();
    const result = await spikeModel.invoke([new HumanMessage("where is my order?")]);
    expect(mockCreateCompletion).toHaveBeenCalledTimes(1);
    const call = mockCreateCompletion.mock.calls[0][0];
    expect(call.model).toBe("zai-org/GLM-5.2");
    expect(call.messages).toEqual([{ role: "user", content: "where is my order?" }]);
    const content = typeof result === "string" ? result : (result as AIMessage).content;
    expect(content).toBe("Reply about: where is my order?");
  });

  it("drives a 2-node StateGraph (intent → response) end-to-end", async () => {
    buildSpikeModel();
    const graph = buildSpikeGraph();
    const result = await graph.invoke({
      messages: [new HumanMessage("where is my order ORD-123?")],
    });
    // intent node called the binding to classify
    // response node called the binding to reply
    expect(mockCreateCompletion).toHaveBeenCalledTimes(2);
    expect(result.intentLabel).toBe("order");
    expect(result.replyText).toContain("Reply about:");
  });

  it("maps SystemMessage to role 'system' in the binding payload", async () => {
    buildSpikeModel();
    await spikeModel.invoke([
      new SystemMessage("you are helpful"),
      new HumanMessage("hi"),
    ]);
    const call = mockCreateCompletion.mock.calls[0][0];
    expect(call.messages[0]).toEqual({ role: "system", content: "you are helpful" });
    expect(call.messages[1]).toEqual({ role: "user", content: "hi" });
  });
});
