import { Agent, rpc } from "@telnyx/edge-runtime";
import type { ActorContext, Claim } from "@telnyx/edge-runtime";
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
 * Connections use the Agent SDK's built-in connection surface: once
 * `authorize` is overridden, the default `webSocket()` serves the whole
 * agent socket protocol — state snapshot on connect, live pushes of every
 * committed `setState`, and remote dispatch to the `@rpc()`-decorated
 * methods below. The browser side is `AgentClient` from
 * `@telnyx/edge-runtime/client`.
 */
export class DocActor extends Agent<Env, DocState> {
  protected initialState(): DocState {
    return { text: "", cursors: {}, suggestions: [], lastSuggestionAt: 0 };
  }

  /**
   * Connection policy. The demo grants every connection read + rpc —
   * production deployments must validate the token / identity headers
   * (`req`) here and only grant `rpc` to callers you trust.
   */
  protected override authorize(): readonly Claim[] {
    return ["read", "rpc"];
  }

  /**
   * Minimal socket override: track who is joining (from the `?name=` query)
   * so their cursor can be cleaned up when the socket closes, then hand the
   * socket to the built-in protocol via `super.webSocket()`.
   */
  override async webSocket(ws: import("ws").WebSocket, req: Request): Promise<void> {
    const user = new URL(req.url).searchParams.get("name") ?? "anonymous";
    ws.on("close", () => {
      void this.removeUser(user);
    });
    await super.webSocket(ws, req);
  }

  // ---- Remote surface (browser: `client.stub.<method>(...)`) --------------

  /** Replace the document text. Triggers the copilot via `onStateChanged`. */
  @rpc({ description: "Replace the document text as `user`" })
  async edit(user: string, text: string): Promise<DocState> {
    await this.setCursor(user, { line: 0, col: 0 });
    await this.setState({ text });
    return this.getState();
  }

  /** Update a participant's cursor position (also their presence marker). */
  @rpc({ description: "Update a participant's cursor position" })
  async setCursor(user: string, position: Cursor): Promise<DocState> {
    await this.setState({ cursors: { [user]: position } });
    return this.getState();
  }

  /** Accept (apply suggested text) or reject a copilot suggestion. */
  @rpc({ description: "Accept or reject a copilot suggestion by id" })
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
  @rpc({ description: "Manually trigger the AI copilot" })
  async requestSuggestion(): Promise<{ status: "ok" | "rate_limited" | "empty" }> {
    return this.runCopilot();
  }

  /** Idempotent create — materializes the actor and returns its state. */
  @rpc({ description: "Create the document if missing and return its state" })
  async touch(): Promise<DocState> {
    return this.getState();
  }

  /** Full state snapshot (used by the worker's REST endpoints). */
  @rpc({ description: "Fetch the current document state" })
  async snapshot(): Promise<DocState> {
    return this.getState();
  }

  /**
   * Copilot task. Called via `this.queue("runCopilot")` from
   * `onStateChanged` (its own turn — LLM latency must not block edits) and
   * directly by `requestSuggestion`. Rate-limited per document.
   */
  @rpc({ description: "Run one copilot pass over the current text" })
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
   * Fires after every durable state change. The built-in connection engine
   * already fans the new state out to every watcher — when the text changed,
   * queue the copilot as its own turn.
   */
  protected override async onStateChanged(next: DocState, prev: DocState): Promise<void> {
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
