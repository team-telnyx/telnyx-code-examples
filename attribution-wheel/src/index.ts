/**
 * Attribution Wheel — who is spending what in the AI Gateway.
 *
 * SELF-REVIEW
 *  - Real primitives only: Agent SDK durable state + this.schedule(), @rpc() surface,
 *    AI Gateway token groups/keys, spend+usage summary with group_by=metadata:<key>,
 *    Telnyx Messaging for the on-call page, and a SQL ledger via the WHEEL_DB binding.
 *  - ATTRIBUTION_DEMO_MODE defaults to true: no SMS is sent, pages are logged instead.
 *  - No credentials in code; TELNYX_API_KEY comes from the SECRETS binding.
 *
 * ASSUMPTIONS
 *  - Gateway usage cannot be backdated, so ATTRIBUTION_DEMO_MODE=true writes clearly-marked
 *    synthetic rows (source='synthetic') into spend_daily so the 7-day baseline
 *    has history. Live mode pulls the real spend/summary instead.
 *  - this.schedule() takes a delay in seconds, so nightly() re-arms itself for
 *    the next 23:00 UTC run rather than using a cron string.
 *  - Remote surface is @rpc()-decorated: bootstrap/sweep/report/seed/simulate.
 *    nightly() is the scheduled handler and deliberately not @rpc().
 *  - reserved_spend and unknown_requests are displayed but excluded from
 *    breach/baseline math (their cost is not yet known).
 */
import {
  Agent,
  rpc,
  type ActorNamespace,
  type ActorStub,
  type Env as EdgeEnv,
  type IdFromNameOptions,
  type Secrets,
  type SqlDatabase,
} from "@telnyx/edge-runtime";
import { renderDashboard } from "./ui";

const GATEWAY = "https://api.telnyx.com/v2/llm_token_gateway";
const SERVICES = ["support", "billing", "docs"] as const;
type Service = (typeof SERVICES)[number];
export type RPCMethod = "bootstrap" | "sweep" | "report" | "seed" | "simulate" | "reset";
const RPC_METHODS: readonly RPCMethod[] = ["bootstrap", "sweep", "report", "seed", "simulate", "reset"];

const PROFILES: Record<string, Record<Service, number>> = {
  baseline: { support: 0.2, billing: 0.45, docs: 0.35 },
  spike: { support: 0.62, billing: 0.22, docs: 0.16 },
  recovery: { support: 0.18, billing: 0.47, docs: 0.35 },
};

const TENANT = "acme";
const ENV_TAG = "prod";

interface TelnyxBinding {
  messages: { send(input: { to: string; from: string; text: string }): Promise<unknown> };
}

export interface Env extends EdgeEnv {
  SECRETS: Secrets;
  WHEELS: WheelNamespace;
  WHEEL_DB: SqlDatabase;
  TELNYX: TelnyxBinding;
}

export interface WheelState extends Record<string, unknown> {
  tokenGroupId: string | null;
  lastSweepDate: string | null;
  cursor: string | null;
  keyRefs: Record<string, string>;
}

export interface SpendRow extends Record<string, unknown> {
  date: string;
  service: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  spend: number;
  reserved_spend: number;
  unknown_requests: number;
  baseline_ratio: number;
  breach: number;
  source: string;
  note: string | null;
}

export interface Grouped {
  value: string;
  requests: number;
  spend: number;
}

export interface UsageTotals extends Record<string, unknown> {
  requests: number;
  input_tokens: number;
  output_tokens: number;
  unknown_requests: number;
  cache_hits: number;
  succeeded_requests: number;
  failed_requests: number;
  partial_requests: number;
  spend: number;
  reserved_spend: number;
}

export interface UsageSnapshot {
  totals: UsageTotals;
  guardrails: { blocked_events: number; flagged_events: number };
}

export interface Report extends Record<string, unknown> {
  day: string;
  rows: SpendRow[];
  totals: Omit<SpendRow, "date" | "service" | "baseline_ratio" | "breach" | "source" | "note">;
  byTenant: Grouped[];
  byEnv: Grouped[];
  usage: UsageSnapshot | null;
}

const todayUtc = (): string => new Date().toISOString().slice(0, 10);

/**
 * Deterministic day-to-day variation for seeded profile rows (±8%), so the
 * synthetic baseline history looks like a real account: the same (day, service)
 * always jitters the same way, and a re-seed stays consistent.
 */
function dailyJitter(day: string, service: string): number {
  let h = 2166136261;
  const key = `${day}|${service}`;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const f = ((h >>> 0) % 1000) / 1000;
  return 0.92 + f * 0.16;
}

function shiftDate(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function toRows<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const r = res as { results?: T[] } | null | undefined;
  return r?.results ?? [];
}

function pickRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  const d = data as { rows?: unknown; data?: unknown } | null | undefined;
  if (Array.isArray(d?.rows)) return d!.rows as Record<string, unknown>[];
  if (Array.isArray(d?.data)) return d!.data as Record<string, unknown>[];
  return [];
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Normalize one spend/summary row into a SpendRow. The gateway groups by the
 * tag's text form, so the tag value arrives in `dimension_id` (null when the
 * requests carried no such tag); `name`/`group`/`service` are accepted as
 * fallbacks for local ledger rows and forward compatibility.
 */
export function normalizeSpendRow(raw: Record<string, unknown>, day: string): SpendRow {
  const rawService = raw.dimension_id ?? raw.name ?? raw.group ?? raw.service ?? "unknown";
  return {
    date: day,
    service: String(rawService),
    requests: num(raw.requests),
    input_tokens: num(raw.input_tokens),
    output_tokens: num(raw.output_tokens),
    spend: num(raw.spend),
    reserved_spend: num(raw.reserved_spend),
    unknown_requests: num(raw.unknown_requests),
    baseline_ratio: 0,
    breach: 0,
    source: "gateway",
    note: null,
  };
}

const maskPhone = (p: string): string => (p.length > 4 ? `***${p.slice(-4)}` : "***");
const maskKey = (secret: string): string => (secret.length > 14 ? `${secret.slice(0, 7)}...${secret.slice(-7)}` : "unavailable");

async function readConfig(env: Env, key: string): Promise<string | undefined> {
  const direct = (env as unknown as Record<string, unknown>)[key];
  if (typeof direct === "string" && direct.length > 0) return direct;
  try {
    const v = await env.SECRETS.get(key);
    return v || undefined;
  } catch {
    return undefined;
  }
}

type WheelStub = ActorStub & Pick<AttributionWheel, RPCMethod>;
interface WheelNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): WheelStub;
}

export class AttributionWheel extends Agent<Env, WheelState> {
  protected initialState(): WheelState {
    return { tokenGroupId: null, lastSweepDate: null, cursor: null, keyRefs: {} };
  }

  private async demoMode(): Promise<boolean> {
    return ((await readConfig(this.env, "ATTRIBUTION_DEMO_MODE")) ?? "true").trim().toLowerCase() !== "false";
  }

  /** RPC: create the token group + one token key per service, then arm the nightly run. */
  @rpc()
  async bootstrap(): Promise<{ tokenGroupId: string; keys: Record<string, string> }> {
    const state = await this.getState();
    if (state.tokenGroupId) return { tokenGroupId: state.tokenGroupId, keys: {} };

    const model = (await readConfig(this.env, "AI_GATEWAY_MODEL")) ?? "Kimi-K3";
    const group = (await this.gateway("POST", "/token_groups", {
      body: { name: `attribution-wheel-${todayUtc()}`, allowed_models: [model] },
      idempotencyKey: `attribution-wheel:group:${todayUtc()}`,
    })) as { id?: string };
    const tokenGroupId = String(group.id ?? "");
    if (!tokenGroupId) throw new Error("token group create returned no id");

    const keys: Record<string, string> = {};
    const keyRefs: Record<string, string> = {};
    for (const service of SERVICES) {
      const created = (await this.gateway("POST", "/token_keys", {
        body: { token_group_id: tokenGroupId, name: service },
        idempotencyKey: `attribution-wheel:key:${service}`,
      })) as { token?: string; key?: string; id?: string };
      const secret = String(created.token ?? created.key ?? "");
      keys[service] = secret;
      keyRefs[service] = secret ? maskKey(secret) : String(created.id ?? "unavailable");
    }
    await this.setState({ tokenGroupId, keyRefs });
    await this.schedule(this.secondsUntil2300(), "nightly");
    return { tokenGroupId, keys };
  }

  /** RPC: the same code path the NIGHTLY schedule invokes. Resumable via the ledger cursor. */
  @rpc()
  async sweep(
    day: string,
  ): Promise<{
    day: string;
    rows: SpendRow[];
    paged: number;
    resumedFrom: string | null;
    usage: UsageSnapshot | null;
    spendError: string | null;
  }> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("day must be YYYY-MM-DD");
    await this.ensureSchema();
    const state = await this.getState();
    const resumedFrom = state.lastSweepDate === day ? state.cursor : null;

    const { rows: pulled, error: spendError } = await this.pullSpend(day);
    const baseline = await this.loadBaseline(day);
    const totalRequests = pulled.reduce((s, r) => s + r.requests, 0);
    const ordered = [...pulled].sort((a, b) => a.service.localeCompare(b.service));
    const startAt = resumedFrom ? Math.max(0, ordered.findIndex((r) => r.service === resumedFrom) + 1) : 0;

    const written: SpendRow[] = [];
    let paged = 0;
    for (const row of ordered.slice(startAt)) {
      const base = baseline.get(row.service);
      const share = totalRequests > 0 ? row.requests / totalRequests : 0;
      const ratio = base && base.share > 0 ? share / base.share : 0;
      const breach = await this.isBreach(share, row.spend, base);
      const existing = await this.existingRow(day, row.service);
      const wasBreaching = await this.previousBreach(day, row.service);
      const note = breach ? (wasBreaching ? "continued" : "anomaly") : wasBreaching ? "recovery" : null;
      const finalRow: SpendRow = {
        ...row,
        baseline_ratio: Number(ratio.toFixed(2)),
        breach: breach ? 1 : 0,
        note,
      };
      await this.upsert(finalRow);
      written.push(finalRow);
      if (breach && !existing?.breach && !wasBreaching) {
        await this.page(finalRow, share, base);
        paged += 1;
      }
      await this.setState({ lastSweepDate: day, cursor: row.service });
    }
    await this.setState({ lastSweepDate: day, cursor: null });
    const usage = await this.pullUsage(day);
    return { day, rows: written, paged, resumedFrom, usage, spendError };
  }

  /** RPC: full wheel for a day — per service ledger plus per tenant / per env attribution. */
  @rpc()
  async report(day: string): Promise<Report> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("day must be YYYY-MM-DD");
    await this.ensureSchema();
    const rows = await this.ledgerDay(day);
    const totals = rows.reduce(
      (acc, r) => ({
        requests: acc.requests + r.requests,
        input_tokens: acc.input_tokens + r.input_tokens,
        output_tokens: acc.output_tokens + r.output_tokens,
        spend: Number((acc.spend + r.spend).toFixed(6)),
        reserved_spend: Number((acc.reserved_spend + r.reserved_spend).toFixed(6)),
        unknown_requests: acc.unknown_requests + r.unknown_requests,
      }),
      { requests: 0, input_tokens: 0, output_tokens: 0, spend: 0, reserved_spend: 0, unknown_requests: 0 },
    );
    return {
      day,
      rows,
      totals,
      byTenant: await this.grouped(day, "tenant"),
      byEnv: await this.grouped(day, "env"),
      usage: await this.pullUsage(day),
    };
  }

  /** RPC: DEMO_MODE only — seed N days of baseline history so the rolling mean has data. */
  @rpc()
  async seed(days: number): Promise<{ seeded: number; profile: string }> {
    if (!(await this.demoMode())) throw new Error("seed() is only available when ATTRIBUTION_DEMO_MODE=true");
    await this.ensureSchema();
    const n = Math.min(Math.max(Math.trunc(num(days, 0)), 1), 30);
    const today = todayUtc();
    let seeded = 0;
    for (let i = n; i >= 1; i -= 1) seeded += await this.writeProfile(shiftDate(today, -i), "baseline");
    return { seeded, profile: "baseline" };
  }

  /** RPC: DEMO_MODE only — write a named traffic profile for a day (baseline|spike|recovery). */
  @rpc()
  async simulate(day: string, profile: string): Promise<{ day: string; profile: string; rows: number }> {
    if (!(await this.demoMode())) throw new Error("simulate() is only available when ATTRIBUTION_DEMO_MODE=true");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("day must be YYYY-MM-DD");
    if (!PROFILES[profile]) throw new Error(`unknown profile: ${profile}`);
    await this.ensureSchema();
    return { day, profile, rows: await this.writeProfile(day, profile) };
  }

  /** RPC: ATTRIBUTION_DEMO_MODE only — clear the ledger + cursor so the Day-1/Day-2 demo can re-run. */
  @rpc()
  async reset(): Promise<{ cleared: boolean }> {
    if (!(await this.demoMode())) throw new Error("reset() is only available when ATTRIBUTION_DEMO_MODE=true");
    await this.ensureSchema();
    await this.env.WHEEL_DB.exec("DELETE FROM spend_daily");
    await this.env.WHEEL_DB.exec("DELETE FROM spend_dims");
    await this.setState({ lastSweepDate: null, cursor: null });
    return { cleared: true };
  }

  /** Scheduled task handler — dispatched by name from this.schedule(). */
  async nightly(): Promise<void> {
    try {
      await this.sweep(shiftDate(todayUtc(), -1));
    } finally {
      await this.schedule(this.secondsUntil2300(), "nightly");
    }
  }

  private secondsUntil2300(): number {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 0, 0));
    if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
    return Math.max(60, Math.round((next.getTime() - now.getTime()) / 1000));
  }

  private async gateway(
    method: "GET" | "POST",
    path: string,
    opts: { body?: unknown; params?: Record<string, string>; idempotencyKey?: string } = {},
  ): Promise<unknown> {
    const envelope = await this.gatewayEnvelope(method, path, opts);
    const payload = envelope as { data?: unknown };
    return payload?.data ?? payload;
  }

  /** Like gateway() but keeps the response envelope (data + meta) for paginated reports. */
  private async gatewayEnvelope(
    method: "GET" | "POST",
    path: string,
    opts: { body?: unknown; params?: Record<string, string>; idempotencyKey?: string } = {},
  ): Promise<unknown> {
    const apiKey = await readConfig(this.env, "TELNYX_API_KEY");
    if (!apiKey) throw new Error("TELNYX_API_KEY is not configured");
    const url = new URL(`${GATEWAY}${path}`);
    for (const [k, v] of Object.entries(opts.params ?? {})) url.searchParams.set(k, v);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    const res = await fetch(url.toString(), {
      method,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) throw new Error(`AI Gateway ${method} ${path} failed with ${res.status}`);
    return res.json();
  }

  /** Paged spend/summary fetch; stops on has_more=false or a safety bound. */
  private async spendSummary(day: string, groupBy: string): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    let pageNumber = 1;
    for (;;) {
      const envelope = (await this.gatewayEnvelope("GET", "/spend/summary", {
        params: {
          start_date: day,
          end_date: shiftDate(day, 1),
          group_by: groupBy,
          "page[size]": "100",
          "page[number]": String(pageNumber),
        },
      })) as { data?: unknown; meta?: { has_more?: boolean } };
      const rows = pickRows(envelope?.data ?? envelope);
      out.push(...rows);
      if (envelope?.meta?.has_more !== true || rows.length === 0) break;
      pageNumber += 1;
      if (pageNumber > 10) break;
    }
    return out;
  }

  /**
   * Pull the day's spend rows from the gateway, falling back to the local ledger
   * in demo mode. The gateway error (if any) is returned alongside the rows so
   * sweeps surface gateway failures instead of silently zeroing.
   */
  private async pullSpend(day: string): Promise<{ rows: SpendRow[]; error: string | null }> {
    try {
      const rows = (await this.spendSummary(day, "metadata:service")).map((r) => normalizeSpendRow(r, day));
      if (rows.length === 0 && (await this.demoMode())) return { rows: await this.ledgerDay(day), error: null };
      return { rows, error: null };
    } catch (err) {
      const msg = (err as Error).message;
      console.warn(`spend/summary unavailable for ${day}: ${msg}`);
      const rows = (await this.demoMode()) ? await this.ledgerDay(day) : [];
      return { rows, error: msg };
    }
  }

  /** Gateway usage/summary totals + guardrail counts for the token group (null when unavailable). */
  private async pullUsage(day: string): Promise<UsageSnapshot | null> {
    const tokenGroupId = (await this.getState()).tokenGroupId;
    if (!tokenGroupId) return null;
    try {
      const data = (await this.gateway("GET", "/usage/summary", {
        params: { token_group_id: tokenGroupId, start_date: day, end_date: shiftDate(day, 1) },
      })) as { totals?: Record<string, unknown>; guardrails?: Record<string, unknown> } | null;
      if (!data?.totals) return null;
      const t = data.totals;
      const g = data.guardrails ?? {};
      return {
        totals: {
          requests: num(t.requests),
          input_tokens: num(t.input_tokens),
          output_tokens: num(t.output_tokens),
          unknown_requests: num(t.unknown_requests),
          cache_hits: num(t.cache_hits),
          succeeded_requests: num(t.succeeded_requests),
          failed_requests: num(t.failed_requests),
          partial_requests: num(t.partial_requests),
          spend: num(t.spend),
          reserved_spend: num(t.reserved_spend),
        },
        guardrails: { blocked_events: num(g.blocked_events), flagged_events: num(g.flagged_events) },
      };
    } catch {
      return null;
    }
  }

  private async grouped(day: string, key: string): Promise<Grouped[]> {
    try {
      const rows = await this.spendSummary(day, `metadata:${key}`);
      const out = rows.map((r) => ({
        value: String(r.dimension_id ?? r.name ?? r[key] ?? "unknown"),
        requests: num(r.requests),
        spend: num(r.spend),
      }));
      if (out.length > 0) return out;
    } catch {
      // gateway unavailable — fall back to the local dims ledger below
    }
    return this.dimsFor(day, key);
  }

  private async loadBaseline(day: string): Promise<Map<string, { share: number; spend: number }>> {
    const res = await this.env.WHEEL_DB.prepare(
      "SELECT date, service, requests, spend FROM spend_daily WHERE date >= ? AND date < ?",
    )
      .bind(shiftDate(day, -7), day)
      .all();
    const rows = toRows<{ date: string; service: string; requests: number; spend: number }>(res);
    const dayTotals = new Map<string, number>();
    for (const r of rows) dayTotals.set(r.date, (dayTotals.get(r.date) ?? 0) + num(r.requests));
    const acc = new Map<string, { share: number; spend: number; days: number }>();
    for (const r of rows) {
      const total = dayTotals.get(r.date) ?? 0;
      if (total <= 0) continue;
      const cur = acc.get(r.service) ?? { share: 0, spend: 0, days: 0 };
      cur.share += num(r.requests) / total;
      cur.spend += num(r.spend);
      cur.days += 1;
      acc.set(r.service, cur);
    }
    const out = new Map<string, { share: number; spend: number }>();
    for (const [service, v] of acc) {
      if (v.days > 0) out.set(service, { share: v.share / v.days, spend: v.spend / v.days });
    }
    return out;
  }

  private async isBreach(share: number, spend: number, base?: { share: number; spend: number }): Promise<boolean> {
    const sharePct = num(await readConfig(this.env, "ATTRIBUTION_ALERT_SHARE_PCT"), 40);
    const spike = num(await readConfig(this.env, "ATTRIBUTION_SPIKE_MULTIPLE"), 2.0);
    const shareJump = (share - (base?.share ?? 0)) * 100;
    if (shareJump >= sharePct) return true;
    return Boolean(base && base.spend > 0 && spend >= base.spend * spike);
  }

  private async page(row: SpendRow, share: number, base?: { share: number; spend: number }): Promise<void> {
    const ref = (await this.getState()).keyRefs[row.service] ?? "key-unavailable";
    const basePct = base ? Math.round(base.share * 100) : 0;
    const text = `AI spend: ${row.service} at ${Math.round(share * 100)}% of 24h requests (baseline ${basePct}%). Keys: ${ref}.`;
    if (await this.demoMode()) {
      console.log(`[DEMO] page suppressed -> ${maskPhone((await readConfig(this.env, "ATTRIBUTION_ONCALL_E164")) ?? "")}: ${text}`);
      return;
    }
    const to = await readConfig(this.env, "ATTRIBUTION_ONCALL_E164");
    const from = await readConfig(this.env, "ATTRIBUTION_DEMO_NUMBER");
    if (!to || !from) throw new Error("ONCALL_E164 and DEMO_TELNYX_NUMBER are required in live mode");
    await this.env.TELNYX.messages.send({ to, from, text });
  }

  private async writeProfile(day: string, profile: string): Promise<number> {
    const mix = PROFILES[profile];
    let count = 0;
    await this.env.WHEEL_DB.prepare("DELETE FROM spend_dims WHERE date = ? AND dim IN ('tenant','env')").bind(day).run();
    for (const service of SERVICES) {
      const requests = Math.round(1000 * mix[service] * dailyJitter(day, service));
      const input = requests * 900;
      const output = requests * 300;
      const spend = Number((input * 0.0000005 + output * 0.0000015).toFixed(4));
      await this.upsert({
        date: day,
        service,
        requests,
        input_tokens: input,
        output_tokens: output,
        spend,
        reserved_spend: 0,
        unknown_requests: 0,
        baseline_ratio: 0,
        breach: 0,
        source: "synthetic",
        note: `seeded:${profile}`,
      });
      await this.upsertDim(day, "tenant", TENANT, requests, spend);
      await this.upsertDim(day, "env", ENV_TAG, requests, spend);
      count += 1;
    }
    return count;
  }

  private async ledgerDay(day: string): Promise<SpendRow[]> {
    const res = await this.env.WHEEL_DB.prepare(
      "SELECT date, service, requests, input_tokens, output_tokens, spend, reserved_spend, unknown_requests, baseline_ratio, breach, source, note FROM spend_daily WHERE date = ? ORDER BY service",
    )
      .bind(day)
      .all();
    return toRows<SpendRow>(res);
  }

  private async dimsFor(day: string, dim: string): Promise<Grouped[]> {
    const res = await this.env.WHEEL_DB.prepare(
      "SELECT value, requests, spend FROM spend_dims WHERE date = ? AND dim = ? ORDER BY spend DESC",
    )
      .bind(day, dim)
      .all();
    return toRows<Grouped>(res);
  }

  private async existingRow(day: string, service: string): Promise<SpendRow | null> {
    const res = await this.env.WHEEL_DB.prepare(
      "SELECT date, service, requests, input_tokens, output_tokens, spend, reserved_spend, unknown_requests, baseline_ratio, breach, source, note FROM spend_daily WHERE date = ? AND service = ?",
    )
      .bind(day, service)
      .all();
    return toRows<SpendRow>(res)[0] ?? null;
  }

  private async previousBreach(day: string, service: string): Promise<boolean> {
    const res = await this.env.WHEEL_DB.prepare(
      "SELECT breach FROM spend_daily WHERE service = ? AND date < ? ORDER BY date DESC LIMIT 1",
    )
      .bind(service, day)
      .all();
    const rows = toRows<{ breach: number }>(res);
    return rows.length > 0 && num(rows[0].breach) === 1;
  }

  private async upsert(row: SpendRow): Promise<void> {
    await this.env.WHEEL_DB.prepare(
      `INSERT INTO spend_daily (date, service, requests, input_tokens, output_tokens, spend, reserved_spend, unknown_requests, baseline_ratio, breach, source, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(date, service) DO UPDATE SET
         requests = excluded.requests,
         input_tokens = excluded.input_tokens,
         output_tokens = excluded.output_tokens,
         spend = excluded.spend,
         reserved_spend = excluded.reserved_spend,
         unknown_requests = excluded.unknown_requests,
         baseline_ratio = excluded.baseline_ratio,
         breach = excluded.breach,
         source = excluded.source,
         note = excluded.note`,
    )
      .bind(
        row.date,
        row.service,
        row.requests,
        row.input_tokens,
        row.output_tokens,
        row.spend,
        row.reserved_spend,
        row.unknown_requests,
        row.baseline_ratio,
        row.breach,
        row.source,
        row.note,
      )
      .run();
  }

  private async upsertDim(day: string, dim: string, value: string, requests: number, spend: number): Promise<void> {
    await this.env.WHEEL_DB.prepare(
      `INSERT INTO spend_dims (date, dim, value, requests, spend)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(date, dim, value) DO UPDATE SET
         requests = spend_dims.requests + excluded.requests,
         spend = spend_dims.spend + excluded.spend`,
    )
      .bind(day, dim, value, requests, spend)
      .run();
  }

  private async ensureSchema(): Promise<void> {
    await this.env.WHEEL_DB.exec(
      `CREATE TABLE IF NOT EXISTS spend_daily (
         date TEXT NOT NULL,
         service TEXT NOT NULL,
         requests INTEGER NOT NULL DEFAULT 0,
         input_tokens INTEGER NOT NULL DEFAULT 0,
         output_tokens INTEGER NOT NULL DEFAULT 0,
         spend REAL NOT NULL DEFAULT 0,
         reserved_spend REAL NOT NULL DEFAULT 0,
         unknown_requests INTEGER NOT NULL DEFAULT 0,
         baseline_ratio REAL NOT NULL DEFAULT 0,
         breach INTEGER NOT NULL DEFAULT 0,
         source TEXT NOT NULL DEFAULT 'gateway',
         note TEXT,
         PRIMARY KEY (date, service)
       )`,
    );
    await this.env.WHEEL_DB.exec(
      `CREATE TABLE IF NOT EXISTS spend_dims (
         date TEXT NOT NULL,
         dim TEXT NOT NULL,
         value TEXT NOT NULL,
         requests INTEGER NOT NULL DEFAULT 0,
         spend REAL NOT NULL DEFAULT 0,
         PRIMARY KEY (date, dim, value)
       )`,
    );
  }
}

const json = (v: unknown, status = 200): Response =>
  new Response(JSON.stringify(v, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });

const httpStatusFor = (err: unknown): number => {
  const msg = err instanceof Error ? err.message : String(err);
  return /day must be|ATTRIBUTION_DEMO_MODE|unknown profile/.test(msg) ? 400 : 500;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const group = url.searchParams.get("group") ?? "main";

    if (path === "/health") {
      const demo = ((await readConfig(env, "ATTRIBUTION_DEMO_MODE")) ?? "true").trim().toLowerCase() !== "false";
      return json({ ok: true, actor: "AttributionWheel", group, demo_mode: demo });
    }

    const stub = env.WHEELS.idFromName(group);

    const rpcMatch = path.match(/^\/rpc\/([A-Za-z][A-Za-z0-9_]*)$/);
    if (rpcMatch) {
      const method = rpcMatch[1];
      if (request.method !== "POST") {
        return json({ error: `Use POST /rpc/${method} with a JSON array body of positional arguments.` }, 405);
      }
      if (!(RPC_METHODS as readonly string[]).includes(method)) {
        return json({ error: `Unknown RPC method "${method}". RPC surface: ${RPC_METHODS.join(", ")}.` }, 404);
      }
      let args: unknown[] = [];
      try {
        const text = request.body ? await request.text() : "";
        if (text.trim().length > 0) {
          const parsed: unknown = JSON.parse(text);
          if (!Array.isArray(parsed)) throw new Error("RPC body must be a JSON array of positional arguments.");
          args = parsed;
        }
      } catch (err) {
        if (err instanceof Error && /JSON array|JSON.parse/.test(err.message) === false) {
          return json({ error: err.message }, 400);
        }
        return json({ error: "RPC body must be valid JSON (an array of positional arguments)." }, 400);
      }
      try {
        switch (method as RPCMethod) {
          case "bootstrap":
            return json(await stub.bootstrap());
          case "sweep":
            return json(await stub.sweep(String(args[0] ?? todayUtc())));
          case "report":
            return json(await stub.report(String(args[0] ?? todayUtc())));
          case "seed":
            return json(await stub.seed(Number(args[0] ?? 7)));
          case "simulate":
            return json(await stub.simulate(String(args[0] ?? todayUtc()), String(args[1] ?? "baseline")));
          case "reset":
            return json(await stub.reset());
        }
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : "RPC failed" }, httpStatusFor(err));
      }
    }

    if (path === "/report") {
      const day = url.searchParams.get("day") ?? todayUtc();
      try {
        return json(await stub.report(day));
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : "report failed" }, httpStatusFor(err));
      }
    }

    if (path === "/" || path === "/ui") {
      const day = url.searchParams.get("day") ?? todayUtc();
      let report: Report | null = null;
      let error: string | null = null;
      try {
        report = await stub.report(day);
      } catch (err) {
        error = err instanceof Error ? err.message : "report failed";
      }
      const demo = ((await readConfig(env, "ATTRIBUTION_DEMO_MODE")) ?? "true").trim().toLowerCase() !== "false";
      return new Response(renderDashboard({ day, group, demo, report, error }), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }

    return json(
      { error: "Not found. Routes: GET / (dashboard), GET /health, GET /report?day=YYYY-MM-DD, POST /rpc/<method>." },
      404,
    );
  },
};
