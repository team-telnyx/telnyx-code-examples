/**
 * The recording store: conversation scripts persisted in the actor's durable
 * SQLite (`this.ctx.storage.sql`), plus the zod schema that validates inbound
 * recordings at the trust boundary.
 */
import { z } from "zod";
import type { SqlBindValue, SqlValue } from "@telnyx/edge-runtime";
import type { ConversationRecording, ScriptStep } from "./types.js";

/**
 * Inbound recording payload. `conversationId` selects the replay actor
 * (one conversation = one actor = one MessageLog), `steps` is the ordered
 * recording. `replace` controls idempotency: an ingest with the same id
 * replaces the stored recording.
 */
export const recordingSchema = z.object({
  conversation_id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^\+?[a-zA-Z0-9_-]+$/, "E.164 phone number or letters/digits/dashes/underscores only"),
  replace: z.boolean().optional().default(true),
  steps: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string().min(1).max(4000),
        delayMs: z.number().int().min(0).max(60_000).default(1000),
        stage: z.string().min(1).max(64).optional(),
      }),
    )
    .min(1)
    .max(200),
});

export type RecordingInput = z.infer<typeof recordingSchema>;

export function parseRecording(raw: unknown): RecordingInput {
  return recordingSchema.parse(raw);
}

/**
 * Ensure the recordings table exists. Positional `?` binds only — the
 * actor SQL surface does not support named parameters.
 */
export function ensureSchema(sql: {
  exec(query: string, ...binds: unknown[]): unknown;
}): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS recordings (
      idx INTEGER PRIMARY KEY,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      delay_ms INTEGER NOT NULL,
      stage TEXT
    )
  `);
}

/** Replace any stored recording for this actor with `input.steps`. */
export function storeRecording(
  sql: { exec(query: string, ...binds: unknown[]): unknown },
  input: RecordingInput,
): number {
  ensureSchema(sql);
  sql.exec("DELETE FROM recordings");
  for (let idx = 0; idx < input.steps.length; idx += 1) {
    const step = input.steps[idx] as ScriptStep;
    sql.exec(
      "INSERT INTO recordings (idx, role, content, delay_ms, stage) VALUES (?, ?, ?, ?, ?)",
      idx,
      step.role,
      step.content,
      step.delayMs,
      step.stage ?? null,
    );
  }
  return input.steps.length;
}

/** Load the stored recording, in order. Empty array when nothing is stored. */
export function loadRecording(sql: {
  exec(query: string, ...binds: unknown[]): { toArray(): Record<string, SqlValue>[] };
}): ScriptStep[] {
  const rows = sql
    .exec(
      "SELECT idx, role, content, delay_ms, stage FROM recordings ORDER BY idx ASC",
    )
    .toArray();
  return rows.map((row) => ({
    role: String(row.role) as ScriptStep["role"],
    content: String(row.content),
    delayMs: Number(row.delay_ms),
    ...(row.stage === null || row.stage === undefined
      ? {}
      : { stage: String(row.stage) }),
  }));
}

/** Drop the stored recording (leaves the MessageLog untouched). */
export function clearRecording(sql: {
  exec(query: string, ...binds: unknown[]): unknown;
}): void {
  ensureSchema(sql);
  sql.exec("DELETE FROM recordings");
}

/** Type guard so callers can narrow the loose SQL bind type safely. */
export function asBind(value: string | number | null): SqlBindValue {
  return value as SqlBindValue;
}

export type { ConversationRecording };
