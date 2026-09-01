/**
 * ReplayAgent — the durable replay entity.
 *
 * One actor instance ("conversation id") holds one recording. Playback is a
 * durable `schedule()` chain: each `tick()` plays the next recorded step —
 * appending it to the MessageLog (which drives the live `messages` push),
 * re-enacting the original agent's state change (which broadcasts a state
 * patch), optionally generating LLM commentary (which lands on the event
 * stream) — then schedules the next tick at recording pacing divided by the
 * playback speed. Pausing is durable by construction: the next tick wakes,
 * sees the paused status, and exits.
 */
import {
  Agent,
  rpc,
  type Claim,
} from "@telnyx/edge-runtime";
import {
  AgentSocketServer,
  type AgentServerSocket,
} from "@telnyx/edge-runtime/agent-socket";
import {
  loadRecording,
  storeRecording,
  type RecordingInput,
} from "./script.js";
import { DEMO_CONVERSATION_ID, DEMO_SCRIPT } from "./demo-script.js";
import {
  clampPlayhead,
  isSpeed,
  SPEEDS,
  type ReplayEnv,
  type ReplayState,
} from "./types.js";

/**
 * Merge-patch shape for the flat ReplayState — structurally identical to the
 * SDK's `MergePatch<ReplayState>` for all-scalar state (each field is an
 * optional replace, `null` deletes).
 */
type ReplayStatePatch = {
  [K in keyof ReplayState]?: ReplayState[K] | null;
};

/** System prompt for the optional per-step LLM commentary. */
const COMMENTARY_SYSTEM_PROMPT = [
  "You are observing a replayed customer-support agent conversation.",
  "In one or two crisp sentences, annotate the most recent message:",
  "what the agent (or customer) achieved, what changed in the conversation state,",
  "and anything notable about the handling. Be concrete, neutral, and brief.",
].join(" ");

/** Fallback demo credential — clients presenting it get the "rpc" claim. */
const DEFAULT_REPLAY_TOKEN = "replay-demo";

const CHAT_ROLES = ["system", "user", "assistant", "tool"] as const;
type ChatRole = (typeof CHAT_ROLES)[number];

function isChatRole(role: string): role is ChatRole {
  return (CHAT_ROLES as readonly string[]).includes(role);
}

/**
 * Convert MessageLog history into the chat-completions `Message` shape.
 * The log's role strings are narrowed with a guard, never asserted — rows
 * with an unrecognized role are dropped rather than sent upstream.
 */
function toChatMessages(
  rows: Array<{ role: string; content: string }>,
): Array<{ role: ChatRole; content: string }> {
  const out: Array<{ role: ChatRole; content: string }> = [];
  for (const row of rows) {
    if (isChatRole(row.role)) out.push({ role: row.role, content: row.content });
  }
  return out;
}

/**
 * Extract the first text choice from a completion. The telnyx SDK types the
 * response as an untyped record, so the shape is verified at runtime —
 * anything unexpected degrades to empty text instead of throwing.
 */
function firstChoiceText(completion: unknown): string {
  if (typeof completion !== "object" || completion === null) return "";
  if (!("choices" in completion)) return "";
  const choices = completion.choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const first = choices[0];
  if (typeof first !== "object" || first === null || !("message" in first)) return "";
  const message = first.message;
  if (typeof message !== "object" || message === null || !("content" in message)) return "";
  const content = message.content;
  return typeof content === "string" ? content.trim() : "";
}

/** Seconds the current commentary model is announced as (for events). */
function modelId(env: ReplayEnv): string {
  return env.MODEL ?? "zai-org/GLM-5.2";
}

export class ReplayAgent extends Agent<ReplayEnv, ReplayState> {
  /**
   * The socket half of the agent protocol, wired to this actor's state,
   * message log, and event log. Attached sessions get a state + messages
   * snapshot on connect (plus event backlog via the `events` cursor), live
   * pushes as the replay advances, and RPC when granted the "rpc" claim.
   */
  private desk = new AgentSocketServer<ReplayState>(this, {
    getState: () => this.getState(),
    getMessages: () => this.messages.all(),
    getEvents: (after) => this.events.read(after),
    authorize: (token) =>
      token === (this.env.REPLAY_TOKEN ?? DEFAULT_REPLAY_TOKEN)
        ? ["read", "rpc"]
        : ["read"],
  });

  protected override initialState(): ReplayState {
    return {
      status: "empty",
      playhead: 0,
      total: 0,
      speed: 1,
      commentary: false,
      commentaryBusy: false,
      agentStage: "",
      conversationId: "",
    };
  }

  /** The platform hands every WebSocket upgrade here; delegate to the desk. */
  override async webSocket(ws: AgentServerSocket, req: Request): Promise<void> {
    await this.desk.attach(ws, req);
  }

  /**
   * Apply one merge-patch to the durable state and push it to clients.
   * Every state change in this agent flows through here, so watchers see
   * each transition as it commits.
   */
  private async changeState(patch: ReplayStatePatch): Promise<ReplayState> {
    const next = await super.setState(patch);
    this.desk.broadcastPatch(patch);
    return next;
  }

  /**
   * Load a recording over HTTP (front door routes `POST /ingest` here via
   * the actor stub). Replaces any stored recording — ingest is idempotent.
   */
  async ingest(input: RecordingInput): Promise<{ total: number }> {
    const total = storeRecording(this.ctx.storage.sql, input);
    await this.events.emit("recording_loaded", {
      conversationId: input.conversation_id,
      total,
    });
    await this.broadcastLastEvent();
    await this.changeState({
      status: "ready",
      playhead: 0,
      total,
      conversationId: input.conversation_id,
      agentStage: "",
      commentaryBusy: false,
    });
    return { total };
  }

  /** Load the built-in demo recording (the UI's "Load demo" button). */
  @rpc({ description: "Load the built-in demo recording into this actor" })
  async seed(): Promise<{ total: number }> {
    const total = storeRecording(this.ctx.storage.sql, {
      conversation_id: DEMO_CONVERSATION_ID,
      steps: DEMO_SCRIPT,
      replace: true,
    });
    await this.events.emit("recording_loaded", {
      conversationId: DEMO_CONVERSATION_ID,
      total,
    });
    await this.broadcastLastEvent();
    await this.changeState({
      status: "ready",
      playhead: 0,
      total,
      conversationId: DEMO_CONVERSATION_ID,
      agentStage: "",
      commentaryBusy: false,
    });
    return { total };
  }

  /** Start (or resume) playback from the current playhead. */
  @rpc({ description: "Start or resume playback" })
  async play(): Promise<{ status: ReplayState["status"] }> {
    const state = await this.getState();
    if (state.status === "empty") {
      throw new Error("No recording loaded — call seed() first");
    }
    if (state.status !== "ready" && state.status !== "paused") {
      return { status: state.status };
    }
    await this.changeState({ status: "playing" });
    await this.events.emit("playback_started", {
      playhead: state.playhead,
      speed: state.speed,
    });
    await this.broadcastLastEvent();
    await this.queue("tick");
    return { status: "playing" };
  }

  /** Pause playback. The next scheduled tick sees this and exits. */
  @rpc({ description: "Pause playback (durable — survives restarts)" })
  async pause(): Promise<{ status: ReplayState["status"] }> {
    const state = await this.getState();
    if (state.status !== "playing") return { status: state.status };
    await this.changeState({ status: "paused" });
    await this.events.emit("playback_paused", { playhead: state.playhead });
    await this.broadcastLastEvent();
    return { status: "paused" };
  }

  /** Jump the playhead. Used by the UI after a scrub to resume from there. */
  @rpc({ description: "Move the playhead to a step index (0..total)" })
  async seek(index: number): Promise<{ playhead: number }> {
    const state = await this.getState();
    if (state.status === "empty") {
      throw new Error("No recording loaded — call seed() first");
    }
    const playhead = clampPlayhead(index, state.total);
    await this.changeState({ playhead });
    await this.events.emit("playback_seeked", { playhead });
    await this.broadcastLastEvent();
    return { playhead };
  }

  /** Playback speed multiplier; takes effect on the next tick. */
  @rpc({ description: `Set playback speed (${SPEEDS.join(", ")})` })
  async setSpeed(speed: number): Promise<{ speed: number }> {
    if (!isSpeed(speed)) {
      throw new Error(`speed must be one of: ${SPEEDS.join(", ")}`);
    }
    await this.changeState({ speed });
    return { speed };
  }

  /** Toggle LLM commentary; takes effect on the next assistant step. */
  @rpc({ description: "Toggle LLM commentary" })
  async setCommentary(enabled: boolean): Promise<{ commentary: boolean }> {
    if (typeof enabled !== "boolean") {
      throw new Error("enabled must be a boolean");
    }
    await this.changeState({ commentary: enabled });
    await this.events.emit("commentary_toggled", { enabled });
    await this.broadcastLastEvent();
    return { commentary: enabled };
  }

  /**
   * Durable playback tick. Idempotent by construction: it exits unless the
   * status is exactly "playing", so a late tick after pause/finish is a no-op.
   */
  async tick(): Promise<void> {
    const state = await this.getState();
    if (state.status !== "playing") return;

    const steps = loadRecording(this.ctx.storage.sql);
    const index = clampPlayhead(state.playhead, state.total);
    const step = steps[index];
    if (!step) {
      await this.finishReplay(state.total);
      return;
    }

    // 1. Stream the recorded message through the MessageLog — the append is
    //    what every connected client sees live.
    await this.messages.add(step.role, step.content);
    const last = await this.messages.last();
    if (last) this.desk.broadcastMessages([last]);

    // 2. Re-enact the original agent's state change, if this step carried one.
    if (step.stage && step.stage !== state.agentStage) {
      await this.events.emit("state_change", {
        stage: step.stage,
        stepIndex: index,
      });
      await this.broadcastLastEvent();
      await this.changeState({ agentStage: step.stage });
    }

    // 3. Optional LLM commentary on the assistant's message.
    if (state.commentary && step.role === "assistant") {
      await this.commentOn(index);
    }

    // 4. Advance and schedule the next durable tick at recording pacing.
    const nextIndex = index + 1;
    if (nextIndex >= state.total) {
      await this.finishReplay(state.total);
      return;
    }
    await this.changeState({ playhead: nextIndex });
    const delaySeconds = Math.max(step.delayMs, 250) / 1000 / state.speed;
    await this.schedule(delaySeconds, "tick");
  }

  /** Generate and broadcast commentary on the step just played. */
  private async commentOn(stepIndex: number): Promise<void> {
    const model = modelId(this.env);
    await this.changeState({ commentaryBusy: true });
    try {
      const history = toChatMessages(await this.messages.toOpenAI());
      const completion = await this.env.TELNYX.ai.openai.chat.createCompletion({
        model,
        messages: [
          { role: "system", content: COMMENTARY_SYSTEM_PROMPT },
          ...history,
        ],
        max_tokens: 120,
        temperature: 0.6,
      });
      const text = firstChoiceText(completion);
      if (text) {
        await this.events.emit("commentary", { stepIndex, text, model });
        await this.broadcastLastEvent();
      } else {
        await this.events.emit("commentary_skipped", { stepIndex });
        await this.broadcastLastEvent();
      }
    } catch {
      // Production-safe: surface a generic event, never the raw error.
      await this.events.emit("commentary_error", {
        stepIndex,
        message: "Commentary model call failed — continuing without commentary",
      });
      await this.broadcastLastEvent();
    } finally {
      await this.changeState({ commentaryBusy: false });
    }
  }

  private async finishReplay(total: number): Promise<void> {
    await this.changeState({ status: "finished", playhead: total });
    await this.events.emit("replay_finished", { total });
    await this.broadcastLastEvent();
  }

  /** Push the most recently emitted event to subscribed sessions. */
  private async broadcastLastEvent(): Promise<void> {
    const count = await this.events.count();
    if (count === 0) return;
    const [last] = await this.events.read(count - 1);
    if (last) this.desk.broadcastEvent(last);
  }
}
