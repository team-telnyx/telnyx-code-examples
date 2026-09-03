import { Agent } from "@telnyx/edge-runtime";

// ── Per-call state ─────────────────────────────────────────────────────────
export type CallPhase =
  | "init"
  | "answering"
  | "greeting"
  | "gathering"
  | "classifying"
  | "announcing"
  | "transferring"
  | "done"
  | "error";

export interface RouterState extends Record<string, unknown> {
  callControlId: string;
  from: string;
  to: string;
  phase: CallPhase;
  speech: string;
  intent: string;
  destination: string;
  startedAt: number;
  endedAt: number;
  error: string;
}

// ── Env: [telnyx] binding for inference + [storage.kv.ROUTES] for the route table ──
interface RouterEnv {
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
  ROUTES: {
    get(key: string): Promise<string | null>;
    get<T>(key: string, options: { type: "json" }): Promise<T | null>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
    delete(key: string): Promise<void>;
  };
  AI_MODEL: string;
  DEFAULT_DESTINATION: string;
}

const DEFAULT_MODEL = "meta-llama/Llama-3.3-70B-Instruct";

const INTENT_SYSTEM_PROMPT = `You are an intent classifier for an inbound call router. Read the caller's spoken request and respond with EXACTLY ONE WORD from this list: billing, sales, support. Do not include any other text, punctuation, or explanation.`;

/**
 * RouterAgent — one actor instance per inbound call leg (keyed by call_control_id).
 *
 * Lifecycle (driven by webhook handler in index.ts):
 *   1. recordStart()              — capture callId, from, to, phase
 *   2. setGreeting()              — call.answered → speak() greeting playing
 *   3. setGathering()              — call.speak.ended (greeting) → gather_using_ai capturing
 *   4. classifyAndRoute(speech)   — call.ai_gather.ended → LLM intent → KV lookup → returns destination
 *   5. setAnnouncing(intent,dest)  — speak() "Transferring you to billing..." playing
 *   6. setTransferring()           — call.speak.ended (announcement) → transfer() fires
 *   7. onHangup()                  — cleanup
 *
 * Intent classification uses this.env.TELNYX.ai.openai.chat.createCompletion() (zero-credential).
 * Route destinations live in this.env.ROUTES (Telnyx KV) under keys like "route:billing".
 */
export class RouterAgent extends Agent<RouterEnv, RouterState> {
  protected override initialState(): RouterState {
    return {
      callControlId: "",
      from: "",
      to: "",
      phase: "init",
      speech: "",
      intent: "",
      destination: "",
      startedAt: 0,
      endedAt: 0,
      error: "",
    };
  }

  /** Webhook handler calls this on call.initiated. */
  async recordStart(callControlId: string, from: string, to: string): Promise<void> {
    await this.setState({
      callControlId,
      from,
      to,
      phase: "answering",
      speech: "",
      intent: "",
      destination: "",
      startedAt: Date.now(),
      endedAt: 0,
      error: "",
    });
  }

  async setGreeting(): Promise<void> {
    const state = await this.getState();
    await this.setState({ ...state, phase: "greeting" });
  }

  async setGathering(): Promise<void> {
    const state = await this.getState();
    await this.setState({ ...state, phase: "gathering" });
  }

  /**
   * Classify the caller's speech via the zero-credential Telnyx AI Inference binding,
   * then look up the transfer destination in Telnyx KV (env.ROUTES).
   *
   * Returns { intent, destination }. Falls back to DEFAULT_DESTINATION if the
   * KV key "route:<intent>" is missing or classification fails.
   */
  async classifyAndRoute(speech: string): Promise<{ intent: string; destination: string }> {
    const state = await this.getState();
    const trimmed = speech.trim();
    let intent = "support";
    let destination = this.env.DEFAULT_DESTINATION || "+17177247292";

    // ── Step 1: classify intent via Telnyx AI Inference (no API key in code) ──
    if (trimmed) {
      try {
        const model = this.env.AI_MODEL || DEFAULT_MODEL;
        const completion = await this.env.TELNYX.ai.openai.chat.createCompletion({
          model,
          messages: [
            { role: "system", content: INTENT_SYSTEM_PROMPT },
            { role: "user", content: `Caller said: "${trimmed}"\n\nIntent:` },
          ],
          max_tokens: 5,
          temperature: 0.0,
        });
        const content = completion.choices[0]?.message?.content?.trim().toLowerCase() || "";
        // Pick the first matching label from the response (robust to model drift).
        const match = content.match(/\b(billing|sales|support)\b/);
        intent = match ? match[1] : "support";
      } catch {
        // Classification failed — fall back to the default intent.
        intent = "support";
      }
    }

    // ── Step 2: look up destination in Telnyx KV (env.ROUTES) ───────────────
    try {
      const kvValue = await this.env.ROUTES.get(`route/${intent}`);
      if (kvValue && kvValue.trim()) {
        destination = kvValue.trim();
      }
    } catch {
      // KV miss — keep the default destination.
    }

    await this.setState({
      ...state,
      speech: trimmed,
      intent,
      destination,
      phase: "classifying",
    });

    return { intent, destination };
  }

  async setAnnouncing(intent: string, destination: string): Promise<void> {
    const state = await this.getState();
    await this.setState({ ...state, intent, destination, phase: "announcing" });
  }

  async setTransferring(): Promise<void> {
    const state = await this.getState();
    await this.setState({ ...state, phase: "transferring" });
  }

  async onHangup(): Promise<void> {
    const state = await this.getState();
    if (state.phase === "done") return;
    await this.setState({ ...state, phase: "done", endedAt: Date.now() });
  }

  async getDebugState(): Promise<RouterState> {
    return await this.getState();
  }
}
