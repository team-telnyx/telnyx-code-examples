import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { lookupOrderTool } from "./tools.js";
import type { CustomerProfile } from "./tools.js";

const DEFAULT_MODEL = "zai-org/GLM-5.3-Flash";
const BASE_SYSTEM_PROMPT =
  "You are a concise order-status support agent. " +
  "Use lookup_order when the customer asks about an order. " +
  "Answer in one or two sentences.";

export function buildGraph(options: { apiKey?: string; model?: string; customer?: CustomerProfile | null } = {}) {
  const llm = new ChatOpenAI({
    apiKey: options.apiKey ?? process.env.TELNYX_API_KEY,
    model: options.model ?? process.env.TELNYX_MODEL ?? DEFAULT_MODEL,
    configuration: {
      baseURL: process.env.TELNYX_BASE_URL ?? "https://api.telnyx.com/v2/ai/openai",
    },
  });

  const customerContext = options.customer
    ? `The authenticated customer is ${options.customer.name}. Their known orders are ${options.customer.orders.join(", ")}. If they ask about their order without an ID, use their most recent order, ${options.customer.orders[0]}. Do not ask them to repeat the order ID unless lookup fails.`
    : "The customer is not recognized by phone number. Ask for the order ID before looking up an order.";

  return createReactAgent({
    llm,
    tools: [lookupOrderTool],
    stateModifier: `${BASE_SYSTEM_PROMPT} ${customerContext}`,
  });
}

