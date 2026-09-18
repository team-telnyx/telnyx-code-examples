import type { Env as RuntimeEnv } from "@telnyx/edge-runtime";
import type { StreamingAgent } from "./streaming-agent.js";

/** Model ids verified against Telnyx Inference with tool calling + streaming. */
export const DEFAULT_MODEL = "zai-org/GLM-5.2";

export function modelId(env: Env): string {
  return env.AI_MODEL || DEFAULT_MODEL;
}

/**
 * Durable state for one streaming conversation.
 *
 * `turn` increments on every user message. `answeredThrough` is the message
 * seq of the last user turn the agent loop answered — the gap between the two
 * is the pending backlog, and it is what survives a crash: on reactivation the
 * queued run task re-dispatches and answers exactly the unanswered turns.
 */
export interface AgentState extends Record<string, unknown> {
  status: "idle" | "thinking";
  turn: number;
  answeredThrough: number;
  toolsUsed: number;
}

/** Events emitted into the agent's durable event log (streamed live to clients). */
export type StreamingAgentEvent =
  | { type: "token"; payload: { turn: number; text: string } }
  | { type: "tool_start"; payload: { turn: number; tool: string; input: unknown } }
  | { type: "tool_result"; payload: { turn: number; tool: string; output: string } };

/**
 * Bindings for this function. `AGENTS` and `TELNYX` are declared (with their
 * generated types) by `telnyx-env.d.ts`; `AI_MODEL` picks the inference model.
 */
export interface Env extends RuntimeEnv {
  AI_MODEL?: string;
}

export interface AgentEventItem {
  seq: number;
  type: string;
  payload: unknown;
  at: string;
}

export interface AgentMessageItem {
  seq: number;
  role: string;
  content: string;
  at: string;
}
