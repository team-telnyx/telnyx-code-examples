import { Agent, rpc, type ActorStub, type Claim } from "@telnyx/edge-runtime";
import type { DebateAgent, Stance } from "./debateAgent.js";

// ── State ────────────────────────────────────────────────────────────────

export type DebatePhase = "idle" | "debating" | "voting" | "ended" | "error";
export type Winner = "pro" | "con" | "tie";

export interface DebateArgument {
  stance: Stance;
  text: string;
  turn: number;
  at: number;
}

export interface VoteTally {
  pro: number;
  con: number;
  total: number;
}

export interface DebateRoomState extends Record<string, unknown> {
  debateId: string;
  topic: string;
  demo: boolean;
  model: string;
  phase: DebatePhase;
  currentTurn: Stance;
  args: DebateArgument[];
  tally: VoteTally;
  winner: Winner | "";
  startedAt: number;
  endedAt: number;
  error: string;
}

// ── Env: [telnyx] binding only (actors receive no secrets/env_vars) ──────

type DebaterStub = ActorStub & Pick<DebateAgent, "compose">;

interface DebateEnv {
  DEBATER: {
    idFromName(name: string): DebaterStub;
  };
}

/**
 * DebateRoom — one durable actor instance per debate, keyed by debate id.
 * Orchestrates the two DebateAgent actors (pro/con), tracks the turn-based
 * argument transcript and live vote tally in agent state, and keeps the
 * durable vote ledger in the actor's embedded SQL.
 *
 * Live streaming rides the Agent base-class connection surface: overriding
 * `authorize` opts in, so every WebSocket client connected through the
 * `/agents` mount receives the state snapshot on connect and an incremental
 * merge-patch on every `setState` — arguments, tally, and phase stream live
 * with no socket code here.
 */
export class DebateRoom extends Agent<DebateEnv, DebateRoomState> {
  protected override initialState(): DebateRoomState {
    return {
      debateId: "",
      topic: "",
      demo: true,
      model: "",
      phase: "idle",
      currentTurn: "pro",
      args: [],
      tally: { pro: 0, con: 0, total: 0 },
      winner: "",
      startedAt: 0,
      endedAt: 0,
      error: "",
    };
  }

  /**
   * The agent socket connection surface — anonymous clients watch; a token
   * grants the `rpc` claim so socket `call` frames can reach the `@rpc()`
   * vote method.
   */
  protected override authorize(token: string | undefined): readonly Claim[] {
    return token === undefined ? ["read"] : ["read", "rpc"];
  }

  /**
   * Start the debate: pro opens, con rebuts, then voting opens. Runs the
   * same flow in demo mode without touching the inference binding.
   */
  async start(input: { debateId: string; topic: string; demo: boolean; model: string }): Promise<DebateRoomState> {
    const state = await this.getState();
    if (state.debateId === input.debateId && state.phase !== "idle" && state.phase !== "error") {
      throw new Error("debate already started");
    }
    await this.replaceState({
      debateId: input.debateId,
      topic: input.topic,
      demo: input.demo,
      model: input.model,
      phase: "debating",
      currentTurn: "pro",
      args: [],
      tally: { pro: 0, con: 0, total: 0 },
      winner: "",
      startedAt: Date.now(),
      endedAt: 0,
      error: "",
    });
    this.ensureSchema();
    await this.events.emit("debate.started", { topic: input.topic, demo: input.demo });
    await this.composeArguments();
    return this.getState();
  }

  /** Audience vote — callable over the socket protocol (`@rpc()`) and via actor RPC. */
  @rpc({ description: "Cast an audience vote for the pro or con side" })
  async vote(input: { voterId: string; choice: Stance }): Promise<DebateRoomState> {
    const state = await this.getState();
    if (state.phase !== "voting") throw new Error("voting is not open for this debate");
    if (!input.voterId.trim()) throw new Error("voterId is required");
    if (input.choice !== "pro" && input.choice !== "con") throw new Error("choice must be 'pro' or 'con'");
    const now = Date.now();
    const existing = this.ctx.storage.sql
      .exec("SELECT choice FROM votes WHERE voter_id = ?", input.voterId)
      .toArray()[0];
    if (existing) {
      if (existing.choice === input.choice) return this.getState();
      this.ctx.storage.sql.exec("UPDATE votes SET choice = ?, voted_at = ? WHERE voter_id = ?", input.choice, now, input.voterId);
    } else {
      this.ctx.storage.sql.exec(
        "INSERT INTO votes (voter_id, choice, voted_at) VALUES (?, ?, ?)",
        input.voterId,
        input.choice,
        now,
      );
    }
    const tally = await this.readTally();
    await this.setState({ tally });
    await this.events.emit("vote.recorded", { choice: input.choice, tally });
    return this.getState();
  }

  /** Close voting and declare the winner from the SQL tally. */
  async finalize(): Promise<DebateRoomState> {
    const state = await this.getState();
    if (state.phase === "ended") throw new Error("debate already ended");
    if (state.phase !== "voting") throw new Error("debate is not accepting votes yet");
    const tally = await this.readTally();
    const winner: Winner = tally.pro > tally.con ? "pro" : tally.con > tally.pro ? "con" : "tie";
    await this.setState({ phase: "ended", tally, winner, endedAt: Date.now() });
    await this.events.emit("debate.ended", { winner, tally });
    return this.getState();
  }

  /** Current state plus a fresh SQL tally — the read model for the front door. */
  async snapshot(): Promise<DebateRoomState> {
    const state = await this.getState();
    if (!state.debateId) return state;
    return { ...state, tally: await this.readTally() };
  }

  /** Run the two debaters in sequence: pro opens, con rebuts, then voting opens. */
  private async composeArguments(): Promise<void> {
    let previousArgument = "";
    for (const stance of ["pro", "con"] as const) {
      const state = await this.getState();
      try {
        const debater = this.env.DEBATER.idFromName(`${state.debateId}-${stance}`);
        const composed = await debater.compose({
          debateId: state.debateId,
          topic: state.topic,
          stance,
          demo: state.demo,
          model: state.model,
          previousArgument,
        });
        previousArgument = composed.argument;
        const args: DebateArgument[] = [
          ...state.args,
          { stance, text: composed.argument, turn: state.args.length + 1, at: Date.now() },
        ];
        await this.setState({ args, currentTurn: stance === "pro" ? "con" : "pro" });
        await this.events.emit("argument.delivered", { stance, turn: args.length });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        await this.setState({ phase: "error", error: message });
        await this.events.emit("debate.error", { message });
        return;
      }
    }
    await this.setState({ phase: "voting", currentTurn: "con" });
    await this.events.emit("voting.opened", { message: "Audience, vote for the winner!" });
  }

  private ensureSchema(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS votes (
        voter_id TEXT PRIMARY KEY,
        choice TEXT NOT NULL,
        voted_at INTEGER NOT NULL
      );
    `);
  }

  private async readTally(): Promise<VoteTally> {
    this.ensureSchema();
    const rows = this.ctx.storage.sql
      .exec("SELECT choice, COUNT(*) AS count FROM votes GROUP BY choice")
      .toArray();
    const tally: VoteTally = { pro: 0, con: 0, total: 0 };
    for (const row of rows) {
      const count = Number(row.count);
      if (row.choice === "pro") tally.pro = count;
      if (row.choice === "con") tally.con = count;
      tally.total += count;
    }
    return tally;
  }
}
