import { Agent, rpc } from "@telnyx/edge-runtime";
import { AgentSocketServer, type AgentServerSocket } from "@telnyx/edge-runtime/agent-socket";

// Local mirror of the SDK's RFC 7396 merge-patch type (not publicly exported).
// Arrays, Dates, Maps, etc. are atomic — replaced wholesale, never recursed.
type Atomic = readonly unknown[] | Date | RegExp | Map<unknown, unknown> | Set<unknown> | Promise<unknown> | ArrayBuffer | DataView;
type MergePatchOf<T> = [T] extends [Atomic]
  ? T | null
  : {
      [K in keyof T]?: unknown extends T[K]
        ? T[K] | null
        : [NonNullable<T[K]>] extends [object]
          ? T[K] | MergePatchOf<NonNullable<T[K]>> | null
          : T[K] | null;
    };

// ── Types ────────────────────────────────────────────────────────────────

export interface CoachTurn {
  role: "caller" | "assistant" | "tool" | "coach";
  text: string;
  at: number;
}

export interface CoachState extends Record<string, unknown> {
  conversationId: string;
  assistantId: string;
  /** caller's call leg — needed by ai_assistant_join */
  callLegId: string;
  /** true while the assistant event-stream socket for this conversation is up */
  streamUp: boolean;
  startedAt: number;
  lastActivity: number;
  turns: CoachTurn[];
  flags: string[];
  nudges: number;
  tookOver: boolean;
  ended: boolean;
  /** caller mentioned the account number N times — the two-strikes demo trigger */
  accountMentions: number;
  /** config the worker forwards at session start — actors get no env_vars */
  nudgeMaxPerCall: number;
  silenceSecs: number;
  error: string;
}

export interface RoomSummary {
  conversation_id: string;
  turns: number;
  flags: string[];
  nudges: number;
  took_over: boolean;
  stream_up: boolean;
  started_at: number;
}

export interface CoachLogRow {
  id: number;
  conversation_id: string;
  flags: string;
  nudges: number;
  took_over: number;
  duration_sec: number | null;
  end_reason: string | null;
  created_at: string;
  [key: string]: string | number | null;
}

/** Inject request returned by the room; the relay writes it to Telnyx. */
export interface InjectFrame {
  type: "conversation.item.create";
  item: {
    type: "message";
    role: "assistant" | "user";
    content: Array<{ type: "input_text"; text: string }>;
  };
}

export interface RelayResult {
  inject: InjectFrame[];
  summary: RoomSummary;
}

export interface RoomConfig {
  nudgeMaxPerCall: number;
  silenceSecs: number;
}

export interface JoinResult {
  success: boolean;
  message: string;
  conversation_id?: string;
}

// Telnyx event-stream limits (developers.telnyx.com → Assistant Event Stream):
// frames ≤ 1 MiB and ≤ 10 frames/sec — breaches are answered with an `error`
// frame. Coach nudges are capped per call and sit far below 10 fps, so a
// coaching burst can never breach the platform's inject rate.
const NUDGE_MAX_PER_CALL = 3;
const MAX_FRAME_BYTES = 1024 * 1024; // 1 MiB
const MAX_TURNS_KEPT = 40;

const DOB_NUDGE = "Verify identity with date of birth next.";
const SILENCE_NUDGE = "The caller has gone quiet. Check in warmly before continuing.";

export function daprSafeName(id: string): string {
  // Dapr-safe: RFC 1123 — no "+", no special chars
  return id.replace(/[^0-9a-zA-Z.-]/g, "");
}

function textFromItem(item: unknown): string {
  const it = item as { content?: Array<{ type?: string; text?: string }> } | undefined;
  const parts = it?.content;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p) => p?.type === undefined || p.type === "input_text" || p.type === "text")
    .map((p) => p?.text ?? "")
    .join(" ")
    .trim();
}

function roleFromItem(item: unknown): "caller" | "assistant" | "tool" {
  const role = (item as { role?: string } | undefined)?.role;
  if (role === "assistant") return "assistant";
  if (role === "tool" || role === "tool_result") return "tool";
  return "caller";
}

// ── NudgePolicy ──────────────────────────────────────────────────────────

/**
 * Caps injected frames per call and enforces the platform's 1 MiB frame cap.
 * Injectable text is a user/assistant-role item whose trigger triggers a reply
 * (user) or records silently (assistant) — the coach uses assistant-role items
 * so the assistant pivots without the caller hearing a spoken injection.
 */
export class NudgePolicy {
  private nudgesUsed = 0;
  private readonly maxPerCall: number;

  constructor(maxPerCall: number = NUDGE_MAX_PER_CALL, used: number = 0) {
    this.maxPerCall = Math.max(0, Math.floor(maxPerCall));
    this.nudgesUsed = Math.max(0, Math.floor(used));
  }

  canNudge(): boolean {
    return this.nudgesUsed < this.maxPerCall;
  }

  frameFits(text: string): boolean {
    return new TextEncoder().encode(text).byteLength <= MAX_FRAME_BYTES;
  }

  /** Build a `conversation.item.create` frame, or null when capped/oversized. */
  buildFrame(text: string): InjectFrame | null {
    if (!this.canNudge() || !this.frameFits(text)) return null;
    this.nudgesUsed++;
    return {
      type: "conversation.item.create",
      item: { type: "message", role: "assistant", content: [{ type: "input_text", text }] },
    };
  }

  get used(): number {
    return this.nudgesUsed;
  }
}

// ── CoachRoom — one durable room per conversation ────────────────────────

/**
 * CoachRoom — the supervisor room for one support conversation, keyed by
 * conversation id. Fed by the AssistRelay actor (which holds the Telnyx
 * event-stream socket) and watched live by supervisor dashboard tabs via the
 * agent socket mount.
 *
 * Lifecycle, driven by the relay in src/relay.ts:
 *   1. startRoom()        — session.created → durable room, arm silence watcher
 *   2. onAssistantFrame() — transcript / deltas / telephony events accumulate,
 *                           policy flags fire, nudges are built and relayed
 *   3. joinCall()         — @rpc: dial the supervisor + ai_assistant_join
 *   4. endSession()       — session.ended → coach_log row + room teardown
 *
 * The event stream is a side channel: a dropped socket never reaches the
 * call. Rooms reconnect without replaying backlog — the desk snapshot on
 * connect IS the current view.
 */
export class CoachRoom extends Agent<CoachEnv, CoachState> {
  /**
   * Live room view — pushes a state snapshot on connect and an incremental
   * merge-patch on every setState, so every supervisor tab sees the same
   * transcript, flags, and nudges in real time. Read-only for anonymous
   * observers (same policy as the mediator's desk); a matching COACH_AUTH
   * token (attach frame or `?token=` upgrade param) adds rpc claims.
   */
  private desk = new AgentSocketServer<CoachState>(this, {
    getState: () => this.getState(),
    authorize: async (token: string | undefined, req?: Request) => {
      let supplied = token;
      if (!supplied && req) {
        try {
          supplied = new URL(req.url).searchParams.get("token") ?? undefined;
        } catch {
          supplied = undefined;
        }
      }
      if (supplied === undefined) return ["read"] as const;
      try {
        const expected = await this.env.SECRETS.get("COACH_AUTH");
        return expected && supplied === expected ? (["read", "rpc"] as const) : [];
      } catch {
        return [];
      }
    },
  });

  /** Activates the connection surface — served through the /agents mount. */
  async webSocket(ws: AgentServerSocket, req: Request): Promise<void> {
    await this.desk.attach(ws, req);
  }

  protected override async setState(patch: MergePatchOf<CoachState>): Promise<CoachState> {
    const next = await super.setState(patch);
    this.desk.broadcastPatch(patch);
    return next;
  }

  protected override initialState(): CoachState {
    return {
      conversationId: "",
      assistantId: "",
      callLegId: "",
      streamUp: false,
      startedAt: 0,
      lastActivity: 0,
      turns: [],
      flags: [],
      nudges: 0,
      tookOver: false,
      ended: false,
      accountMentions: 0,
      nudgeMaxPerCall: NUDGE_MAX_PER_CALL,
      silenceSecs: 90,
      error: "",
    };
  }

  // ── 1. session.created ─────────────────────────────────────────────────

  /**
   * Register a live conversation. Called by the relay for every
   * `session.created`; a repeat for a known id is a reconnect — the room
   * resumes (no state reset, no backlog replay).
   */
  async startRoom(
    conversationId: string,
    assistantId: string,
    callLegId: string,
    config: RoomConfig,
  ): Promise<RoomSummary> {
    await this.ensureTable();
    const state = await this.getState();
    const resumed = state.conversationId === conversationId && state.startedAt > 0;

    await this.setState({
      conversationId,
      assistantId,
      callLegId,
      streamUp: true,
      startedAt: resumed ? state.startedAt : Date.now(),
      lastActivity: Date.now(),
      ended: false,
      error: "",
      nudgeMaxPerCall: config.nudgeMaxPerCall,
      silenceSecs: config.silenceSecs,
    });

    await this.armSilenceWatcher();
    return this.summarize(await this.getState());
  }

  // ── 2. assistant event frames ──────────────────────────────────────────

  /**
   * Ingest one event-stream frame and return any inject frames to write back
   * to Telnyx. Unknown event types are ignored (the stream is expected to
   * grow — see the Assistant Event Stream beta note).
   */
  async onAssistantFrame(frame: Record<string, unknown>): Promise<RelayResult> {
    const type = frame.type as string | undefined;
    const state = await this.getState();
    if (!state.startedAt || state.ended) {
      return { inject: [], summary: this.summarize(state) };
    }

    const inject: InjectFrame[] = [];
    let patch: MergePatchOf<CoachState> | null = null;

    switch (type) {
      case "conversation.item.created": {
        const item = frame.item;
        const text = textFromItem(item);
        const role = roleFromItem(item);
        patch = {
          lastActivity: Date.now(),
          turns: [...state.turns, { role, text, at: Date.now() }].slice(-MAX_TURNS_KEPT),
        };
        if (role === "caller" && text) {
          inject.push(...this.evaluateTriggers(text, patch, state));
        }
        break;
      }

      case "response.text.delta":
        patch = { lastActivity: Date.now() };
        break;

      case "response.created":
      case "telnyx.call.answered":
      case "telnyx.call.hangup":
        patch = { lastActivity: Date.now() };
        break;

      default:
        // Unknown types are ignored, not errors.
        break;
    }

    if (patch) {
      await this.setState(patch);
      await this.armSilenceWatcher();
    }
    return { inject, summary: this.summarize(await this.getState()) };
  }

  /**
   * Demo heuristics for the two coaching triggers in the ticket:
   *   - two-strikes identity loop → DOB nudge (caller turns only)
   *   - refund promise → flag
   */
  private evaluateTriggers(
    text: string,
    patch: MergePatchOf<CoachState>,
    state: CoachState,
  ): InjectFrame[] {
    const lower = text.toLowerCase();
    const inject: InjectFrame[] = [];

    if (/(account|member|patient)\s+(number|id)/.test(lower) || /\b\d{4,}\b/.test(lower)) {
      const mentions = state.accountMentions + 1;
      patch.accountMentions = mentions;
      if (mentions >= 2) {
        const frame = this.policyFor(state).buildFrame(DOB_NUDGE);
        if (frame) {
          inject.push(frame);
          patch.nudges = state.nudges + 1;
          patch.turns = [
            ...(patch.turns ?? state.turns),
            { role: "coach" as const, text: DOB_NUDGE, at: Date.now() },
          ].slice(-MAX_TURNS_KEPT);
        }
      }
    }

    if (lower.includes("refund") && !state.flags.includes("refund_promise")) {
      patch.flags = [...state.flags, "refund_promise"];
    }

    return inject;
  }

  // ── Silence watcher ────────────────────────────────────────────────────

  /** Re-arm the durable silence task; any activity cancels + re-arms it. */
  private async armSilenceWatcher(): Promise<void> {
    const state = await this.getState();
    if (state.ended) return;
    await this.cancelSchedule("silence");
    await this.schedule(state.silenceSecs, "checkSilence", undefined, { id: "silence" });
  }

  /**
   * Fires when the caller has been silent for `silenceSecs` — if the room is
   * still live and no human took over, nudge the assistant. Does not
   * reschedule itself when activity happened meanwhile; the next frame from
   * the stream re-arms it.
   */
  async checkSilence(_payload: unknown): Promise<void> {
    const state = await this.getState();
    if (!state.startedAt || state.ended || state.tookOver) return;

    const idleSecs = (Date.now() - state.lastActivity) / 1000;
    if (idleSecs < state.silenceSecs) {
      // Activity landed since this task was armed — re-arm for the remainder.
      const remaining = Math.max(1, Math.round(state.silenceSecs - idleSecs));
      await this.schedule(remaining, "checkSilence", undefined, { id: "silence" });
      return;
    }

    const frame = this.policyFor(state).buildFrame(SILENCE_NUDGE);
    if (!frame) return;

    await this.setState({
      nudges: state.nudges + 1,
      flags: state.flags.includes("silence_flag") ? state.flags : [...state.flags, "silence_flag"],
      turns: [...state.turns, { role: "coach" as const, text: SILENCE_NUDGE, at: Date.now() }].slice(-MAX_TURNS_KEPT),
    });
  }

  // ── 3. Escalation ──────────────────────────────────────────────────────

  /**
   * Dial the supervisor's device and join that leg into the live AI
   * conversation. Supervisor device / connection / number / API key come from
   * the [[secrets]] blocks — env vars and REST keys don't reach actor scope.
   */
  @rpc({ description: "Dial the supervisor and join that leg into the live AI conversation" })
  async joinCall(_payload: unknown): Promise<JoinResult> {
    const state = await this.getState();
    if (!state.startedAt || state.ended) {
      return { success: false, message: "No active conversation in this room" };
    }
    if (state.tookOver) {
      return { success: true, message: "Supervisor already joined", conversation_id: state.conversationId };
    }

    try {
      const connectionId = await this.env.SECRETS.get("CALL_CONTROL_CONNECTION_ID");
      const telnyxNumber = await this.env.SECRETS.get("TELNYX_NUMBER");
      const supervisorDevice = await this.env.SECRETS.get("SUPERVISOR_DEVICE");
      const apiKey = await this.env.SECRETS.get("TELNYX_API_KEY");

      if (!connectionId || !telnyxNumber || !supervisorDevice || !apiKey) {
        return {
          success: false,
          message: "Missing CALL_CONTROL_CONNECTION_ID / TELNYX_NUMBER / SUPERVISOR_DEVICE / TELNYX_API_KEY secrets",
        };
      }

      // Zero-credential dial via the [telnyx] binding.
      const dial = (await this.env.TELNYX.calls.dial({
        connection_id: connectionId,
        to: supervisorDevice,
        from: telnyxNumber,
      })) as { data?: { call_control_id?: string } };
      const supervisorCcId = dial?.data?.call_control_id;
      if (!supervisorCcId) {
        return { success: false, message: "Dial failed: no call_control_id in response" };
      }

      // Demo conversations have no live call leg to join — the dial is real,
      // the join is live-path only. The supervisor leg gets a spoken notice
      // (spoken once the call is answered — see announceSupervisor) and then
      // ends. Joining is live-path only.
      if (state.conversationId.startsWith("sim-")) {
        await this.schedule(2, "announceSupervisor", { callControlId: supervisorCcId }, { id: "announce-supervisor" });
        await this.setState({ tookOver: true });
        return {
          success: true,
          message: "Supervisor dialed — demo conversation has no live call leg to join",
          conversation_id: state.conversationId,
        };
      }

      // Join the supervisor leg into the running AI conversation.
      const resp = await fetch(
        `https://api.telnyx.com/v2/calls/${encodeURIComponent(state.callLegId)}/actions/ai_assistant_join`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: state.conversationId,
            participant: { id: supervisorCcId, role: "user", name: "Supervisor" },
          }),
        },
      );
      if (!resp.ok) {
        return { success: false, message: `ai_assistant_join failed: HTTP ${resp.status}` };
      }

      await this.setState({ tookOver: true });
      return { success: true, message: "Supervisor joined the live call", conversation_id: state.conversationId };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "escalation failed";
      await this.setState({ error: msg });
      return { success: false, message: msg };
    }
  }

  /**
   * Speak the demo escalation notice on the supervisor's leg. The call may
   * still be ringing when this fires, so retry until the speak command is
   * accepted (≈1s apart, up to 20s), then schedule the hangup. If nobody
   * answers, the leg is ended anyway so it can't ring out forever.
   */
  async announceSupervisor(payload: { callControlId?: string }): Promise<void> {
    const cc = payload?.callControlId;
    if (!cc) return;
    const apiKey = await this.env.SECRETS.get("TELNYX_API_KEY");
    const notice =
      "You have been escalated as a supervisor. This is a simulated conversation, so there is no live caller audio. The coach room will now end this call.";

    let answered = false;
    for (let attempt = 0; attempt < 20 && !answered; attempt++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const resp = await fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(cc)}/actions/speak`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ payload: notice, voice: "female", language: "en-US" }),
        });
        if (resp.ok) {
          answered = true;
        } else {
          console.log(`[CoachRoom] speak attempt ${attempt}: HTTP ${resp.status}`);
        }
      } catch (e) {
        console.error(`[CoachRoom] speak attempt ${attempt} failed: ${e instanceof Error ? e.message : "unknown"}`);
      }
    }

    await this.schedule(answered ? 12 : 25, "endSupervisorLeg", { callControlId: cc }, { id: "end-supervisor" });
  }

  /** Hang up the supervisor's leg after the demo-mode notice played. */
  async endSupervisorLeg(payload: { callControlId?: string }): Promise<void> {
    const cc = payload?.callControlId;
    if (!cc) return;
    try {
      const apiKey = await this.env.SECRETS.get("TELNYX_API_KEY");
      await fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(cc)}/actions/hangup`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      });
    } catch {
      // The leg ends on its own if the hangup command fails.
    }
  }

  // ── 4. Session end — SQL audit trail + teardown ────────────────────────

  /**
   * session.ended → file the shift's row to per-actor SQL, cancel the
   * watcher, and reset the room. The next conversation spawns its own actor
   * instance — no reuse, no cross-call bleed.
   */
  async endSession(durationSec: number | null, reason: string): Promise<void> {
    const state = await this.getState();
    if (state.ended || !state.startedAt) return;

    await this.cancelSchedule("silence");
    await this.setState({ ended: true, streamUp: false });

    const duration = durationSec ?? Math.round((Date.now() - state.startedAt) / 1000);
    this.ctx.storage.sql.exec(
      `INSERT INTO coach_log (conversation_id, flags, nudges, took_over, duration_sec, end_reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
      state.conversationId,
      JSON.stringify(state.flags),
      state.nudges,
      state.tookOver ? 1 : 0,
      duration,
      reason,
    );

    await this.replaceState(this.initialState());
    // Broadcast the reset so connected dashboard tabs clear their view too.
    this.desk.broadcastPatch({ ended: true, streamUp: false, turns: [], flags: [], nudges: 0 });
  }

  /** Mark the stream down — the call is untouched (side-channel guarantee). */
  async onStreamDropped(): Promise<void> {
    const state = await this.getState();
    if (state.startedAt && !state.ended) await this.setState({ streamUp: false });
  }

  async getSnapshot(): Promise<RoomSummary> {
    return this.summarize(await this.getState());
  }

  async getLog(): Promise<CoachLogRow[]> {
    await this.ensureTable();
    return this.ctx.storage.sql
      .exec<CoachLogRow>("SELECT * FROM coach_log ORDER BY id DESC LIMIT 20")
      .toArray();
  }

  private summarize(state: CoachState): RoomSummary {
    return {
      conversation_id: state.conversationId,
      turns: state.turns.length,
      flags: state.flags,
      nudges: state.nudges,
      took_over: state.tookOver,
      stream_up: state.streamUp,
      started_at: state.startedAt,
    };
  }

  /**
   * Nudges are counted in durable state — a fresh policy is derived from the
   * current snapshot on every check, so evictions never lose the budget.
   */
  private policyFor(state: CoachState): NudgePolicy {
    return new NudgePolicy(state.nudgeMaxPerCall, state.nudges);
  }

  private async ensureTable(): Promise<void> {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS coach_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        flags TEXT NOT NULL DEFAULT '[]',
        nudges INTEGER NOT NULL DEFAULT 0,
        took_over INTEGER NOT NULL DEFAULT 0,
        duration_sec INTEGER,
        end_reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }
}

// ── CoachEnv ─────────────────────────────────────────────────────────────

/**
 * Actors receive only the [telnyx] binding + [[secrets]] handles — env_vars
 * stay at the worker and are forwarded per call (see startRoom config).
 */
export interface CoachEnv {
  TELNYX: {
    calls: {
      dial(m: { connection_id: string; from: string; to: string }): Promise<unknown>;
    };
  };
  SECRETS: {
    get(handle: string): Promise<string>;
  };
}

// ── CoachRegistry — the shift's room list ────────────────────────────────

/**
 * Tracks live + finished rooms for the dashboard picker and the /rooms API.
 * One row per conversation; updated by the relay at session start/end.
 */
export class CoachRegistry extends Agent<CoachEnv, RegistryState> {
  protected override initialState(): RegistryState {
    return { rooms: [] };
  }

  async recordStart(conversationId: string): Promise<void> {
    const state = await this.getState();
    const rest = state.rooms.filter((r) => r.conversation_id !== conversationId);
    await this.setState({
      rooms: [
        {
          conversation_id: conversationId,
          started_at: Date.now(),
          ended: false,
          nudges: 0,
          took_over: false,
          flag_count: 0,
        },
        ...rest,
      ].slice(0, 200),
    });
  }

  async recordUpdate(conversationId: string, patch: Partial<RegistryRow>): Promise<void> {
    const state = await this.getState();
    await this.setState({
      rooms: state.rooms.map((r) => (r.conversation_id === conversationId ? { ...r, ...patch } : r)),
    });
  }

  async recordEnd(conversationId: string): Promise<void> {
    const state = await this.getState();
    await this.setState({
      rooms: state.rooms.map((r) => (r.conversation_id === conversationId ? { ...r, ended: true } : r)),
    });
  }

  async list(): Promise<{ active: RegistryRow[]; ended: RegistryRow[] }> {
    const state = await this.getState();
    return {
      active: state.rooms.filter((r) => !r.ended),
      ended: state.rooms.filter((r) => r.ended),
    };
  }
}

export interface RegistryRow {
  conversation_id: string;
  started_at: number;
  ended: boolean;
  nudges: number;
  took_over: boolean;
  flag_count: number;
}

interface RegistryState extends Record<string, unknown> {
  rooms: RegistryRow[];
}
