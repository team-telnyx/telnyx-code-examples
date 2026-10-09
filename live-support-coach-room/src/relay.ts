import { Agent } from "@telnyx/edge-runtime";
import type { AgentServerSocket } from "@telnyx/edge-runtime/agent-socket";
import type {
  CoachRegistry,
  InjectFrame,
  RegistryRow,
  RoomConfig,
  RoomSummary,
} from "./coachRoom";

// Local mirror of the SDK's RFC 7396 merge-patch type (not publicly exported).
type MergePatchOf<T> = T | { [K in keyof T]?: MergePatchOf<T[K]> | null };

export interface RelayEnv {
  COACHROOMS: {
    idFromName(name: string): {
      startRoom(
        conversationId: string,
        assistantId: string,
        callLegId: string,
        config: RoomConfig,
      ): Promise<RoomSummary>;
      onAssistantFrame(frame: Record<string, unknown>): Promise<{ inject: InjectFrame[]; summary: RoomSummary }>;
      endSession(durationSec: number | null, reason: string): Promise<unknown>;
      onStreamDropped(): Promise<unknown>;
      joinCall(): Promise<{ success: boolean; message: string; conversation_id?: string }>;
      getSnapshot(): Promise<RoomSummary>;
    };
  };
  REGISTRY: {
    idFromName(name: string): Pick<
      CoachRegistry,
      "recordStart" | "recordUpdate" | "recordEnd" | "list"
    >;
  };
  SECRETS: {
    get(handle: string): Promise<string>;
  };
}

interface RelayState extends Record<string, unknown> {
  streamsUp: number;
}

/** A live assistant socket → one conversation (bound at session.created). */
interface StreamBinding {
  conversationId: string;
  sawSessionCreated: boolean;
}

const REGISTRY_NAME = "coach-shift";
const DEFAULT_NUDGE_MAX = 3;
const DEFAULT_SILENCE_SECS = 90;

/**
 * AssistRelay — the fixed sink the assistant's `websocket_settings.url`
 * points at. Telnyx opens one socket per conversation to the same static
 * URL; frames carry the conversation id, so the relay:
 *
 *   1. verifies the `Authorization: Bearer <COACH_AUTH>` upgrade header
 *   2. waits for `session.created` (earlier writes are refused by Telnyx)
 *   3. routes every frame to the per-conversation CoachRoom via
 *      `COACHROOMS.idFromName(conversationId)`
 *   4. writes inject frames returned by the room back to Telnyx
 *
 * The socket is a side channel: a close here never reaches the call. Telnyx
 * reconnects with exponential backoff (1s → 30s) on its own; the room stays
 * alive and the dashboard resyncs from the room's snapshot without replay.
 */
export class AssistRelay extends Agent<RelayEnv, RelayState> {
  /** One binding per socket connection. */
  private bindings = new Map<AgentServerSocket, StreamBinding>();

  protected override initialState(): RelayState {
    return { streamsUp: 0 };
  }

  async webSocket(ws: AgentServerSocket, req: Request): Promise<void> {
    const authOk = await this.checkUpgradeAuth(req);
    if (!authOk) {
      ws.close(1008, "Unauthorized");
      return;
    }

    ws.on("message", (data, isBinary) => {
      if (isBinary) return; // binary frames are not supported by the stream
      return this.handleFrame(ws, String(data ?? ""));
    });

    ws.on("close", () => {
      const binding = this.bindings.get(ws);
      this.bindings.delete(ws);
      void this.decStreams();
      if (binding?.conversationId) {
        // Side-channel guarantee: the call itself is untouched. The room
        // stays alive; Telnyx reconnects with its own exponential backoff.
        void this.room(binding.conversationId).onStreamDropped();
      }
    });
  }

  /** The assistant sends its auth_ref secret as `Authorization: Bearer ...`. */
  private async checkUpgradeAuth(req: Request): Promise<boolean> {
    try {
      const expected = await this.env.SECRETS.get("COACH_AUTH");
      if (!expected) return false;
      const header = req.headers.get("authorization") ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      return token.length > 0 && token === expected;
    } catch {
      return false;
    }
  }

  private room(conversationId: string) {
    return this.env.COACHROOMS.idFromName(daprSafeName(conversationId));
  }

  private registry() {
    return this.env.REGISTRY.idFromName(REGISTRY_NAME);
  }

  /**
   * Room config. Actors don't receive env_vars, so the knobs may also be
   * declared as [[secrets]] handles (telnyx-edge secrets add …) — same
   * pattern as the mediator's DEMO_MODE live-mode flip. Defaults otherwise.
   */
  private async config(): Promise<RoomConfig> {
    return {
      nudgeMaxPerCall: intFrom(await this.secretOr("NUDGE_MAX_PER_CALL"), DEFAULT_NUDGE_MAX),
      silenceSecs: intFrom(await this.secretOr("SILENCE_SECS"), DEFAULT_SILENCE_SECS),
    };
  }

  private async secretOr(handle: string): Promise<string | undefined> {
    try {
      const value = await this.env.SECRETS.get(handle);
      return value || undefined;
    } catch {
      return undefined;
    }
  }

  private async handleFrame(ws: AgentServerSocket, raw: string): Promise<void> {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return; // invalid inbound frame — ignore, never crash the relay
    }

    const type = frame.type as string | undefined;
    if (!type) return;

    // Bind this socket to its conversation at session.created.
    if (type === "session.created") {
      const conversationId = pickConversationId(frame);
      if (!conversationId) return;
      this.bindings.set(ws, { conversationId, sawSessionCreated: true });
      await this.incStreams();

      const cfg = await this.config();
      const summary = await this.room(conversationId).startRoom(
        conversationId,
        pickAssistantId(frame),
        pickCallLegId(frame),
        cfg,
      );
      await this.registry().recordStart(conversationId);
      await this.registry().recordUpdate(conversationId, {
        nudges: summary.nudges,
        took_over: summary.took_over,
        flag_count: summary.flags.length,
      });
      return;
    }

    const binding = this.bindings.get(ws);
    if (!binding?.conversationId || !binding.sawSessionCreated) return;

    if (type === "session.ended") {
      const duration = numOrNull(frame.duration_sec);
      const reason = strOr(frame.reason, "normal");
      await this.room(binding.conversationId).endSession(duration, reason);
      await this.registry().recordEnd(binding.conversationId);
      this.bindings.delete(ws);
      return;
    }

    // Relay every other frame to the conversation's room; inject frames go
    // back over this socket. The rate sits far below the 10 fps cap —
    // nudges are capped at NUDGE_MAX_PER_CALL per conversation.
    const { inject, summary } = await this.room(binding.conversationId).onAssistantFrame(frame);
    for (const item of inject) {
      this.sendInject(ws, item);
    }
    if (inject.length > 0) {
      await this.registry().recordUpdate(binding.conversationId, {
        nudges: summary.nudges,
        took_over: summary.took_over,
        flag_count: summary.flags.length,
      });
    }
  }

  private sendInject(ws: AgentServerSocket, frame: InjectFrame): void {
    // Only write after session.created — Telnyx refuses earlier writes.
    if (!this.bindings.get(ws)?.sawSessionCreated) return;
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify(frame));
  }

  private async incStreams(): Promise<void> {
    const state = await this.getState();
    await this.setState({ streamsUp: state.streamsUp + 1 });
  }

  private async decStreams(): Promise<void> {
    const state = await this.getState();
    await this.setState({ streamsUp: Math.max(0, state.streamsUp - 1) });
  }
}

// ── Frame field extraction ───────────────────────────────────────────────
// `session.created` carries conversation_id, assistant_id and call ids; the
// exact nesting has shifted across beta releases, so accept both shapes.

function pickConversationId(frame: Record<string, unknown>): string {
  return strOrNull(frame.conversation_id) ?? strOrNull(sessionOf(frame)?.conversation_id) ?? "";
}

function pickAssistantId(frame: Record<string, unknown>): string {
  return strOrNull(frame.assistant_id) ?? strOrNull(sessionOf(frame)?.assistant_id) ?? "";
}

function pickCallLegId(frame: Record<string, unknown>): string {
  const candidates = [frame.call_control_id, frame.call_leg_id];
  const session = sessionOf(frame);
  if (session) candidates.push(session.call_control_id, session.call_leg_id);
  for (const c of candidates) {
    const v = strOrNull(c);
    if (v) return v;
  }
  return "";
}

function sessionOf(frame: Record<string, unknown>): Record<string, unknown> | undefined {
  const s = frame.session;
  return s && typeof s === "object" ? (s as Record<string, unknown>) : undefined;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function strOr(value: unknown, fallback: string): string {
  return strOrNull(value) ?? fallback;
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function intFrom(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function daprSafeName(id: string): string {
  return id.replace(/[^0-9a-zA-Z.-]/g, "");
}
