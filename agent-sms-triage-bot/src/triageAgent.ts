import { Agent } from "@telnyx/edge-runtime";

export type Topic = "billing" | "support" | "sales" | "general";

export interface TriageEntry {
  at: number;
  from: string;
  text: string;
  topic: Topic;
  route: string;
  confidence: number;
}

export interface TriageState extends Record<string, unknown> {
  phoneNumber: string;
  fromNumber: string;
  triageHistory: TriageEntry[];
  totalMessages: number;
  topicCounts: Record<string, number>;
}

interface TriageEnv {
  TELNYX: {
    messages: {
      send(m: { from: string; to: string; text: string }): Promise<unknown>;
    };
    ai: {
      openai: {
        chat: {
          createCompletion(req: {
            model: string;
            messages: Array<{ role: string; content: string }>;
            max_tokens?: number;
            temperature?: number;
          }): Promise<{ choices: Array<{ message: { content: string } }> }>;
        };
      };
    };
  };
  AI_MODEL?: string;
}

const DEFAULT_MODEL = "moonshotai/Kimi-K2.6";

const CLASSIFY_SYSTEM_PROMPT = `You are an SMS triage classifier. Analyze the customer's message and classify it into one of these topics:
- billing: questions about invoices, payments, charges, refunds, account balance, subscription costs
- support: technical issues, bugs, how-to questions, product help, troubleshooting
- sales: questions about pricing, plans, demos, upgrades, new accounts, purchasing
- general: anything that doesn't fit the above categories

Return JSON only: {"topic": "billing"|"support"|"sales"|"general", "confidence": 0.0-1.0, "reason": "one short sentence"}

Do NOT include any text outside the JSON.`;

const DEFAULT_ROUTES: Record<Topic, string> = {
  billing: "billing-queue",
  support: "support-queue",
  sales: "sales-queue",
  general: "general-queue",
};

const REPLY_TEMPLATES: Record<Topic, string> = {
  billing: "Thanks for reaching out! I've routed your message to our Billing team. They'll get back to you within 24 hours. Reference: {route}",
  support: "Thanks for reaching out! I've routed your message to our Support team. They'll get back to you within 4 hours. Reference: {route}",
  sales: "Thanks for reaching out! I've routed your message to our Sales team. They'll get back to you within 2 hours. Reference: {route}",
  general: "Thanks for reaching out! I've routed your message to our team. They'll get back to you within 24 hours. Reference: {route}",
};

const TELNYX_API = "https://api.telnyx.com/v2";
const TOPICS: Topic[] = ["billing", "support", "sales", "general"];

/** KV key for a topic route: "route/billing" → "billing-queue" */
export function routeKey(topic: string): string {
  return `route/${topic}`;
}

/** Get a route from the KV REST API, falling back to the default. */
export async function getRouteFromKv(
  namespaceId: string,
  apiKey: string,
  topic: string,
): Promise<string> {
  const key = encodeURIComponent(routeKey(topic));
  const resp = await fetch(
    `${TELNYX_API}/storage/kvs/${namespaceId}/keys/${key}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!resp.ok) return DEFAULT_ROUTES[topic as Topic] || "general-queue";
  const value = await resp.text();
  return value || DEFAULT_ROUTES[topic as Topic] || "general-queue";
}

/** Get all routes from the KV REST API. */
export async function getAllRoutesFromKv(
  namespaceId: string,
  apiKey: string,
): Promise<Record<string, string>> {
  const routes: Record<string, string> = {};
  for (const topic of TOPICS) {
    routes[topic] = await getRouteFromKv(namespaceId, apiKey, topic);
  }
  return routes;
}

/** Put a route into the KV REST API. */
export async function putRouteToKv(
  namespaceId: string,
  apiKey: string,
  topic: string,
  queue: string,
): Promise<void> {
  const key = encodeURIComponent(routeKey(topic));
  await fetch(`${TELNYX_API}/storage/kvs/${namespaceId}/keys/${key}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "text/plain",
    },
    body: queue,
  });
}

/**
 * TriageAgent — one actor instance per inbound phone number.
 *
 * The route table lives in a KV namespace (global key-value store, accessed
 * via the Telnyx KV REST API). The fetch handler in index.ts reads/writes KV
 * and passes routes to the actor.
 *
 * Lifecycle:
 *   1. triage(from, text, routes) — LLM classifies, SMS reply with route, log
 *   2. getHistory() — return triage history from durable actor state
 */
export class TriageAgent extends Agent<TriageEnv, TriageState> {
  protected override initialState(): TriageState {
    return {
      phoneNumber: "",
      fromNumber: "",
      triageHistory: [],
      totalMessages: 0,
      topicCounts: { billing: 0, support: 0, sales: 0, general: 0 },
    };
  }

  /**
   * Triage an inbound SMS: classify via LLM, reply via SMS, log in durable state.
   * The routes map (from KV) is passed in so the actor can look up the route
   * for the classified topic.
   */
  async triage(
    from: string,
    text: string,
    routes: Record<string, string>,
  ): Promise<{ topic: Topic; route: string; confidence: number }> {
    const state = await this.getState();

    // Classify via LLM
    let topic: Topic = "general";
    let confidence = 0;

    try {
      const completion = await this.env.TELNYX.ai.openai.chat.createCompletion({
        model: this.env.AI_MODEL || DEFAULT_MODEL,
        messages: [
          { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
          { role: "user", content: `Customer message: "${text}"` },
        ],
        max_tokens: 2000,
        temperature: 0.2,
      });

      const content = completion.choices[0]?.message?.content?.trim() || "";
      if (!content) throw new Error("empty content from model");
      const cleaned = content.startsWith("```")
        ? content.split("\n").slice(1).join("\n").replace(/```/g, "").trim()
        : content;
      const parsed = JSON.parse(cleaned);
      topic = (["billing", "support", "sales", "general"].includes(parsed.topic) ? parsed.topic : "general") as Topic;
      confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
    } catch {
      topic = "general";
      confidence = 0;
    }

    // Look up route from the KV-provided routes map
    const route = routes[topic] || DEFAULT_ROUTES[topic] || "general-queue";

    // Send reply SMS via zero-credential binding
    const replyText = REPLY_TEMPLATES[topic].replace("{route}", route);
    try {
      await this.env.TELNYX.messages.send({
        from: state.fromNumber || state.phoneNumber,
        to: from,
        text: replyText,
      });
    } catch {
      // best-effort — still log the triage entry
    }

    // Log the triage entry in durable actor state
    const entry: TriageEntry = {
      at: Date.now(),
      from,
      text,
      topic,
      route,
      confidence,
    };

    const topicCounts = { ...state.topicCounts };
    topicCounts[topic] = (topicCounts[topic] || 0) + 1;

    await this.setState({
      ...state,
      triageHistory: [...state.triageHistory, entry].slice(-100),
      totalMessages: state.totalMessages + 1,
      topicCounts,
    });

    return { topic, route, confidence };
  }

  /**
   * Get triage history from durable actor state.
   */
  async getHistory(limit = 20): Promise<{ entries: TriageEntry[]; total: number; topicCounts: Record<string, number> }> {
    const state = await this.getState();
    return {
      entries: state.triageHistory.slice(-limit),
      total: state.totalMessages,
      topicCounts: state.topicCounts,
    };
  }

  /**
   * Get debug state for inspection.
   */
  async getDebugState(): Promise<TriageState> {
    return await this.getState();
  }
}
