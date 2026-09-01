import type { ActorNamespace, CloudStorageBucket } from "@telnyx/edge-runtime";
import type Telnyx from "telnyx";
import type { CorpusAgent } from "./corpus-agent.js";
import type { PersonaAgent } from "./persona-agent.js";

/** One retrieved chunk handed from the corpus to a persona agent. */
export interface SearchHit {
  id: string;
  doc: string;
  ord: number;
  text: string;
  score: number;
}

/** Durable corpus state, merged via RFC 7396 merge patches. */
export interface CorpusState extends Record<string, unknown> {
  docs: string[];
  chunkCount: number;
  lastIngestedAt: number;
}

export interface IngestResult {
  doc: string;
  chunks: number;
}

/** Durable per-persona state (Q/A history lives in the agent MessageLog). */
export interface PersonaState extends Record<string, unknown> {
  corpusId: string;
  persona: string;
  asks: number;
  lastAskedAt: number;
}

export interface AskInput {
  corpusId: string;
  persona: string;
  question: string;
}

export interface AskResult {
  corpusId: string;
  persona: string;
  question: string;
  answer: string;
  sources: SearchHit[];
  model: string;
}

/**
 * Bindings environment. `CORPUS` and `PERSONAS` are the `[[actors]]`
 * namespaces from `telnyx.toml`; `TELNYX` is the pre-authenticated Telnyx API
 * binding (zero-credential — no API key is read or stored anywhere in this
 * sample); `KNOWLEDGE` is the Cloud Storage bucket documents are ingested
 * from.
 */
export interface Env {
  CORPUS: ActorNamespace<CorpusAgent>;
  PERSONAS: ActorNamespace<PersonaAgent>;
  TELNYX: Telnyx;
  KNOWLEDGE: CloudStorageBucket;
  [key: string]: unknown;
  AI_MODEL?: string;
  EMBEDDING_MODEL?: string;
  KNOWLEDGE_PREFIX?: string;
  TOP_K?: string;
  CHUNK_SIZE?: string;
  CHUNK_OVERLAP?: string;
}

export const DEFAULT_AI_MODEL = "meta-llama/Llama-3.3-70B-Instruct";
export const DEFAULT_EMBEDDING_MODEL = "thenlper/gte-large";
export const DEFAULT_KNOWLEDGE_PREFIX = "knowledge/";
export const DEFAULT_TOP_K = 4;
export const DEFAULT_CHUNK_SIZE = 800;
export const DEFAULT_CHUNK_OVERLAP = 150;

export function modelId(env: Env): string {
  return envVar(env.AI_MODEL, DEFAULT_AI_MODEL);
}

export function embeddingModelId(env: Env): string {
  return envVar(env.EMBEDDING_MODEL, DEFAULT_EMBEDDING_MODEL);
}

export function knowledgePrefix(env: Env): string {
  return envVar(env.KNOWLEDGE_PREFIX, DEFAULT_KNOWLEDGE_PREFIX);
}

export function topK(env: Env): number {
  return intVar(env.TOP_K, DEFAULT_TOP_K, 1, 50);
}

export function chunkSize(env: Env): number {
  return intVar(env.CHUNK_SIZE, DEFAULT_CHUNK_SIZE, 100, 8000);
}

export function chunkOverlap(env: Env): number {
  return intVar(env.CHUNK_OVERLAP, DEFAULT_CHUNK_OVERLAP, 0, 1000);
}

function envVar(raw: string | undefined, fallback: string): string {
  return typeof raw === "string" && raw.trim() ? raw.trim() : fallback;
}

function intVar(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/** The persona registry — every personality reads the SAME shared corpus. */
export interface Persona {
  id: string;
  label: string;
  systemPrompt: string;
}

export const PERSONAS: Persona[] = [
  {
    id: "support",
    label: "Support Agent",
    systemPrompt:
      "You are a patient, friendly customer support agent. " +
      "Answer in plain language, one clear step at a time. " +
      "Ground every claim in the provided knowledge-base context and name the source document you used. " +
      "If the context does not cover the question, say so plainly and suggest contacting support.",
  },
  {
    id: "sales",
    label: "Sales Engineer",
    systemPrompt:
      "You are a confident sales engineer. " +
      "Tie every answer back to the customer's outcome: what it unlocks, how fast they can ship it. " +
      "Ground every claim in the provided knowledge-base context and name the source document you used. " +
      "If the context does not cover the question, say so and offer to set up a deeper demo.",
  },
  {
    id: "engineer",
    label: "Solutions Engineer",
    systemPrompt:
      "You are a precise solutions engineer. " +
      "Answer with exact names, limits, and configuration steps — no marketing language. " +
      "Ground every claim in the provided knowledge-base context and cite the source document. " +
      "If the context does not cover the question, state exactly what is missing and what you would check next.",
  },
];

/** Sanity-limit corpus ids so they are safe as actor names. */
export function sanitizeCorpusId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  return cleaned || "product-docs";
}

/** Actor name for a persona agent — unique per (corpus, persona) pair. */
export function personaActorName(corpusId: string, personaId: string): string {
  return `${sanitizeCorpusId(corpusId)}:${sanitizePersonaId(personaId)}`;
}

function sanitizePersonaId(raw: string): string {
  return PERSONAS.some((p) => p.id === raw) ? raw : "support";
}

export function findPersona(id: string): Persona {
  return PERSONAS.find((p) => p.id === sanitizePersonaId(id)) ?? PERSONAS[0];
}
