import type { ActorNamespace } from "@telnyx/edge-runtime";
import type Telnyx from "telnyx";
import type { DocActor } from "./doc-actor.js";

/** Cursor position within the document, 0-indexed. */
export interface Cursor {
  line: number;
  col: number;
}

/** An AI copilot proposal awaiting accept/reject. */
export interface Suggestion {
  id: string;
  originalText: string;
  suggestedText: string;
  model: string;
  createdAt: number;
}

/** Durable document state, merged via RFC 7396 merge patches. */
export interface DocState extends Record<string, unknown> {
  text: string;
  cursors: Record<string, Cursor>;
  suggestions: Suggestion[];
  lastSuggestionAt: number;
}

/**
 * Bindings environment. `DOCS` is the `[[actors]]` namespace from
 * `telnyx.toml`; `TELNYX` is the pre-authenticated Telnyx API binding
 * (zero-credential — no API key is read or stored anywhere in this sample).
 */
export interface Env {
  DOCS: ActorNamespace<DocActor>;
  TELNYX: Telnyx;
  [key: string]: unknown;
  AI_MODEL?: string;
  SUGGESTION_COOLDOWN_SECONDS?: string;
}

export const DEFAULT_MODEL = "meta-llama/Llama-3.3-70B-Instruct";
export const DEFAULT_COOLDOWN_SECONDS = 5;

export function modelId(env: Env): string {
  const raw = env.AI_MODEL;
  return typeof raw === "string" && raw.trim() ? raw.trim() : DEFAULT_MODEL;
}

export function cooldownMs(env: Env): number {
  const raw = Number(env.SUGGESTION_COOLDOWN_SECONDS);
  return Number.isFinite(raw) && raw >= 0 ? raw * 1000 : DEFAULT_COOLDOWN_SECONDS * 1000;
}

/** Extract the document id from `?doc=` (fallback: `doc_demo`). */
export function docIdFromUrl(url: URL): string {
  const id = url.searchParams.get("doc");
  return id && id.trim() ? id.trim() : "doc_demo";
}

/** Sanity-limit doc ids so they are safe as actor names. */
export function sanitizeDocId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  return cleaned || "doc_demo";
}
