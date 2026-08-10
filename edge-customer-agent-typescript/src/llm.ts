/**
 * LLM reasoning harness — Telnyx Inference (OpenAI-compatible).
 *
 * The Assistant is NOT durable. It is reconstructed on every activation
 * from the customer's state + the MessageLog. The actor (Ian) is what
 * persists; the Assistant is the reasoning/voice harness INSIDE the agent.
 */
import type { StoredMessage } from "@telnyx/edge-runtime";

const TELNYX_BASE_URL = "https://api.telnyx.com/v2/ai/openai";
const TELNYX_MODEL = "zai-org/GLM-5.2";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type LLMClient = {
  draftReply: (history: StoredMessage[], customerName: string, inboundText: string) => Promise<string>;
  draftFollowup: (customerName: string, lastInteractionSummary: string) => Promise<string>;
  draftProactive: (customerName: string, shipmentStatus: string, trackingNumber?: string) => Promise<string>;
  classifyIntent: (text: string) => Promise<"question" | "complaint" | "status_check" | "escalation" | "other">;
};

export function createLLMClient(apiKey: string | undefined): LLMClient {
  if (!apiKey) {
    return stubLLMClient;
  }

  async function chatCompletion(messages: LLMMessage[]): Promise<string> {
    const res = await fetch(`${TELNYX_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: TELNYX_MODEL, messages }),
    });
    if (!res.ok) throw new Error(`LLM error ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? "(empty response)";
  }

  return {
    async draftReply(history, customerName, inboundText) {
      const recent = history.slice(-10).map((m) => `${m.role}: ${m.content}`).join("\n");
      return chatCompletion([
        {
          role: "system",
          content: `You are a customer support agent for Telnyx. The customer's name is ${customerName}. You have full context from previous interactions. Be concise, helpful, and conversational. Previous context:\n${recent}`,
        },
        { role: "user", content: inboundText },
      ]);
    },

    async draftFollowup(customerName, lastInteractionSummary) {
      return chatCompletion([
        {
          role: "system",
          content: `You are a customer support agent for Telnyx. Write a brief SMS follow-up to ${customerName} after a phone call. The call summary: ${lastInteractionSummary}. Keep it under 160 characters. Be warm but professional.`,
        },
        { role: "user", content: "Draft the follow-up SMS." },
      ]);
    },

    async draftProactive(customerName, shipmentStatus, trackingNumber) {
      const tracking = trackingNumber ? ` Tracking number: ${trackingNumber}.` : "";
      return chatCompletion([
        {
          role: "system",
          content: `You are a customer support agent for Telnyx. Write a brief proactive SMS to ${customerName} about a shipment status change. New status: ${shipmentStatus}.${tracking} Keep it under 160 characters.`,
        },
        { role: "user", content: "Draft the proactive SMS." },
      ]);
    },

    async classifyIntent(text) {
      const reply = await chatCompletion([
        {
          role: "system",
          content: `Classify the customer message intent. Reply with exactly one word: question, complaint, status_check, escalation, or other.`,
        },
        { role: "user", content: text },
      ]);
      const trimmed = reply.trim().toLowerCase();
      if (trimmed === "question" || trimmed === "complaint" || trimmed === "status_check" || trimmed === "escalation" || trimmed === "other") {
        return trimmed;
      }
      return "other";
    },
  };
}

const stubLLMClient: LLMClient = {
  async draftReply(_history, customerName, inboundText) {
    await new Promise((r) => setTimeout(r, 250));
    return `Hi ${customerName}, thanks for your message about "${inboundText}". A team member will follow up shortly.`;
  },
  async draftFollowup(customerName) {
    await new Promise((r) => setTimeout(r, 250));
    return `Hi ${customerName}, thanks for calling Telnyx today! Is there anything else I can help with? Reply here or call us anytime.`;
  },
  async draftProactive(customerName, shipmentStatus, trackingNumber) {
    await new Promise((r) => setTimeout(r, 250));
    const tracking = trackingNumber ? ` Track: ${trackingNumber}.` : "";
    return `Hi ${customerName}, your shipment status changed to "${shipmentStatus}".${tracking} Questions? Call us anytime.`;
  },
  async classifyIntent(text) {
    if (/status|track|ship|delivery|order/i.test(text)) return "status_check";
    if (/escalat|supervisor|manager|human/i.test(text)) return "escalation";
    if (/complaint|broken|wrong|angry|unhappy/i.test(text)) return "complaint";
    if (text.includes("?")) return "question";
    return "other";
  },
};
