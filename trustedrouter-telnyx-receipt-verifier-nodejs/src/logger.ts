/**
 * Minimal structured logger with redaction.
 *
 * Request bodies, prompts, completions, receipts, and credentials are never
 * logged. The request logger only accepts whitelisted fields; the generic
 * redact() helper is the defense-in-depth layer for anything else.
 */

const REDACTED = "[redacted]";

const SENSITIVE_KEY_PATTERN =
  /(authorization|bearer|api[-_]?key|access[-_]?token|secret|credential|cookie|prompt|completion|receipt|password|jws)/i;

const SENSITIVE_VALUE_PATTERN = /^sk-tr-/i;

/**
 * Whitelisted operational keys that look sensitive by substring but are
 * safe (they never carry content): only token counts and verification flags.
 */
const SAFE_EXEMPT_KEYS = new Set([
  "promptTokens",
  "completionTokens",
  "totalTokens",
  "receiptVerified",
]);

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTED;
  if (typeof value === "string") {
    return SENSITIVE_VALUE_PATTERN.test(value) ? REDACTED : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) && !SAFE_EXEMPT_KEYS.has(key)
        ? REDACTED
        : redactValue(item, depth + 1);
    }
    return output;
  }
  return value;
}

export type Logger = {
  info: (fields: Record<string, unknown>) => void;
  error: (fields: Record<string, unknown>) => void;
};

function redactRecord(fields: Record<string, unknown>): Record<string, unknown> {
  return redactValue(fields) as Record<string, unknown>;
}

export function createLogger(writeLine: (line: string) => void = defaultWriteLine): Logger {
  const emit = (level: "info" | "error", fields: Record<string, unknown>): void => {
    const record = { level, time: new Date().toISOString(), ...redactRecord(fields) };
    writeLine(JSON.stringify(record));
  };
  return {
    info: (fields) => emit("info", fields),
    error: (fields) => emit("error", fields),
  };
}

function defaultWriteLine(line: string): void {
  process.stdout.write(`${line}\n`);
}

export interface SafeRequestLogFields {
  event: string;
  requestId: string;
  route: string;
  method: string;
  status?: number;
  durationMs?: number;
  model?: string;
  provider?: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
  receiptVerified?: boolean | null;
  error?: string;
}

/** Only whitelisted operational fields reach the log; everything else is dropped. */
export function logRequest(logger: Logger, fields: SafeRequestLogFields): void {
  const safe: Record<string, unknown> = {
    event: fields.event,
    requestId: fields.requestId,
    route: fields.route,
    method: fields.method,
  };
  if (fields.status !== undefined) safe.status = fields.status;
  if (fields.durationMs !== undefined) safe.durationMs = fields.durationMs;
  if (fields.model !== undefined) safe.model = fields.model;
  if (fields.provider !== undefined) safe.provider = fields.provider;
  if (fields.promptTokens !== undefined) safe.promptTokens = fields.promptTokens;
  if (fields.completionTokens !== undefined) safe.completionTokens = fields.completionTokens;
  if (fields.receiptVerified !== undefined) safe.receiptVerified = fields.receiptVerified;
  if (fields.error !== undefined) safe.error = fields.error;
  logger.info(safe);
}
