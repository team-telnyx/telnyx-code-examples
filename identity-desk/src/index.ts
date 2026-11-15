/**
 * identity-desk \u2014 THE IDENTITY LEDGER
 *
 * One durable IdentityDesk actor per phone number. Intake captures a number,
 * the actor runs a multi-type Telnyx Number Lookup (carrier + enhanced caller
 * name), files an append-only snapshot in agent SQL, and diffs it against the
 * previous snapshot so the front desk sees carrier/portability/name deltas on
 * the next visit \u2014 even after a pod restart.
 *
 * ASSUMPTION: "agent SQL" is the SqlDatabase binding (IDENTITY_DB) declared in
 *   telnyx.toml; the actor owns the schema and every query.
 * ASSUMPTION: Number Lookup is called over REST (GET /v2/number_lookup/{e164})
 *   because the TELNYX binding exposes messaging/AI, not lookup.
 * ASSUMPTION: DEMO_MODE=true returns deterministic fixtures (first lookup =
 *   Verizon mobile, second = ported to Google Fi, even last digit = VoIP) so
 *   the sample runs with no API key and no charges. DEMO_MODE=false calls the
 *   real Telnyx API.
 *
 * SELF-REVIEW:
 * - Real primitives: Agent state, SqlDatabase snapshots, @rpc staff surface.
 * - Parameterized SQL only; no credentials or full phone numbers in logs.
 * - Demo mode default; live mode documented in .env.example.
 */
import { Agent, rpc, rpcSurface } from "@telnyx/edge-runtime";
import type { ActorNamespace, Secrets, SqlDatabase } from "@telnyx/edge-runtime";

export const LOOKUP_TYPES = ["carrier", "enhanced-caller-name"] as const;
export const SOURCE_TYPE = LOOKUP_TYPES.join("+");

export const CREATE_SNAPSHOT_TABLE = `CREATE TABLE IF NOT EXISTS identity_snapshot (
  phone_e164 TEXT NOT NULL,
  looked_up_at TIMESTAMPTZ NOT NULL,
  source_type TEXT NOT NULL,
  carrier_name TEXT,
  line_type TEXT,
  ported_status TEXT,
  caller_name TEXT,
  entity_type TEXT,
  confidence_score INT
)`;

const CREATE_SNAPSHOT_INDEX = `CREATE UNIQUE INDEX IF NOT EXISTS identity_snapshot_dedupe
  ON identity_snapshot (phone_e164, looked_up_at, source_type)`;

interface Env {
  SECRETS: Secrets;
  IDENTITY: ActorNamespace;
  IDENTITY_DB: SqlDatabase;
  DEMO_MODE?: string;
  TELNYX_API_BASE?: string;
}

interface IdentityState {
  phoneNumber: string;
  lastConfidence: number;
  entity_type: string;
  carrierName: string;
  lineType: string;
  snapshotCount: number;
  flags: string[];
}

export interface IntakePayload {
  phoneE164?: string;
  capturedAt?: string;
}

export interface LookupRecord {
  carrier_name: string | null;
  line_type: string | null;
  ported_status: string | null;
  caller_name: string | null;
  entity_type: string | null;
  confidence_score: number;
  source_type: string;
}

export interface SnapshotRow extends LookupRecord {
  phone_e164: string;
  looked_up_at: string;
}

export interface Delta {
  from: string;
  to: string;
  changes: string[];
}

export interface Ledger {
  phone_e164: string;
  snapshot_count: number;
  verified: boolean;
  low_trust: boolean;
  latest: SnapshotRow | null;
  deltas: Delta[];
  snapshots: SnapshotRow[];
}

export interface IntakeResult {
  status: "filed" | "duplicate";
  phone_e164: string;
  looked_up_at: string;
  flags: string[];
  ledger: Ledger;
}

interface IdentityDeskRpc {
  onIntakeCaptured(payload: IntakePayload): Promise<IntakeResult>;
  identity(e164: string): Promise<Ledger>;
}

export function normalizeE164(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const digits = input.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15 || digits.startsWith("0")) return null;
  return `+${digits}`;
}

export function digitsOfE164(e164: string): string {
  return e164.replace(/\D/g, "");
}

function maskPhone(e164: string): string {
  const digits = digitsOfE164(e164);
  return digits.length <= 4 ? "****" : `+${digits.slice(0, 4)}****${digits.slice(-2)}`;
}

function normalizeTimestamp(input: unknown): string {
  if (typeof input === "string") {
    const parsed = new Date(input);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { results?: unknown } | null)?.results;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

/** Maps a Telnyx NumberLookupRecord onto the ledger columns. */
export function normalizeLookup(data: Record<string, unknown>): LookupRecord {
  const carrier = asRecord(data.carrier);
  const portability = asRecord(data.portability);
  const cnam = asRecord(data.enhanced_caller_name);
  const identity = asRecord(data.caller_identity);
  const callerName = asString(cnam.caller_name) ?? asString(identity.caller_name);
  const rawConfidence = identity.confidence_score;
  const confidence =
    typeof rawConfidence === "number" ? Math.round(rawConfidence) : callerName ? 80 : 0;
  return {
    carrier_name: asString(carrier.name) ?? asString(portability.normalized_carrier),
    line_type: asString(carrier.type) ?? asString(portability.line_type),
    ported_status: asString(portability.ported_status),
    caller_name: callerName,
    entity_type: asString(cnam.entity_type),
    confidence_score: confidence,
    source_type: SOURCE_TYPE,
  };
}

function demoLookup(e164: string, priorCount: number): LookupRecord {
  const lastDigit = Number(digitsOfE164(e164).slice(-1));
  if (lastDigit % 2 === 0) {
    return {
      carrier_name: "Bandwidth.com",
      line_type: "voip",
      ported_status: "N",
      caller_name: null,
      entity_type: null,
      confidence_score: 0,
      source_type: SOURCE_TYPE,
    };
  }
  if (priorCount === 0) {
    return {
      carrier_name: "Verizon Wireless",
      line_type: "mobile",
      ported_status: "N",
      caller_name: "Martha Reyes",
      entity_type: "person",
      confidence_score: 80,
      source_type: SOURCE_TYPE,
    };
  }
  return {
    carrier_name: "Google Fi",
    line_type: "mobile",
    ported_status: "Y",
    caller_name: "Martha Reyes",
    entity_type: "person",
    confidence_score: 80,
    source_type: SOURCE_TYPE,
  };
}

export class IdentityDesk extends Agent<Env, IdentityState> {
  protected initialState(): IdentityState {
    return {
      phoneNumber: "",
      lastConfidence: 0,
      entity_type: "unknown",
      carrierName: "unknown",
      lineType: "unknown",
      snapshotCount: 0,
      flags: [],
    };
  }

  /** Intake capture \u2014 the only way an IdentityDesk is born. */
  async onIntakeCaptured(payload: IntakePayload): Promise<IntakeResult> {
    const e164 = normalizeE164(payload?.phoneE164);
    if (!e164) throw new Error("phoneE164 must be a valid E.164 number");
    const lookedUpAt = normalizeTimestamp(payload?.capturedAt);
    await this.ensureSchema();

    if (await this.snapshotExists(e164, lookedUpAt, SOURCE_TYPE)) {
      return {
        status: "duplicate",
        phone_e164: e164,
        looked_up_at: lookedUpAt,
        flags: [],
        ledger: await this.ledger(e164),
      };
    }

    const prior = await this.snapshots(e164);
    const record = await this.runLookup(e164, prior.length);
    await this.fileSnapshot(e164, lookedUpAt, record);
    const flags = this.onDelta(prior.length > 0 ? prior[prior.length - 1] : null, record);
    await this.recordState(e164, record, prior.length + 1, flags);
    console.log(
      `[identity-desk] filed snapshot for ${maskPhone(e164)} (${record.source_type}) flags=${flags.join(",") || "none"}`,
    );
    return {
      status: "filed",
      phone_e164: e164,
      looked_up_at: lookedUpAt,
      flags,
      ledger: await this.ledger(e164),
    };
  }

  /** Staff surface: the merged ledger + deltas for one number. */
  @rpc()
  async identity(e164Input: string): Promise<Ledger> {
    const e164 = normalizeE164(e164Input);
    if (!e164) throw new Error("e164 must be a valid E.164 number");
    await this.ensureSchema();
    this.logRpcSurface();
    return this.ledger(e164);
  }

  private async runLookup(e164: string, priorCount: number): Promise<LookupRecord> {
    if (this.demoMode()) return demoLookup(e164, priorCount);
    const apiKey = await this.env.SECRETS.get("TELNYX_API_KEY");
    if (!apiKey) throw new Error("TELNYX_API_KEY is not configured");
    const query = LOOKUP_TYPES.map((type) => `type=${encodeURIComponent(type)}`).join("&");
    const base = this.env.TELNYX_API_BASE ?? "https://api.telnyx.com";
    const response = await fetch(
      `${base}/v2/number_lookup/${encodeURIComponent(e164)}?${query}`,
      { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } },
    );
    if (!response.ok) throw new Error(`number_lookup returned ${response.status}`);
    const body = (await response.json()) as { data?: Record<string, unknown> };
    return normalizeLookup(body.data ?? {});
  }

  private onDelta(prev: LookupRecord | null, next: LookupRecord): string[] {
    if (!prev) return next.line_type === "voip" ? ["voip_low_trust"] : [];
    const flags: string[] = [];
    if (prev.carrier_name !== next.carrier_name) flags.push("carrier_changed");
    if (prev.caller_name !== next.caller_name) flags.push("name_changed");
    if (prev.ported_status !== next.ported_status) flags.push("portability_changed");
    if (prev.line_type !== next.line_type) flags.push("line_type_changed");
    if (next.line_type === "voip") flags.push("voip_low_trust");
    return flags;
  }

  private async recordState(
    e164: string,
    record: LookupRecord,
    count: number,
    flags: string[],
  ): Promise<void> {
    const state = await this.getState();
    await this.setState({
      phoneNumber: e164,
      lastConfidence: record.confidence_score,
      entity_type: record.entity_type ?? "unknown",
      carrierName: record.carrier_name ?? "unknown",
      lineType: record.line_type ?? "unknown",
      snapshotCount: count,
      flags: Array.from(new Set([...(state.flags ?? []), ...flags])),
    });
  }

  private async ledger(e164: string): Promise<Ledger> {
    const rows = await this.snapshots(e164);
    const deltas: Delta[] = [];
    for (let i = 1; i < rows.length; i += 1) {
      deltas.push({
        from: rows[i - 1].looked_up_at,
        to: rows[i].looked_up_at,
        changes: this.onDelta(rows[i - 1], rows[i]),
      });
    }
    const latest = rows.length > 0 ? rows[rows.length - 1] : null;
    return {
      phone_e164: e164,
      snapshot_count: rows.length,
      verified: latest !== null && latest.confidence_score >= 70,
      low_trust: latest?.line_type === "voip",
      latest,
      deltas,
      snapshots: rows,
    };
  }

  private demoMode(): boolean {
    const flag = this.env.DEMO_MODE;
    return flag === undefined ? true : flag !== "false";
  }

  private logRpcSurface(): void {
    try {
      const surface = rpcSurface(this);
      console.log(
        `[identity-desk] rpc surface: ${Array.isArray(surface) ? surface.join(", ") : String(surface)}`,
      );
    } catch {
      console.log("[identity-desk] rpc surface: identity(e164)");
    }
  }

  private async ensureSchema(): Promise<void> {
    await this.env.IDENTITY_DB.exec(CREATE_SNAPSHOT_TABLE);
    await this.env.IDENTITY_DB.exec(CREATE_SNAPSHOT_INDEX);
  }

  private async snapshotExists(
    e164: string,
    lookedUpAt: string,
    sourceType: string,
  ): Promise<boolean> {
    const result = await this.env.IDENTITY_DB.prepare(
      "SELECT looked_up_at FROM identity_snapshot WHERE phone_e164 = ? AND looked_up_at = ? AND source_type = ? LIMIT 1",
    )
      .bind(e164, lookedUpAt, sourceType)
      .all();
    return rowsOf<{ looked_up_at: string }>(result).length > 0;
  }

  private async fileSnapshot(
    e164: string,
    lookedUpAt: string,
    record: LookupRecord,
  ): Promise<void> {
    await this.env.IDENTITY_DB.prepare(
      `INSERT INTO identity_snapshot
       (phone_e164, looked_up_at, source_type, carrier_name, line_type, ported_status, caller_name, entity_type, confidence_score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        e164,
        lookedUpAt,
        record.source_type,
        record.carrier_name,
        record.line_type,
        record.ported_status,
        record.caller_name,
        record.entity_type,
        record.confidence_score,
      )
      .all();
  }

  private async snapshots(e164: string): Promise<SnapshotRow[]> {
    const result = await this.env.IDENTITY_DB.prepare(
      `SELECT phone_e164, looked_up_at, source_type, carrier_name, line_type, ported_status, caller_name, entity_type, confidence_score
       FROM identity_snapshot WHERE phone_e164 = ? ORDER BY looked_up_at ASC`,
    )
      .bind(e164)
      .all();
    return rowsOf<SnapshotRow>(result);
  }
}

function deskFor(env: Env, e164: string): IdentityDeskRpc {
  const id = env.IDENTITY.idFromName(digitsOfE164(e164));
  return env.IDENTITY.get(id) as unknown as IdentityDeskRpc;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Scripted demo: v1 -> v2 delta, redelivery dedupe, VoIP low-trust, staff query. */
async function runDemo(env: Env): Promise<Record<string, unknown>> {
  const mobile = "+15550101999";
  const voip = "+15550101998";
  const desk = deskFor(env, mobile);
  const first = await desk.onIntakeCaptured({
    phoneE164: mobile,
    capturedAt: "2025-06-02T09:00:05Z",
  });
  const second = await desk.onIntakeCaptured({
    phoneE164: mobile,
    capturedAt: "2025-06-04T10:00:05Z",
  });
  const replay = await desk.onIntakeCaptured({
    phoneE164: mobile,
    capturedAt: "2025-06-04T10:00:05Z",
  });
  const voipResult = await deskFor(env, voip).onIntakeCaptured({
    phoneE164: voip,
    capturedAt: "2025-06-05T11:00:00Z",
  });
  const ledger = await desk.identity(mobile);
  return { first, second, replay, voip: voipResult, ledger };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/intake") {
        const body = (await request.json().catch(() => ({}))) as IntakePayload;
        const e164 = normalizeE164(body.phoneE164);
        if (!e164) return json({ error: "phoneE164 must be a valid E.164 number" }, 400);
        const result = await deskFor(env, e164).onIntakeCaptured({
          phoneE164: e164,
          capturedAt: body.capturedAt,
        });
        return json(result, 200);
      }
      if (request.method === "GET" && url.pathname.startsWith("/identity/")) {
        const e164 = normalizeE164(decodeURIComponent(url.pathname.slice("/identity/".length)));
        if (!e164) return json({ error: "path must contain a valid E.164 number" }, 400);
        return json(await deskFor(env, e164).identity(e164), 200);
      }
      if (request.method === "POST" && url.pathname === "/demo/run") {
        return json(await runDemo(env), 200);
      }
      return json({ error: "not found" }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`[identity-desk] ${request.method} ${url.pathname} failed: ${message}`);
      return json({ error: "internal error" }, 500);
    }
  },
};
