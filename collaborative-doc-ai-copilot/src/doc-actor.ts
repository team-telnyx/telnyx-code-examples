import { Agent } from "@telnyx/edge-runtime";
import type { ActorContext } from "@telnyx/edge-runtime";
import { AgentSocketServer, type AgentServerSocket } from "@telnyx/edge-runtime/agent-socket";
import {
  cooldownMs,
  modelId,
  type Cursor,
  type DocState,
  type Env,
  type Suggestion,
} from "./types.js";

const COPILOT_SYSTEM_PROMPT =
  "You are an AI writing copilot inside a collaborative document editor. " +
  "Rewrite the user's document with clear improvements (clarity, grammar, structure). " +
  "Return ONLY the improved text — no commentary, no markdown fences.";

/** The SDK types `createCompletion`'s response as an open record — narrow it without casting. */
function firstMessageContent(response: unknown): string | null {
  if (typeof response !== "object" || response === null || !("choices" in response)) {
    return null;
  }
  const choices = (response as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (typeof first !== "object" || first === null || !("message" in first)) return null;
  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null || !("content" in message)) return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

/**
 * One collaborative document. The actor id (chosen via `env.DOCS.idFromName`)
 * is the document id, so each document gets its own single-threaded, durable
 * state — the same isolation model as a Cloudflare Durable Object.
 *
 * Clients connect over WebSocket (`/websocket?doc=<id>`) using the browser
 * `AgentClient` from `@telnyx/edge-runtime/client`. Every public async method
 * below is callable from the browser as `client.stub.<method>(...)` — the
 * AgentSocketServer dispatches `call` frames to them over the socket.
 */
export class DocActor extends Agent<Env, DocState> {
  /** Socket layer for this activation; created lazily on first connection. */
  private sockets?: AgentSocketServer<DocState>;

  constructor(ctx: ActorContext, env: Env) {
    super(ctx, env);
  }

  protected initialState(): DocState {
    return { text: "", cursors: {}, suggestions: [], lastSuggestionAt: 0 };
  }

  /**
   * Socket entry point. The platform hands us the accepted socket and the
   * handshake request; the AgentSocketServer speaks the agent-client protocol
   * on top: state snapshot + `hello` on connect, `call` frames dispatched to
   * this actor's public methods, patches broadcast on `setState`.
   */
  async webSocket(ws: AgentServerSocket, req: Request): Promise<void> {
    this.sockets ??= new AgentSocketServer<DocState>(this, {
      getState: () => this.getState(),
    });
    const url = new URL(req.url);
    const user = url.searchParams.get("name") ?? "anonymous";
    // Drop the departing user's cursor when their socket closes.
    ws.on("close", () => {
      void this.removeUser(user);
    });
    await this.sockets.attach(ws, req);
  }

  // ---- Public RPC surface (browser: `client.stub.<method>(...)`) ----------

  /** Replace the document text. Triggers the copilot via `onStateChanged`. */
  async edit(user: string, text: string): Promise<DocState> {
    await this.setCursor(user, { line: 0, col: 0 });
    await this.setState({ text });
    return this.getState();
  }

  /** Update a participant's cursor position (also their presence marker). */
  async setCursor(user: string, position: Cursor): Promise<DocState> {
    await this.setState({ cursors: { [user]: position } });
    return this.getState();
  }

  /** Accept (apply suggested text) or reject a copilot suggestion. */
  async respondSuggestion(suggestionId: string, accepted: boolean): Promise<DocState> {
    const state = await this.getState();
    const suggestion = state.suggestions.find((s) => s.id === suggestionId);
    if (!suggestion) return state;
    const remaining = state.suggestions.filter((s) => s.id !== suggestionId);
    await this.setState(
      accepted
        ? { text: suggestion.suggestedText, suggestions: remaining }
        : { suggestions: remaining },
    );
    return this.getState();
  }

  /** Manually request a copilot suggestion (rate-limited per document). */
  async requestSuggestion(): Promise<{ status: "ok" | "rate_limited" | "empty" }> {
    return this.runCopilot();
  }

  /** Idempotent create — materializes the actor and returns its state. */
  async touch(): Promise<DocState> {
    return this.getState();
  }

  /** Full state snapshot (used by the worker's REST endpoints). */
  async snapshot(): Promise<DocState> {
    return this.getState();
  }

  /**
   * Copilot task. Called via `this.queue("runCopilot")` from
   * `onStateChanged` (its own turn — LLM latency must not block edits) and
   * directly by `requestSuggestion`. Rate-limited per document.
   */
  async runCopilot(): Promise<{ status: "ok" | "rate_limited" | "empty" }> {
    const state = await this.getState();
    if (Date.now() - state.lastSuggestionAt < cooldownMs(this.env)) {
      return { status: "rate_limited" };
    }
    if (!state.text.trim()) return { status: "empty" };
    // Reserve the cooldown slot before the LLM call so a burst of edits
    // cannot stampede the inference API.
    await this.setState({ lastSuggestionAt: Date.now() });

    const model = modelId(this.env);
    const completion = await this.env.TELNYX.ai.openai.chat.createCompletion({
      model,
      messages: [
        { role: "system", content: COPILOT_SYSTEM_PROMPT },
        { role: "user", content: `Document content:\n\n${state.text}` },
      ],
      max_tokens: 500,
      temperature: 0.7,
    });
    const suggested = firstMessageContent(completion)?.trim();
    if (!suggested) return { status: "empty" };

    const suggestion: Suggestion = {
      id: crypto.randomUUID(),
      originalText: state.text,
      suggestedText: suggested,
      model,
      createdAt: Date.now(),
    };
    const current = await this.getState();
    await this.setState({ suggestions: [...current.suggestions, suggestion] });
    return { status: "ok" };
  }

  // ---- Internals -----------------------------------------------------------

  /**
   * Fires after every durable state change. Push the new state to every
   * watching socket, and when the text changed, queue the copilot as its own
   * turn.
   */
  protected async onStateChanged(next: DocState, prev: DocState): Promise<void> {
    if (this.sockets) this.sockets.broadcastSnapshot(next);
    if (next.text !== prev.text) {
      await this.queue("runCopilot");
    }
  }

  private async removeUser(user: string): Promise<void> {
    const state = await this.getState();
    if (!(user in state.cursors)) return;
    // Merge patch: `null` deletes the key (RFC 7396).
    await this.setState({ cursors: { [user]: null } });
  }
}
