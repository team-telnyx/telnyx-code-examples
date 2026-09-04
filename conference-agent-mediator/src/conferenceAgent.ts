import { Agent } from "@telnyx/edge-runtime";
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

// ── State ────────────────────────────────────────────────────────────────
export type ConferencePhase =
  | "idle"
  | "active"
  | "summarizing"
  | "sending"
  | "done"
  | "error";

export interface TurnRecord {
  speaker: string;
  text: string;
  at: number;
}

export interface ConferenceState extends Record<string, unknown> {
  conferenceId: string;
  friendlyName: string;
  demo: boolean;
  phase: ConferencePhase;
  /** participant name → last-spoken epoch ms (0 = never spoke) */
  participants: Record<string, number>;
  turns: TurnRecord[];
  transcriptText: string;
  promptsSent: string[];
  summary: string;
  startedAt: number;
  endedAt: number;
  /** LLM model — passed in from the fetch env (actors don't receive env_vars) */
  model: string;
  smsSent: boolean;
  error: string;
}

// ── Env: [telnyx] binding only (actors receive no secrets/env_vars) ──────

interface ConferenceEnv {
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
    messages: {
      send(m: { from: string; to: string; text: string }): Promise<unknown>;
    };
    conferences: {
      actions: {
        speak(
          conferenceId: string,
          params: { payload: string; voice?: string; language?: string; command_id?: string },
        ): Promise<unknown>;
      };
    };
  };
  /** Read secrets declared in telnyx.toml [[secrets]] blocks by binding handle. */
  SECRETS: {
    get(handle: string): Promise<string>;
  };
}

export interface ConferenceRecord {
  conference_id: string;
  friendly_name: string;
  participants: number;
  turn_count: number;
  summary: string;
  started_at: number;
  ended_at: number;
  status: string;
  [key: string]: string | number;
}

const DEFAULT_MODEL = "zai-org/GLM-5.2";
// Telnyx Ultra TTS — premium engine; the voice id carries its own locale,
// so speak requests omit the `language` param.
const TTS_VOICE = "Telnyx.Ultra.3e1ed423-17e5-4773-b87c-25b031106e41";

const MEDIATE_INTERVAL_S = 30; // turn-taking check cadence
const SILENCE_THRESHOLD_MS = 60_000; // participant silent for 60s → prompt
const REPROMPT_COOLDOWN_MS = 5 * 60_000; // don't re-prompt within 5 minutes

const SUMMARY_SYSTEM_PROMPT = `You are a meeting facilitator summarizing a conference call. Given a timestamped transcript, produce a concise summary in 1-4 sentences covering:
- The key points and any decisions made
- Action items with owners (if any)
- Participation balance (who dominated, who stayed quiet)
Do not add labels, headers, or quotes — just the summary text.`;

function daprSafeName(conferenceId: string): string {
  // Dapr-safe: RFC 1123 — no "+", no special chars
  return conferenceId.replace(/[^0-9a-zA-Z.-]/g, "");
}

/**
 * ConferenceAgent — one durable actor instance per conference, keyed by
 * conference id. Joins the conference lifecycle driven by the webhook handler
 * in index.ts:
 *
 *   1. onConferenceStart()  — record start, arm the 30s mediation timer
 *   2. addParticipant()     — track join events
 *   3. onTranscript()       — STT final segments accumulate into state
 *   4. mediate()            — every 30s, prompt silent participants via LLM
 *   5. onConferenceEnd()    — pipeline: summarize → store → notify → done
 *
 * Durable state lives in getState()/setState(); the full transcript row is
 * written to per-actor SQL and pushed to the shared ConferenceRegistry actor
 * for cross-conference listing. In demo mode the agent never touches Call
 * Control or sends real SMS — prompts and notifications are recorded in state.
 */
export class ConferenceAgent extends Agent<ConferenceEnv, ConferenceState> {
  /**
   * Live transcript streaming — the agent socket server pushes a state
   * snapshot on connect and an incremental merge-patch on every setState,
   * so observers receive transcript turns, mediator prompts, phase, and the
   * summary in real time over WebSocket.
   */
  private desk = new AgentSocketServer<ConferenceState>(this, {
    getState: () => this.getState(),
    // anonymous connections observe (read); a token would add rpc
    authorize: (token: string | undefined) => (token === undefined ? ["read"] : ["read", "rpc"]),
  });

  /** Activates the connection surface — served through the /agents mount. */
  async webSocket(ws: AgentServerSocket, req: Request): Promise<void> {
    await this.desk.attach(ws, req);
  }

  protected override async setState(patch: MergePatchOf<ConferenceState>): Promise<ConferenceState> {
    const next = await super.setState(patch);
    this.desk.broadcastPatch(patch);
    return next;
  }

  protected override initialState(): ConferenceState {
    return {
      conferenceId: "",
      friendlyName: "",
      demo: true,
      phase: "idle",
      participants: {},
      turns: [],
      transcriptText: "",
      promptsSent: [],
      summary: "",
      startedAt: 0,
      endedAt: 0,
      model: "",
      smsSent: false,
      error: "",
    };
  }

  /**
   * Webhook handler calls this on conference.created. The LLM model is passed
   * in from the fetch env — actor envs receive only the [telnyx] binding and
   * the secrets store, not env_vars.
   */
  async onConferenceStart(
    conferenceId: string,
    opts?: { demo?: boolean; friendlyName?: string; model?: string },
  ): Promise<void> {
    const demo = opts?.demo ?? true;
    await this.setState({
      conferenceId,
      friendlyName: opts?.friendlyName ?? "",
      demo,
      phase: "active",
      participants: {},
      turns: [],
      transcriptText: "",
      promptsSent: [],
      summary: "",
      startedAt: Date.now(),
      endedAt: 0,
      model: opts?.model ?? "",
      smsSent: false,
      error: "",
    });
    this.ensureTables();
    // Durable 30s mediator — stable id makes re-arming an upsert.
    await this.every(MEDIATE_INTERVAL_S, "mediate", undefined, { id: "mediate" });
    await this.events.emit("conference_started", { conferenceId, demo });
    if (!demo) {
      // Live bridge: introduce the facilitator so humans know the voice.
      try {
        await this.env.TELNYX.conferences.actions.speak(conferenceId, {
          payload:
            "Hi, I'm your AI meeting facilitator. I'll transcribe the call, prompt anyone who's been quiet, and send a summary when we finish.",
          voice: TTS_VOICE,
          command_id: `greet-${daprSafeName(conferenceId)}-${Date.now()}`,
        });
        await this.events.emit("greeting_spoken", {});
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        await this.events.emit("greeting_failed", { error: msg });
      }
    }
  }

  /** Webhook handler calls this on conference.participant.joined. */
  async addParticipant(name: string, callControlId?: string): Promise<void> {
    const state = await this.getState();
    if (state.phase !== "active") return;
    const participants = { ...state.participants, [name]: 0 };
    await this.setState({ ...state, participants });
    await this.events.emit("participant_joined", { name, callControlId: callControlId ?? "" });
  }

  /** Webhook handler calls this on conference.participant.left. */
  async removeParticipant(name: string): Promise<void> {
    const state = await this.getState();
    if (state.phase !== "active") return;
    // RFC 7396 merge-delete: a null value removes the key from the map.
    await this.setState({ participants: { [name]: null } });
    await this.events.emit("participant_left", { name });
  }

  /** Webhook handler calls this on call.transcription (final segments). */
  async onTranscript(speaker: string, text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    const state = await this.getState();
    if (state.phase !== "active") return;
    const turn: TurnRecord = { speaker, text: trimmed, at: Date.now() };
    const turns = [...state.turns, turn];
    const transcriptText = state.transcriptText ? state.transcriptText + "\n" : "";
    await this.setState({
      ...state,
      turns,
      transcriptText: transcriptText + `[${speaker}]: ${trimmed}`,
      participants: { ...state.participants, [speaker]: turn.at },
    });
  }

  /**
   * Turn-taking mediator — fires every 30s on the durable timer. Finds
   * participants silent past the threshold and prompts them back into the
   * conversation, using an LLM-crafted nudge when there is context, otherwise
   * a neutral template. Live mode speaks into the conference via the
   * zero-credential [telnyx] binding; demo mode records the prompt as a turn.
   */
  async mediate(): Promise<void> {
    const state = await this.getState();
    if (state.phase !== "active") {
      await this.events.emit("mediate_skipped", { phase: state.phase });
      return;
    }
    const now = Date.now();
    const due = Object.entries(state.participants).filter(([, lastSpokenAt]) => {
      const anchor = lastSpokenAt || state.startedAt;
      return now - anchor > SILENCE_THRESHOLD_MS;
    });
    await this.events.emit("mediate_tick", {
      participants: Object.keys(state.participants),
      due: due.map(([name]) => name),
      now,
      startedAt: state.startedAt,
    });
    for (const [name] of due) {
      const lastPrompt = state.promptsSent.filter((p) => p.startsWith(`${name}:`)).pop();
      const lastPromptAt = lastPrompt ? Number(lastPrompt.split(":")[1]) : 0;
      if (now - lastPromptAt < REPROMPT_COOLDOWN_MS) continue;

      try {
        const prompt = await this.craftPrompt(name, state.transcriptText, state.model);
        await this.recordAndDeliverPrompt(name, prompt);
        await this.events.emit("prompt_sent", { participant: name, prompt });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        await this.events.emit("prompt_failed", { participant: name, error: msg });
      }
    }
  }

  /** On conference.ended: stop the timer and kick off the finalize pipeline. */
  async onConferenceEnd(): Promise<void> {
    const state = await this.getState();
    if (state.phase === "done" || state.phase === "summarizing" || state.phase === "sending") {
      return;
    }
    await this.cancelSchedule("mediate");
    await this.setState({ ...state, phase: "summarizing", endedAt: Date.now() });
    await this.queue("summarize");
  }

  /** Pipeline stage 1: summarize the transcript via LLM (zero-credential binding). */
  async summarize(): Promise<void> {
    const state = await this.getState();
    try {
      const transcript = state.transcriptText.trim();
      if (!transcript) {
        await this.setState({ ...state, phase: "sending", summary: "" });
      } else {
        const model = state.model || DEFAULT_MODEL;
        const messages = [
          { role: "system", content: SUMMARY_SYSTEM_PROMPT },
          { role: "user", content: transcript },
        ];
        let summary = (await this.complete(model, messages, 500)) ?? "";
        if (!summary) {
          // Reasoning-style models occasionally exhaust tokens before content;
          // retry once with a bigger budget.
          summary = (await this.complete(model, messages, 1200)) ?? "";
        }
        if (!summary) {
          const current = await this.getState();
          await this.setState({ ...current, error: current.error || "summarize: model returned empty content" });
        }
        await this.setState({ ...state, summary, phase: "sending" });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const current = await this.getState();
      await this.setState({ ...current, phase: "error", error: `summarize: ${msg}` });
    }
    await this.queue("store");
  }

  private async complete(
    model: string,
    messages: Array<{ role: string; content: string }>,
    maxTokens: number,
  ): Promise<string | null> {
    const completion = await this.env.TELNYX.ai.openai.chat.createCompletion({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.3,
    });
    return completion.choices[0]?.message?.content?.trim() || null;
  }

  /** Pipeline stage 2: persist the summary to per-actor SQL. */
  async store(): Promise<void> {
    const state = await this.getState();
    try {
      this.ensureTables();
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO conference
         (conference_id, friendly_name, participants, turn_count, summary, started_at, ended_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        state.conferenceId,
        state.friendlyName,
        Object.keys(state.participants).length,
        state.turns.length,
        state.summary || "",
        state.startedAt,
        state.endedAt || Date.now(),
        state.phase === "error" ? "error" : "stored",
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const current = await this.getState();
      await this.setState({ ...current, phase: "error", error: `store: ${msg}` });
    }
    await this.queue("notify");
  }

  /** Pipeline stage 3: text the summary via SMS (skipped in demo mode). */
  async notify(): Promise<void> {
    const state = await this.getState();
    try {
      if (state.demo) {
        await this.events.emit("sms_skipped_demo", { summary: state.summary });
      } else if (state.summary) {
        // SMS routing lives in the [[secrets]] store — actors read it via
        // env.SECRETS.get; it never lands in durable state.
        let smsFrom = "";
        let smsTo = "";
        try {
          smsFrom = await this.env.SECRETS.get("SMS_FROM");
          smsTo = await this.env.SECRETS.get("SMS_TO");
        } catch {
          // secret store unavailable or handles not declared
        }
        if (smsFrom && smsTo) {
          await this.env.TELNYX.messages.send({
            from: smsFrom,
            to: smsTo,
            text: `Conference summary (${state.friendlyName || state.conferenceId}):\n${state.summary}`,
          });
          await this.events.emit("sms_sent", { to: smsTo });
        } else {
          await this.events.emit("sms_skipped_no_routing", {});
        }
      }
      const smsFromFinal = state.demo ? false : !!(state.summary && (await this.hasSecrets("SMS_FROM", "SMS_TO")));
      await this.setState({ ...state, smsSent: smsFromFinal, phase: "done" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.setState({ ...state, phase: "error", error: `notify: ${msg}` });
    }
  }

  private async hasSecrets(...handles: string[]): Promise<boolean> {
    try {
      for (const h of handles) {
        if (!(await this.env.SECRETS.get(h))) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Debug/dashboards — full current state. */
  async getSnapshot(): Promise<ConferenceState> {
    return await this.getState();
  }

  /** Polling endpoint payload — turns newer than `since` (epoch ms). */
  async getTurns(since = 0): Promise<{ turns: TurnRecord[]; phase: ConferencePhase; summary: string }> {
    const state = await this.getState();
    return {
      turns: state.turns.filter((t) => t.at > since),
      phase: state.phase,
      summary: state.summary,
    };
  }

  /** Observability — replay the agent's progress-event stream. */
  async getEvents(afterSeq = 0): Promise<Array<{ seq: number; type: string; payload: unknown; at: string }>> {
    const rows = await this.events.read(afterSeq);
    return rows.map((r) => ({ seq: r.seq, type: r.type, payload: r.payload, at: r.at.toISOString() }));
  }

  /** LLM-crafted nudge for a silent participant (falls back to a template). */
  private async craftPrompt(participant: string, transcript: string, model: string): Promise<string> {
    if (!transcript.trim()) {
      return `${participant}, you've been quiet for a while. Would you like to add anything?`;
    }
    try {
      const completion = await this.env.TELNYX.ai.openai.chat.createCompletion({
        model: model || DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a meeting facilitator. A participant has been silent for over a minute. Write ONE short, warm sentence inviting them to weigh in on the discussion so far. Output only the sentence.",
          },
          { role: "user", content: `Transcript so far:\n${transcript}\n\nSilent participant: ${participant}` },
        ],
        max_tokens: 120,
        temperature: 0.5,
      });
      const text = completion.choices[0]?.message?.content?.trim();
      if (text) return text;
    } catch {
      // fall through to the template
    }
    return `${participant}, you've been quiet for a while. Would you like to add anything?`;
  }

  /**
   * Record the mediator's prompt (turn + transcript + cooldown bookkeeping)
   * in a single fresh-`getState` merge, then speak it into the bridge in
   * live mode via the zero-credential [telnyx] binding.
   */
  private async recordAndDeliverPrompt(participant: string, prompt: string): Promise<void> {
    const state = await this.getState();
    const now = Date.now();
    await this.setState({
      ...state,
      turns: [...state.turns, { speaker: "mediator", text: prompt, at: now }],
      transcriptText: state.transcriptText + `\n[mediator]: ${prompt}`,
      promptsSent: [...state.promptsSent, `${participant}:${now}`],
    });
    if (state.demo) return;
    // Live mode: inject TTS into the conference via the zero-credential
    // [telnyx] binding — actor envs carry no API key, and persisting one in
    // state would leak it via the snapshot endpoint.
    try {
      await this.env.TELNYX.conferences.actions.speak(state.conferenceId, {
        payload: prompt,
        voice: TTS_VOICE,
        command_id: `mediate-${daprSafeName(state.conferenceId)}-${now}`,
      });
      await this.events.emit("prompt_spoken", { participant, prompt });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.events.emit("prompt_speak_failed", { participant, error: msg });
    }
  }

  private ensureTables(): void {
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS conference(
         conference_id  TEXT PRIMARY KEY,
         friendly_name  TEXT NOT NULL DEFAULT '',
         participants   INTEGER NOT NULL DEFAULT 0,
         turn_count     INTEGER NOT NULL DEFAULT 0,
         summary        TEXT NOT NULL DEFAULT '',
         started_at     INTEGER NOT NULL,
         ended_at       INTEGER,
         status         TEXT NOT NULL DEFAULT 'active'
       )`,
    );
  }
}

/**
 * ConferenceRegistry — a single shared actor instance (keyed "global") storing
 * one row per finished conference so /conferences can list across actors.
 */
export class ConferenceRegistry extends Agent<Record<string, unknown>, Record<string, unknown>> {
  protected override initialState(): Record<string, unknown> {
    return {};
  }

  async record(row: ConferenceRecord): Promise<void> {
    this.ensureTables();
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO conferences
       (conference_id, friendly_name, participants, turn_count, summary, started_at, ended_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      row.conference_id,
      row.friendly_name,
      row.participants,
      row.turn_count,
      row.summary,
      row.started_at,
      row.ended_at,
      row.status,
    );
  }

  async list(limit = 50): Promise<ConferenceRecord[]> {
    this.ensureTables();
    const cursor = this.ctx.storage.sql.exec<ConferenceRecord>(
      "SELECT * FROM conferences ORDER BY started_at DESC LIMIT ?",
      Math.max(1, Math.min(200, limit)),
    );
    return cursor.toArray();
  }

  // ── Live bridge coordination (fetch env calls these) ──────────────────

  /** The one conference new dial-ins should join right now ("" = none). */
  async getActiveBridge(): Promise<string> {
    this.ensureTables();
    const cursor = this.ctx.storage.sql.exec<{ conference_id: string }>(
      "SELECT conference_id FROM bridge WHERE id = 1",
    );
    return cursor.toArray()[0]?.conference_id ?? "";
  }

  async setActiveBridge(conferenceId: string): Promise<void> {
    this.ensureTables();
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO bridge (id, conference_id, updated_at) VALUES (1, ?, ?)",
      conferenceId,
      Date.now(),
    );
  }

  async clearBridge(): Promise<void> {
    this.ensureTables();
    this.ctx.storage.sql.exec("DELETE FROM bridge WHERE id = 1");
  }

  /** Remember which conference a call leg belongs to (for transcription routing). */
  async mapCall(callControlId: string, conferenceId: string): Promise<void> {
    this.ensureTables();
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO call_map (call_control_id, conference_id, joined_at) VALUES (?, ?, ?)",
      callControlId,
      conferenceId,
      Date.now(),
    );
  }

  async conferenceForCall(callControlId: string): Promise<string> {
    this.ensureTables();
    const cursor = this.ctx.storage.sql.exec<{ conference_id: string }>(
      "SELECT conference_id FROM call_map WHERE call_control_id = ?",
      callControlId,
    );
    return cursor.toArray()[0]?.conference_id ?? "";
  }

  async unmapCall(callControlId: string): Promise<void> {
    this.ensureTables();
    this.ctx.storage.sql.exec("DELETE FROM call_map WHERE call_control_id = ?", callControlId);
  }

  async unmapConference(conferenceId: string): Promise<void> {
    this.ensureTables();
    this.ctx.storage.sql.exec("DELETE FROM call_map WHERE conference_id = ?", conferenceId);
  }

  private ensureTables(): void {
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS conferences(
         conference_id  TEXT PRIMARY KEY,
         friendly_name  TEXT NOT NULL DEFAULT '',
         participants   INTEGER NOT NULL DEFAULT 0,
         turn_count     INTEGER NOT NULL DEFAULT 0,
         summary        TEXT NOT NULL DEFAULT '',
         started_at     INTEGER NOT NULL,
         ended_at       INTEGER,
         status         TEXT NOT NULL
       )`,
    );
    this.ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS idx_conferences_started_at ON conferences(started_at DESC)",
    );
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS bridge(
         id            INTEGER PRIMARY KEY CHECK (id = 1),
         conference_id TEXT NOT NULL,
         updated_at    INTEGER NOT NULL
       )`,
    );
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS call_map(
         call_control_id TEXT PRIMARY KEY,
         conference_id   TEXT NOT NULL,
         joined_at       INTEGER NOT NULL
       )`,
    );
    this.ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS idx_call_map_conference ON call_map(conference_id)",
    );
  }
}

export { daprSafeName };
