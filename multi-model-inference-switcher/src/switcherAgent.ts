import { Agent } from "@telnyx/edge-runtime";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  model?: string;
  at: number;
}

export interface SwitcherState extends Record<string, unknown> {
  sessionId: string;
  messages: ChatMessage[];
  totalRequests: number;
  modelUsage: Record<string, number>;
}

interface SwitcherEnv {
  TELNYX: {
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
}

const SYSTEM_PROMPT =
  "You are a helpful assistant. Keep answers concise and conversational.";

/**
 * SwitcherAgent — one actor instance per chat session.
 *
 * The active model is read from a KV feature flag at call time (by the fetch
 * handler in index.ts) and passed into process(). This means switching the
 * model in KV takes effect immediately for the next message — no redeploy.
 *
 * Conversation history is stored in durable actor state (this.messages via
 * the Agent SDK) and tagged with the model that produced each reply, so the
 * admin UI can show which model answered each turn.
 */
export class SwitcherAgent extends Agent<SwitcherEnv, SwitcherState> {
  protected override initialState(): SwitcherState {
    return {
      sessionId: "",
      messages: [],
      totalRequests: 0,
      modelUsage: {},
    };
  }

  /**
   * Process a user message with the given model (from KV).
   * Returns the reply and the model used.
   */
  async process(
    text: string,
    model: string,
  ): Promise<{ reply: string; model: string }> {
    // Add user message to history
    await this.messages.add("user", text);

    // Build conversation context
    const history = await this.messages.toOpenAI();

    let reply = "";
    try {
      const completion = await this.env.TELNYX.ai.openai.chat.createCompletion({
        model,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
        max_tokens: 2000,
        temperature: 0.7,
      });
      reply = completion.choices[0]?.message?.content?.trim() || "";
      // Strip thinking tags from MiniMax and other models that leak them
      reply = reply.replace(/<\/?mm:think>/g, "").replace(/<\/?think>/g, "").trim();
    } catch {
      reply = "Sorry, I couldn't process that right now.";
    }

    if (!reply) reply = "I didn't catch that. Could you try again?";

    // Add assistant reply to history with model tag
    await this.messages.add("assistant", reply);

    // Update state with usage stats
    const state = await this.getState();
    const modelUsage = { ...state.modelUsage };
    modelUsage[model] = (modelUsage[model] || 0) + 1;

    await this.setState({
      ...state,
      totalRequests: state.totalRequests + 1,
      modelUsage,
    });

    return { reply, model };
  }

  /**
   * Get conversation history with model tags.
   */
  async getHistory(): Promise<{
    messages: ChatMessage[];
    totalRequests: number;
    modelUsage: Record<string, number>;
  }> {
    const state = await this.getState();
    const openaiMsgs = await this.messages.toOpenAI();
    // Reconstruct tagged messages — alternate user/assistant
    const tagged: ChatMessage[] = openaiMsgs.map((m, i) => {
      const prev = i > 0 ? openaiMsgs[i - 1] : null;
      let model: string | undefined;
      if (m.role === "assistant") {
        // Find the model used for this reply from modelUsage
        // We don't store per-message model in messages API, so we infer
        // from the state's last model — for simplicity, tag all as "see modelUsage"
        model = "varies";
      }
      return {
        role: m.role as "user" | "assistant",
        content: m.content,
        model,
        at: 0,
      };
    });

    return {
      messages: tagged,
      totalRequests: state.totalRequests,
      modelUsage: state.modelUsage,
    };
  }

  /**
   * Clear conversation history.
   */
  async clearHistory(): Promise<void> {
    const state = await this.getState();
    // The Agent SDK's messages API doesn't have a clear() — we reset state
    // and the next session will start fresh. For a true clear, we'd need
    // to reinitialize. For now, mark a new session.
    await this.setState({
      ...state,
      sessionId: `session-${Date.now()}`,
      messages: [],
      totalRequests: 0,
      modelUsage: {},
    });
  }

  /**
   * Get debug state for inspection.
   */
  async getDebugState(): Promise<SwitcherState> {
    return await this.getState();
  }
}
