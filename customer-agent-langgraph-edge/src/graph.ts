import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { TelnyxBoundChatModel } from "./telnyx-bound-chat-model.js";
import { lookupLead, smalltalkFallback, asksForLead } from "./tools.js";
import type { Env, Intent } from "./types.js";

function contentToString(content: BaseMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text: string }).text);
        }
        return "";
      })
      .join("");
  }
  return String(content ?? "");
}

const SYSTEM_PROMPT =
  "You are a concise CustomerAgent for Telnyx. " +
  "Answer in one or two sentences as a customer-success concierge helping Anusha with onboarding. " +
  "If the user asks about Salesforce, onboarding, package status, CRM, or a lead, the action node will look it up.";

const INTENT_SYSTEM_PROMPT =
  "Classify the user's message intent. Reply with exactly one word: " +
  "'lead' if they ask about Salesforce, CRM, prospects, MQLs, leads, onboarding, package status, or status updates. " +
  "'smalltalk' for greetings, thanks, or general chat. " +
  "Reply with only the word, no punctuation.";

const RESPONSE_SYSTEM_PROMPT =
  "You are replying to Anusha by customer-support SMS. Keep it to one or two sentences. " +
  "If Salesforce details are provided, summarize them as onboarding/customer context rather than a raw CRM dump.";

export const GraphState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: (_, y) => y }),
  intentLabel: Annotation<Intent>(),
  actionResult: Annotation<string>(),
  replyText: Annotation<string>(),
  nodePath: Annotation<string[]>({ reducer: (x, y) => [...x, ...y], default: () => [] }),
  historyCount: Annotation<number>(),
  recordId: Annotation<string>(),
});

export type GraphStateType = typeof GraphState.State;

export function buildGraph(env: Env, model: string) {
  const llm = new TelnyxBoundChatModel({ env, model });

  async function intentNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const result = await llm.invoke([
      new SystemMessage(INTENT_SYSTEM_PROMPT),
      ...state.messages,
    ]);
    const content = contentToString(typeof result === "string" ? result : result.content);
    const trimmed = content.trim().toLowerCase();
    const intent: Intent = trimmed.includes("lead") ? "lead" : trimmed.includes("smalltalk") ? "smalltalk" : "unknown";
    return { intentLabel: intent, nodePath: ["intent"], historyCount: state.messages.length };
  }

  async function actionNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const lastUserMessage = [...state.messages].reverse().find((m) => m._getType() === "human");
    const userText = lastUserMessage ? contentToString(lastUserMessage.content) : "";
    if (asksForLead(userText) || state.intentLabel === "lead") {
      const { recordId, summary } = await lookupLead(env);
      return {
        actionResult: summary,
        recordId,
        nodePath: ["action"],
      };
    }
    return { actionResult: smalltalkFallback(), nodePath: ["action"] };
  }

  async function responseNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const systemContent = state.actionResult
      ? `${RESPONSE_SYSTEM_PROMPT}\n\nSalesforce context: ${state.actionResult}`
      : RESPONSE_SYSTEM_PROMPT;
    const result = await llm.invoke([
      new SystemMessage(systemContent),
      ...state.messages,
    ]);
    const content = contentToString(typeof result === "string" ? result : result.content);
    return { replyText: content, nodePath: ["response"] };
  }

  const graph = new StateGraph(GraphState)
    .addNode("intent", intentNode)
    .addNode("action", actionNode)
    .addNode("response", responseNode)
    .addEdge(START, "intent")
    .addConditionalEdges("intent", (state: GraphStateType) => {
      return state.intentLabel === "lead" ? "action" : "response";
    })
    .addEdge("action", "response")
    .addEdge("response", END);

  return graph.compile();
}
