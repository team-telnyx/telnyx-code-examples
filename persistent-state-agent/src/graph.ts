import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { TelnyxBoundChatModel } from "./telnyx-bound-chat-model.js";
import { lookupLead, smalltalkFallback, asksForLead, asksForMeeting } from "./tools.js";
import { createOrUpdateLead, assignSdr, checkSdrAvailability } from "./salesforce.js";
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
  "If the user asks about Salesforce, onboarding, package status, CRM, or a lead, the action node will look it up. " +
  "If the user asks to schedule or book a meeting, the action node will create a lead and start the scheduling flow.";

const INTENT_SYSTEM_PROMPT =
  "Classify the user's message intent. Reply with exactly one word: " +
  "'schedule_meeting' if they want to schedule, book, or arrange a meeting, call, or appointment. " +
  "'lead' if they ask about Salesforce, CRM, prospects, MQLs, leads, onboarding, package status, or status updates. " +
  "'smalltalk' for greetings, thanks, or general chat. " +
  "Reply with only the word, no punctuation.";

const RESPONSE_SYSTEM_PROMPT =
  "You are replying to Anusha by customer-support SMS. Keep it to one or two sentences. " +
  "If Salesforce details are provided, summarize them as onboarding/customer context rather than a raw CRM dump. " +
  "If a meeting has been scheduled, confirm that the request was received and the SDR will be contacted.";

export const GraphState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: (_, y) => y }),
  intentLabel: Annotation<Intent>(),
  actionResult: Annotation<string>(),
  replyText: Annotation<string>(),
  nodePath: Annotation<string[]>({ reducer: (x, y) => [...x, ...y], default: () => [] }),
  historyCount: Annotation<number>(),
  recordId: Annotation<string>(),
  scheduleMeetingPending: Annotation<boolean>({ value: (_, y) => y, default: () => false }),
  requestedTime: Annotation<string>({ value: (_, y) => y, default: () => "" }),
  customerName: Annotation<string>({ value: (_, y) => y, default: () => "" }),
  customerContext: Annotation<string>({ value: (_, y) => y, default: () => "" }),
  leadId: Annotation<string>({ value: (_, y) => y, default: () => "" }),
  assignedSdr: Annotation<string>({ value: (_, y) => y, default: () => "" }),
  sdrAvailable: Annotation<boolean>({ value: (_, y) => y, default: () => false }),
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
    const intent: Intent = trimmed.includes("schedule_meeting")
      ? "schedule_meeting"
      : trimmed.includes("lead")
        ? "lead"
        : trimmed.includes("smalltalk")
          ? "smalltalk"
          : "unknown";
    console.log("[graph] intent classified", { raw: trimmed, intent });
    return { intentLabel: intent, nodePath: ["intent"], historyCount: state.messages.length };
  }

  async function actionNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const lastUserMessage = [...state.messages].reverse().find((m) => m._getType() === "human");
    const userText = lastUserMessage ? contentToString(lastUserMessage.content) : "";

    if (asksForMeeting(userText) || state.intentLabel === "schedule_meeting") {
      console.log("[graph] schedule_meeting action branch");
      const customerName = env.DEMO_CUSTOMER_NAME || "Anusha";
      const customerEmail = env.SF_DEMO_LEAD_EMAIL || "anusha@telnyx.com";
      const requestedTime = extractRequestedTime(userText);
      const customerContext = "Telnyx onboarding";

      console.log("[graph] createOrUpdateLead", { customerName, customerEmail, requestedTime });
      const leadResult = await createOrUpdateLead(env, {
        name: customerName,
        company: "Telnyx",
        email: customerEmail,
        shipment: "Telnyx",
        requested_meeting_time: requestedTime,
        customer_context: customerContext,
        meeting_status: "Requested",
      });
      console.log("[graph] lead created/updated", { leadId: leadResult.lead.id, created: leadResult.created });

      console.log("[graph] assignSdr", { leadId: leadResult.lead.id });
      const sdrResult = await assignSdr(env, leadResult.lead.id);
      console.log("[graph] SDR assigned", { assigned_sdr: sdrResult.assigned_sdr });

      console.log("[graph] checkSdrAvailability", { sdr: sdrResult.assigned_sdr, time: requestedTime });
      const availResult = await checkSdrAvailability(env, sdrResult.assigned_sdr, requestedTime);
      console.log("[graph] SDR availability", { available: availResult.available });

      const summary = `Meeting requested for ${requestedTime}. Lead ${leadResult.lead.id} created in Salesforce. ${sdrResult.assigned_sdr} assigned as SDR. Availability: ${availResult.available ? "available" : "not available"}. The orchestrator will email ${sdrResult.assigned_sdr} via Agent Mail to confirm.`;

      return {
        actionResult: summary,
        recordId: leadResult.lead.id,
        nodePath: ["action"],
        scheduleMeetingPending: true,
        requestedTime,
        customerName,
        customerContext,
        leadId: leadResult.lead.id,
        assignedSdr: sdrResult.assigned_sdr,
        sdrAvailable: availResult.available,
      };
    }

    if (asksForLead(userText) || state.intentLabel === "lead") {
      console.log("[graph] lead action branch");
      const { recordId, summary } = await lookupLead(env);
      return {
        actionResult: summary,
        recordId,
        nodePath: ["action"],
      };
    }

    console.log("[graph] smalltalk action branch");
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
    console.log("[graph] response generated", { replyLength: content.length });
    return { replyText: content, nodePath: ["response"] };
  }

  const graph = new StateGraph(GraphState)
    .addNode("intent", intentNode)
    .addNode("action", actionNode)
    .addNode("response", responseNode)
    .addEdge(START, "intent")
    .addConditionalEdges("intent", (state: GraphStateType) => {
      if (state.intentLabel === "schedule_meeting" || state.intentLabel === "lead") {
        return "action";
      }
      return "response";
    })
    .addEdge("action", "response")
    .addEdge("response", END);

  return graph.compile();
}

function extractRequestedTime(text: string): string {
  const lower = text.toLowerCase();
  const timeMatch = lower.match(/(\bmonday|tuesday|wednesday|thursday|friday|saturday|sunday\b).*(\d{1,2}\s*(?:am|pm))?/i);
  if (timeMatch) {
    return timeMatch[0].trim();
  }
  const simpleTimeMatch = lower.match(/\b\d{1,2}\s*(?:am|pm)\b/i);
  if (simpleTimeMatch) return simpleTimeMatch[0];
  return "a time to be determined";
}
