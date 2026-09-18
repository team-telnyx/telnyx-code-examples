// Re-export the actor classes so they ship with the bundle.
export { DebateAgent } from "./debateAgent.js";
export { DebateRoom } from "./debateRoom.js";
import type { DebateAgent, Stance } from "./debateAgent.js";
import type { DebateRoom, DebateRoomState } from "./debateRoom.js";
import { dashboardHtml } from "./dashboard.js";

import {
  type ActorNamespace,
  type ActorStub,
  type IdFromNameOptions,
} from "@telnyx/edge-runtime";
import { mountAgents } from "@telnyx/edge-runtime/mount";

type RoomStub = ActorStub & Pick<DebateRoom, "start" | "vote" | "finalize" | "snapshot">;
type DebaterStub = ActorStub & Pick<DebateAgent, "compose">;

interface RoomNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): RoomStub;
}

interface DebaterNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): DebaterStub;
}

interface Env {
  DEBATE_ROOM: RoomNamespace;
  DEBATER: DebaterNamespace;
}

const DEFAULT_TOPIC = "Resolved: AI will benefit humanity";
const DEFAULT_MODEL = "meta-llama/Llama-3.3-70B-Instruct";
const DEBATE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;

/**
 * Demo mode: DEMO_MODE=false runs live inference through the TELNYX binding;
 * every other value keeps the debate on canned arguments (safe default).
 */
function isDemoMode(): boolean {
  return (process.env.DEMO_MODE ?? "true").toLowerCase() !== "false";
}

function aiModel(): string {
  return process.env.AI_MODEL || DEFAULT_MODEL;
}

/** Dapr-safe actor names: RFC 1123 — no "+", no special chars. */
function debateActorName(debateId: string): string {
  if (!DEBATE_ID.test(debateId)) throw new Error("debateId must contain 1-64 letters, numbers, underscores, dots, or hyphens");
  return debateId;
}

function room(env: Env, debateId: string): RoomStub {
  return env.DEBATE_ROOM.idFromName(debateActorName(debateId));
}

// ── Agent socket mount — WebSocket/SSE/RPC for the live audience ─────────
// Addresses: /agents/room/<debate-id> — a WebSocket upgrade lands in
// DebateRoom's built-in connection surface and receives state snapshots +
// patches (arguments, tally, phase) and events live.
const handleAgents = mountAgents<Env>((env) => ({ room: env.DEBATE_ROOM }));

// ── Router ───────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // ── Live debate stream (agent socket mount) ──────────────────────
    if (url.pathname.startsWith("/agents/")) {
      return handleAgents(req, env);
    }

    // ── Health ───────────────────────────────────────────────────────
    if (url.pathname === "/health") return Response.json({ status: "ok" });

    // ── Live dashboard ───────────────────────────────────────────────
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return new Response(dashboardHtml(), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }

    try {
      // ── Start a debate ─────────────────────────────────────────────
      if (req.method === "POST" && url.pathname === "/debate") {
        const body = await jsonBody(req);
        const topic = stringValue(body.topic) || DEFAULT_TOPIC;
        const debateId = stringValue(body.debateId) || newDebateId();
        const state = await room(env, debateId).start({
          debateId,
          topic,
          demo: isDemoMode(),
          model: aiModel(),
        });
        return Response.json(toSession(state), { status: 201 });
      }

      // ── Debate queries and actions ─────────────────────────────────
      if (url.pathname.startsWith("/debate/")) {
        const parts = url.pathname.split("/debate/")[1].split("/");
        const debateId = parts[0] ?? "";
        if (!debateId) return Response.json({ error: "debateId is required" }, { status: 400 });
        const stub = room(env, debateId);

        if (req.method === "GET" && parts.length === 1) {
          const state = await stub.snapshot();
          if (!state.debateId) return Response.json({ error: "debate not found" }, { status: 404 });
          return Response.json(state);
        }
        if (req.method === "POST" && parts[1] === "vote") {
          const body = await jsonBody(req);
          const choice = stringValue(body.choice) as Stance;
          if (choice !== "pro" && choice !== "con") throw new Error("choice must be 'pro' or 'con'");
          const voterId = stringValue(body.voterId) || `audience-${Math.random().toString(36).slice(2, 10)}`;
          return Response.json(await stub.vote({ voterId, choice }));
        }
        if (req.method === "POST" && parts[1] === "end" && parts.length === 2) {
          const state = await stub.finalize();
          return Response.json(toResult(state));
        }
      }
    } catch (error: unknown) {
      return errorResponse(error);
    }

    return Response.json({
      name: "multi-agent-debate",
      endpoints: ["POST /debate", "GET /debate/{id}", "POST /debate/{id}/vote", "POST /debate/{id}/end", "WS /agents/room/{id}"],
    }, { status: 404 });
  },
};

// ── Response shaping ─────────────────────────────────────────────────────

interface DebateSession {
  debateId: string;
  topic: string;
  status: string;
  currentTurn: string;
  createdAt: number;
}

function toSession(state: DebateRoomState): DebateSession {
  return {
    debateId: state.debateId,
    topic: state.topic,
    status: state.phase,
    currentTurn: state.currentTurn,
    createdAt: state.startedAt,
  };
}

function toResult(state: DebateRoomState): Record<string, unknown> {
  return {
    debateId: state.debateId,
    topic: state.topic,
    status: state.phase,
    winner: state.winner || "tie",
    finalVotes: { pro: state.tally.pro, con: state.tally.con },
    totalArguments: state.args.length,
    endedAt: state.endedAt || Date.now(),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function newDebateId(): string {
  return `debate-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  const parsed: unknown = await req.json().catch(() => ({}));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  const clientError = /required|invalid|must|already|not found|not accepting|is not open/.test(message);
  return Response.json({ error: message }, { status: clientError ? 400 : 500 });
}
