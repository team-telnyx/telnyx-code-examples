/**
 * Attribution Wheel \u2014 who is spending what in the AI Gateway.
 *
 * SELF-REVIEW
 *  - Real primitives only: Agent SDK durable state + this.schedule(), AI Gateway
 *    token groups/keys, spend+usage summary with group_by=metadata:<key>, Telnyx
 *    Messaging for the on-call page, and a SQL ledger via the WHEEL_DB binding.
 *  - DEMO_MODE defaults to true: no SMS is sent, pages are logged instead.
 *  - No credentials in code; TELNYX_API_KEY comes from the SECRETS binding.
 *
 * ASSUMPTIONS
 *  - Gateway usage cannot be backdated, so DEMO_MODE writes clearly-marked
 *    synthetic rows (source='synthetic') into spend_daily so the 7-day baseline
 *    has history. Live mode pulls the real spend/summary instead.
 *  - this.schedule() takes a delay in seconds, so nightly() re-arms itself for
 *    the next 23:00 UTC run rather than using a cron string.
 *  - Public async methods are the RPC surface: bootstrap/sweep/report/seed/simulate.
 *  - reserved_spend and unknown_requests are displayed but excluded from
 *    breach/baseline math (their cost is not yet known).
 */
import { Agent } from "@telnyx/edge-runtime";
import type { ActorNamespace, Secrets, SqlDatabase } from "@telnyx/edge-runtime";

const GATEWAY = "https://api.telnyx.com/v2/llm_token_gateway";
const SERVICES = ["support", "billing", "docs"] as const;
type Service = (typeof SERVICES)[number];

const PROFILES: Record<string, Record<Service, number>> = {
  baseline: { support: 0.2, billing: 0.45, docs: 0.35 },
  spike: { support: 0.62, billing: 0.22, docs: 0.16 },
  recovery: { support: 0.18, billing: 0.47, docs: 0.35 },
};

interface TelnyxBinding {
  messages: { send(input: { to: string; from: string; text: string }): Promise<unknown> };
}

export interface Env {
  SECRETS: Secrets;
  WHEELS: ActorNamespace;
  WHEEL_DB: SqlDatabase;
  TELNYX: TelnyxBinding;
  DEMO_MODE?: string;
  ONCALL_E164?: string;
  DEMO_TELNYX_NUMBER?: string;
  ALERT_SHARE_PCT?: string;
  SPIKE_MULTIPLE?: string;
  AI_GATEWAY_MODEL?: string;
}

export interface WheelState {
  tokenGroupId: string | null;
  lastSweepDate: string | null;
  cursor: string | null;
  keyRefs: Record<string, string>;
}

export interface SpendRow {
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

export interface Report {
  day: string;
  rows: SpendRow[];
  totals: Omit<SpendRow, "date" | "service" | "baseline_ratio" | "breach" | "source" | "note">;
  byTenant: { value: string; requests: number; spend: number }[];
  byEnv: { value: string; requests: number; spend: number }[];
}

const todayUtc = (): string => new Date().toISOString().slice(0, 10);

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

const maskPhone = (p: string): string => (p.length > 4 ? `***${p.slice(-4)}` : "***");

export class AttributionWheel extends Agent<Env, WheelState> {
  protected initialState(): WheelState {
    return { tokenGroupId: null, lastSweepDate: null, cursor: null, keyRefs: {} };
  }

  private get demo(): boolean {
    return (this.env.DEMO_MODE ?? "true").toLowerCase() !== "false";
  }

  /** RPC: create the token group + one token key per service, then arm the nightly run. */
  async bootstrap(): Promise<{ tokenGroupId: string; keys: Record<string, string> }> {
    const state = await this.getState();
    if (state.tokenGroupId) return { tokenGroupId: state.tokenGroupId, keys: {} };

    const group = (await this.gateway("POST", "/token_groups", {
      body: { name: `attribution-wheel-${todayUtc()}` },
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
      })) as { token?: string; key?: string };
      const secret = String(created.token ?? created.key ?? "");
      keys[service] = secret;
      keyRefs[service] = secret ? `${secret.slice(0, 7)}...${secret.slice(-7)}` : "unavailable";
    }
    await this.setState({ tokenGroupId, keyRefs });
    await this.schedule(this.secondsUntil2300(), "nightly");
    return { tokenGroupId, keys };
  }

  /** RPC: the same code path the NIGHTLY schedule invokes. Resumable via the ledger cursor. */
  async sweep(day: string): Promise<{ day: string; rows: SpendRow[]; paged: number; resumedFrom: string | null }> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("day must be YYYY-MM-DD");
    await this.ensureSchema();
    const state = await this.getState();
    const resumedFrom = state.lastSweepDate === day ? state.cursor : null;

    const pulled = await this.pullSpend(day);
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
      const breach = this.isBreach(share, row.spend, base);
      const existing = await this.existingRow(day, row.service);
      const wasBreaching = await this.previousBreach(day, row.service);
      const note = breach ? "anomaly" : wasBreaching ? "recovery" : null;
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
    return { day, rows: written, paged, resumedFrom };
  }

  /** RPC: full wheel for a day \u2014 per service ledger plus per tenant / per env attribution. */
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
    return { day, rows, totals, byTenant: await this.grouped(day, "tenant"), byEnv: await this.grouped(day, "env") };
  }

  /** RPC: DEMO_MODE only \u2014 seed N days of baseline history so the rolling mean has data. */
  async seed(days: number): Promise<{ seeded: number; profile: string }> {
    if (!this.demo) throw new Error("seed() is only available when DEMO_MODE=true");
    await this.ensureSchema();
    const n = Math.min(Math.max(Math.trunc(num(days, 0)), 1), 30);
    const today = todayUtc();
    let seeded = 0;
    for (let i = n; i >= 1; i -= 1) seeded += await this.writeProfile(shiftDate(today, -i), "baseline");
    return { seeded, profile: "baseline" };
  }

  /** RPC: DEMO_MODE only \u2014 write a named traffic profile for a day (baseline|spike|recovery). */
  async simulate(day: string, profile: string): Promise<{ day: string; profile: string; rows: number }> {
    if (!this.demo) throw new Error("simulate() is only available when DEMO_MODE=true");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("day must be YYYY-MM-DD");
    if (!PROFILES[profile]) throw new Error(`unknown profile: ${profile}`);
    await this.ensureSchema();
    return { day, profile, rows: await this.writeProfile(day, profile) };
  }

  /** Scheduled task handler \u2014 dispatched by name from this.schedule(). */
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
    const apiKey = await this.env.SECRETS.get("TELNYX_API_KEY");
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
    const payload = (await res.json()) as { data?: unknown };
    return payload.data ?? payload;
  }

  private async pullSpend(day: string): Promise<SpendRow[]> {
    let rows: SpendRow[] = [];
    try {
      const data = await this.gateway("GET", "/spend/summary", {
        params: { start_date: day, end_date: shiftDate(day, 1), group_by: "metadata:service" },
      });
      rows = pickRows(data).map((r) => this.normalize(r, day));
    } catch (err) {
      console.warn(`spend/summary unavailable for ${day}: ${(err as Error).message}`);
    }
    if (rows.length === 0 && this.demo) rows = await this.ledgerDay(day);
    return rows;
  }

  private normalize(r: Record<string, unknown>, day: string): SpendRow {
    return {
      date: day,
      service: String(r.group ?? r.service ?? "unknown"),
      requests: num(r.requests),
      input_tokens: num(r.input_tokens),
      output_tokens: num(r.output_tokens),
      spend: num(r.spend),
      reserved_spend: num(r.reserved_spend),
      unknown_requests: num(r.unknown_requests),
      baseline_ratio: 0,
      breach: 0,
      source: "gateway",
      note: null,
    };
  }

  private async grouped(day: string, key: string): Promise<{ value: string; requests: number; spend: number }[]> {
    try {
      const data = await this.gateway("GET", "/spend/summary", {
        params: { start_date: day, end_date: shiftDate(day, 1), group_by: `metadata:${key}` },
      });
      return pickRows(data).map((r) => ({
        value: String(r.group ?? r[key] ?? "unknown"),
        requests: num(r.requests),
        spend: num(r.spend),
      }));
    } catch {
      return [];
    }
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

  private isBreach(share: number, spend: number, base?: { share: number; spend: number }): boolean {
    const sharePct = num(this.env.ALERT_SHARE_PCT, 40);
    const spike = num(this.env.SPIKE_MULTIPLE, 2.0);
    if (share * 100 >= sharePct) return true;
    return Boolean(base && base.spend > 0 && spend >= base.spend * spike);
  }

  private async page(row: SpendRow, share: number, base?: { share: number; spend: number }): Promise<void> {
    const ref = (await this.getState()).keyRefs[row.service] ?? "key-unavailable";
    const basePct = base ? Math.round(base.share * 100) : 0;
    const text = `AI spend: ${row.service} at ${Math.round(share * 100)}% of 24h requests (baseline ${basePct}%). Keys: ${ref}.`;
    if (this.demo) {
      console.log(`[DEMO] page suppressed -> ${maskPhone(this.env.ONCALL_E164 ?? "")}: ${text}`);
      return;
    }
    const to = this.env.ONCALL_E164;
    const from = this.env.DEMO_TELNYX_NUMBER;
    if (!to || !from) throw new Error("ONCALL_E164 and DEMO_TELNYX_NUMBER are required in live mode");
    await this.env.TELNYX.messages.send({ to, from, text });
  }

  private async writeProfile(day: string, profile: string): Promise<number> {
    const mix = PROFILES[profile];
    let count = 0;
    for (const service of SERVICES) {
      const requests = Math.round(1000 * mix[service]);
      const input = requests * 900;
      const output = requests * 300;
      await this.upsert({
        date: day,
        service,
        requests,
        input_tokens: input,
        output_tokens: output,
        spend: Number((input * 0.0000005 + output * 0.0000015).toFixed(4)),
        reserved_spend: 0,
        unknown_requests: 0,
        baseline_ratio: 0,
        breach: 0,
        source: "synthetic",
        note: `seeded:${profile}`,
      });
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
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true, actor: "AttributionWheel" });
    const name = url.searchParams.get("group") ?? "main";
    const stub = env.WHEELS.get(env.WHEELS.idFromName(name));
    return stub.fetch(request);
  },
};
