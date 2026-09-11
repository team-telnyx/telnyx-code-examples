import type { KvNamespace } from "@telnyx/edge-runtime";
import type { KvLike } from "./breaker.js";

/**
 * Live operations event feed — what the demo dashboard polls at
 * `GET /api/events`. Each event is its own KV key (`event:<ms>-<rand>`, 1h
 * TTL) so the worker and the FailoverAgent actor can record concurrently
 * without a read-modify-write race on a shared list.
 */
export type EventKind =
  | "route_decision"
  | "call_answered"
  | "webhook"
  | "failure_counted"
  | "breaker_tripped"
  | "caller_response"
  | "sms_sent"
  | "breaker_reset";

export interface OpsEvent {
  ts: string;
  kind: EventKind;
  detail: string;
  connection: "primary" | "backup" | null;
}

const EVENT_PREFIX = "event/";

/** Edge KV keys allow a-z A-Z 0-9 - _ / = . — call control ids contain colons. */
export function kvSafeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_.\/-]/g, "-");
}
const EVENT_TTL_SECONDS = 3600;

export async function recordEvent(
  kv: KvLike,
  kind: EventKind,
  detail: string,
  connection: "primary" | "backup" | null = null,
): Promise<void> {
  const event: OpsEvent = {
    ts: new Date().toISOString(),
    kind,
    detail,
    connection,
  };
  const suffix = Math.random().toString(36).slice(2, 8);
  await kv.put(
    `${EVENT_PREFIX}${Date.now()}-${suffix}`,
    JSON.stringify(event),
    { expirationTtl: EVENT_TTL_SECONDS },
  );
}

/** Newest first, capped — walks every list page so the feed never misses events. */
export async function listEvents(kv: KvNamespace, limit = 30): Promise<OpsEvent[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: EVENT_PREFIX, limit: 100, cursor });
    keys.push(...page.keys.map((info) => info.name));
    cursor = page.list_complete ? undefined : (page as { cursor?: string }).cursor;
  } while (cursor && keys.length < 200);
  keys.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const events: OpsEvent[] = [];
  for (const key of keys.slice(0, limit)) {
    const raw = await kv.get(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as OpsEvent;
      if (parsed && typeof parsed.kind === "string") {
        events.push({
          ts: parsed.ts,
          kind: parsed.kind,
          detail: parsed.detail,
          connection: parsed.connection ?? null,
        });
      }
    } catch {
      continue;
    }
  }
  return events;
}

/**
 * DEMO_MODE override chain: KV `config/demo-mode` wins (runtime-controlled —
 * flip it with `telnyx-edge storage kv key put` and no re-ship), then env, then
 * the safe default (demo on).
 */
export async function demoModeEnabled(
  kv: KvLike | undefined,
  envValue: string | undefined,
): Promise<boolean> {
  let override: string | undefined;
  if (kv) {
    try {
      override = (await kv.get("config/demo-mode")) ?? undefined;
    } catch {
      override = undefined;
    }
  }
  const value = override ?? envValue ?? "true";
  return ["true", "1", "yes"].includes(value.toLowerCase());
}

/** KV-first config lookup: `config/<name>` wins, env var is the fallback. */
export async function configValue(
  kv: KvLike | undefined,
  name: string,
  envFallback: string | undefined,
): Promise<string | undefined> {
  if (kv) {
    try {
      const override = (await kv.get(`config/${name}`)) ?? undefined;
      if (override) return override;
    } catch {
      // fall through to the env value
    }
  }
  return envFallback;
}
