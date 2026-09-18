import type { KvNamespace } from "@telnyx/edge-runtime";

/**
 * Circuit-breaker state for the primary SIP connection, persisted in Telnyx KV.
 * Keys use the Edge KV charset (a-z A-Z 0-9 - _ / = .) — no colons so existing dashboards and
 * tooling keep working after the port.
 */
export interface BreakerSnapshot {
  failures: number;
  /** Epoch seconds of the most recent primary failure (0 = never failed). */
  last_fail: number;
  tripped: boolean;
}

export type BreakerStatus = "closed" | "open" | "half-open";

/**
 * Minimal KV surface both the worker's `KvNamespace` binding and the actor's
 * durable-storage fallback satisfy. Values are strings (KV is text-only);
 * structured values are serialized by the caller.
 */
export interface KvLike {
  get(key: string): Promise<string | null | undefined>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export const BREAKER_KEYS = {
  failures: "primary/failures",
  lastFail: "primary/last_fail",
  tripped: "primary/tripped",
} as const;

/** Read the raw breaker state (no derived status). Tolerates KV stores that
 * reject gets on never-written keys instead of resolving null. */
export async function readBreaker(kv: KvLike): Promise<BreakerSnapshot> {
  const read = async (key: string): Promise<string | undefined> => {
    try {
      return (await kv.get(key)) ?? undefined;
    } catch {
      return undefined;
    }
  };
  const [failures, lastFail, tripped] = await Promise.all([
    read(BREAKER_KEYS.failures),
    read(BREAKER_KEYS.lastFail),
    read(BREAKER_KEYS.tripped),
  ]);
  return {
    failures: Number.parseInt(failures ?? "0", 10) || 0,
    last_fail: Number.parseFloat(lastFail ?? "0") || 0,
    tripped: (tripped ?? "false") === "true",
  };
}

/** `true` once the cooldown window since the last failure has fully elapsed. */
export function cooldownExpired(snapshot: BreakerSnapshot, cooldownSeconds: number): boolean {
  if (snapshot.last_fail === 0) return true;
  return Date.now() / 1000 - snapshot.last_fail >= cooldownSeconds;
}

/** CLOSED → OPEN (tripped, cooldown active) → HALF-OPEN (cooldown elapsed). */
export function breakerStatus(snapshot: BreakerSnapshot, cooldownSeconds: number): BreakerStatus {
  if (snapshot.tripped && cooldownExpired(snapshot, cooldownSeconds)) return "half-open";
  if (snapshot.tripped) return "open";
  return "closed";
}

/**
 * Router decision: backup only while the breaker is OPEN. When the cooldown
 * expires the breaker is HALF-OPEN — a probe call goes to primary again.
 */
export function shouldRouteToBackup(snapshot: BreakerSnapshot, cooldownSeconds: number): boolean {
  if (!snapshot.tripped) return false;
  return !cooldownExpired(snapshot, cooldownSeconds);
}

/** Count one primary failure and return the new total. Actor-only write path. */
export async function incrementFailures(kv: KvLike): Promise<number> {
  const snapshot = await readBreaker(kv);
  const failures = snapshot.failures + 1;
  await kv.put(BREAKER_KEYS.failures, String(failures));
  return failures;
}

/** Record the failure timestamp in epoch seconds. */
export async function setLastFail(kv: KvLike, epochSeconds: number): Promise<void> {
  await kv.put(BREAKER_KEYS.lastFail, String(epochSeconds));
}

/** Trip the breaker: OPEN until the cooldown expires. */
export async function tripBreaker(kv: KvLike, epochSeconds: number): Promise<void> {
  await kv.put(BREAKER_KEYS.tripped, "true");
  await kv.put(BREAKER_KEYS.lastFail, String(epochSeconds));
}

/** Reset the breaker to CLOSED. Returns the fresh snapshot. */
export async function resetBreaker(kv: KvLike): Promise<BreakerSnapshot> {
  await kv.put(BREAKER_KEYS.failures, "0");
  await kv.put(BREAKER_KEYS.tripped, "false");
  await kv.put(BREAKER_KEYS.lastFail, "0");
  return readBreaker(kv);
}

/**
 * KV namespace type re-exported for convenience: worker code types its env
 * binding with this, and the actor falls back to durable storage when the
 * binding is not injected into actor processes (see network-incident-agent).
 */
export type { KvNamespace };
