// Multi-Tenant AI Spend Ledger (Linear DEV-1227).
//
// One SpendLedger actor per tenant (env.LEDGERS.idFromName(tenantId)). The actor
// provisions a Telnyx AI Gateway token group (budget + guardrails) and a token
// key, runs an hourly durable rollup of gateway usage + guardrail findings into
// per-actor SQL, warns the admin by SMS at 80% of budget, and flips read-only
// at 100% — the gateway itself denies requests past the budget with 403
// budget_exceeded.
//
// Verified against the AI Gateway management API (developers.telnyx.com/docs/
// inference/ai-gateway/management-api):
//   - every POST/PATCH/DELETE requires an Idempotency-Key header
//   - PATCH/DELETE require the resource version as `If-Match`
//   - success bodies wrap the resource in `data`
//   - token keys are created at flat `POST /token_keys` with `token_group_id`
//     in the body; the one-time secret is returned as `data.token`
//   - usage summary exposes `data.totals` / `data.by_day` / `data.by_model` /
//     `data.guardrails.{blocked_events,flagged_events,recent_events}`
//   - the inference plane is a constant base URL (https://llm.telnyx.com/v1)
//     authenticated by the token key — not a per-group URL

import {
  Agent,
  rpc,
  type ActorNamespace,
  type ActorStub,
  type Secrets,
} from "@telnyx/edge-runtime";

const GATEWAY_MANAGEMENT_BASE = "https://api.telnyx.com/v2/llm_token_gateway";
export const INFERENCE_BASE_URL = "https://llm.telnyx.com/v1";

const DEFAULT_ROLLUP_INTERVAL_SECONDS = 3600;
const ROLLUP_SCHEDULE_ID = "hourly-rollup";
const MAX_USABLE_LOOKBACK_DAYS = 30;

export const DEFAULT_ALLOWED_MODELS = [
  "Kimi-K2.6",
  "Meta-Llama-3.1-8B-Instruct",
];

export const GUARDRAILS_POLICY = {
  secrets: { prompt: "block", response: "block" },
  dlp: { profiles: ["financial"], prompt: "flag", response: "flag" },
  streaming: "buffered",
} as const;

export type TokenGroup = {
  id: string;
  name: string;
  blocked: boolean;
  allowed_models: string[];
  max_budget: number | null;
  budget_duration: "1d" | "7d" | "30d" | null;
  version: number;
  spend: number;
  reserved_spend: number;
  budget_started_at: string | null;
  resets_at: string | null;
};

export type TokenKey = {
  id: string;
  token_group_id: string;
  token: string;
};

export type UsageMetricRow = {
  requests?: number;
  input_tokens?: number;
  output_tokens?: number;
  spend?: number;
};

export type UsageSummary = {
  totals: UsageMetricRow;
  by_day: (UsageMetricRow & { date: string })[];
  by_model: (UsageMetricRow & { model: string })[];
  guardrails: {
    blocked_events: number;
    flagged_events: number;
    recent_events?: GatewayGuardrailEvent[];
  };
};

export type GatewayGuardrailEvent = {
  id: string;
  created_at?: string;
  stage?: string;
  outcome?: string;
  findings?: { detector?: string; code?: string; count?: number }[];
};

export type FindingRow = {
  day: string;
  stage: string;
  outcome: string;
  detector: string;
  code: string;
  count: number;
};

export type SpendView = {
  tenantId: string;
  monthToDate: number;
  budget: number;
  pct: number;
  byModel: Record<string, { spend: number; inputTokens: number; outputTokens: number }>;
  guardrails: { blocked: number; flagged: number; findings: FindingRow[] };
  alerts: { level: string; at: string }[];
  readOnly: boolean;
  budgetPeriod: { startedAt: string | null; resetsAt: string | null };
  lastRollupAt: string | null;
  lastRollupError: string | null;
  rollupDebug: RollupDebug | null;
  lastSms: { to: string; at: string; body: string } | null;
};

export type AdjustResult = {
  ok: boolean;
  maxBudget: number;
  groupVersion: number;
  audit: { at: string; from: number; to: number }[];
};

export type LedgerState = {
  tenantId: string;
  tokenGroupId: string | null;
  tokenKeyId: string | null;
  tokenKeySecret: string | null;
  monthlyBudget: number;
  budgetStartedAt: string | null;
  resetsAt: string | null;
  alerted80: boolean;
  alerted100: boolean;
  readOnly: boolean;
  lastRollupAt: string | null;
  lastRollupError: string | null;
  rollupDebug: RollupDebug | null;
  lastSms: { to: string; at: string; body: string } | null;
  budgetAudit: { at: string; from: number; to: number }[];
  createdAt: string;
};

export type RollupDebug = {
  at: string;
  step: string;
  intervalSeconds: number;
  envRaw: string | null;
  envProp: string | null;
  procEnv: string | null;
  error: string | null;
};

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class GatewayError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export class GatewayClient {
  constructor(
    private apiKey: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(
    method: "POST" | "PATCH" | "GET" | "DELETE",
    path: string,
    options: { body?: unknown; ifMatch?: number } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (method !== "GET") {
      headers["Content-Type"] = "application/json";
      headers["Idempotency-Key"] = crypto.randomUUID();
    }
    if (options.ifMatch !== undefined) {
      headers["If-Match"] = `"${options.ifMatch}"`;
    }
    const res = await this.fetchImpl(`${GATEWAY_MANAGEMENT_BASE}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as {
      data?: T;
      errors?: { code?: string; title?: string; detail?: string }[];
    } | null;
    if (!res.ok || json === null) {
      const err = json?.errors?.[0];
      throw new GatewayError(
        res.status,
        err?.code ?? "gateway_error",
        err?.detail ?? err?.title ?? `Gateway request failed (HTTP ${res.status})`,
      );
    }
    return json.data as T;
  }

  createTokenGroup(
    name: string,
    allowedModels: string[],
    maxBudget: number,
  ): Promise<TokenGroup> {
    return this.request<TokenGroup>("POST", "/token_groups", {
      body: {
        name,
        allowed_models: allowedModels,
        max_budget: maxBudget,
        budget_duration: "30d",
        guardrails: GUARDRAILS_POLICY,
      },
    });
  }

  createTokenKey(name: string, tokenGroupId: string): Promise<TokenKey> {
    return this.request<TokenKey>("POST", "/token_keys", {
      body: { name, token_group_id: tokenGroupId },
    });
  }

  getTokenGroup(id: string): Promise<TokenGroup> {
    return this.request<TokenGroup>("GET", `/token_groups/${encodeURIComponent(id)}`);
  }

  patchTokenGroup(
    id: string,
    version: number,
    patch: Partial<Pick<TokenGroup, "max_budget" | "blocked">>,
  ): Promise<TokenGroup> {
    return this.request<TokenGroup>("PATCH", `/token_groups/${encodeURIComponent(id)}`, {
      body: patch,
      ifMatch: version,
    });
  }

  usageSummary(
    tokenGroupId: string,
    startDate: string,
    endDate: string,
  ): Promise<UsageSummary> {
    const q = new URLSearchParams({
      token_group_id: tokenGroupId,
      start_date: startDate,
      end_date: endDate,
    });
    return this.request<UsageSummary>("GET", `/usage/summary?${q.toString()}`);
  }

  guardrailEvents(
    tokenGroupId: string,
    startDate: string,
    endDate: string,
  ): Promise<GatewayGuardrailEvent[]> {
    const q = new URLSearchParams({
      token_group_id: tokenGroupId,
      start_date: startDate,
      end_date: endDate,
    });
    return this.request<GatewayGuardrailEvent[]>(
      "GET",
      `/guardrail_events?${q.toString()}`,
    );
  }
}

export function pctOf(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return Math.min(100, Math.round((part / whole) * 100));
}

/** Rollup cadence in seconds from ROLLUP_INTERVAL_SECONDS (default hourly; clamped 30s..1d). */
export function rollupIntervalSeconds(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return DEFAULT_ROLLUP_INTERVAL_SECONDS;
  return Math.min(86_400, Math.max(30, n));
}

export function dayOf(iso: string | null | undefined): string {
  if (!iso) return new Date().toISOString().slice(0, 10);
  return iso.slice(0, 10);
}

/** Findings carry detector codes and counts only — never matched text. */
export function toFindingRows(
  events: GatewayGuardrailEvent[],
  maxRows = 50,
): FindingRow[] {
  const rows: FindingRow[] = [];
  for (const event of events) {
    const day = dayOf(event.created_at);
    const stage = event.stage ?? "unknown";
    const outcome = event.outcome ?? "unknown";
    for (const finding of event.findings ?? []) {
      if (!finding.detector || !finding.code) continue;
      rows.push({
        day,
        stage,
        outcome,
        detector: finding.detector,
        code: finding.code,
        count: finding.count ?? 1,
      });
    }
  }
  return rows.slice(0, maxRows);
}

/** Month-to-date window: the budget period start through tomorrow (exclusive end). */
export function summaryWindow(
  budgetStartedAt: string | null,
  today = new Date(),
): { startDate: string; endDate: string } {
  const endDate = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  let startMs = today.getTime();
  if (budgetStartedAt) {
    const parsed = Date.parse(budgetStartedAt);
    if (!Number.isNaN(parsed)) startMs = Math.min(startMs, parsed);
  }
  const earliest = today.getTime() - MAX_USABLE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const startDate = new Date(Math.max(startMs, earliest));
  return {
    startDate: startDate.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10),
  };
}

export function validateProvisionInput(
  tenantId: unknown,
  monthlyBudget: unknown,
): { tenantId: string; monthlyBudget: number } {
  if (typeof tenantId !== "string" || !tenantId.trim() || tenantId.length > 128) {
    throw new ValidationError("tenantId must be a non-empty string of at most 128 characters");
  }
  if (
    typeof monthlyBudget !== "number" ||
    !Number.isFinite(monthlyBudget) ||
    monthlyBudget <= 0 ||
    monthlyBudget > 10_000_000
  ) {
    throw new ValidationError("monthlyBudget must be a number between 0 (exclusive) and 10,000,000");
  }
  return { tenantId: tenantId.trim(), monthlyBudget };
}

export interface Env {
  LEDGERS: LedgerNamespace;
  TELNYX: {
    messages: {
      send(params: { to: string; from: string; text: string }): Promise<unknown>;
    };
  };
  SECRETS: Secrets;
  ADMIN_SMS_FROM: string;
  ADMIN_SMS_TO: string;
  ALLOWED_MODELS?: string;
  ROLLUP_INTERVAL_SECONDS?: string;
  WARN_PCT?: string;
  HARD_PCT?: string;
}

export class SpendLedger extends Agent<Env, LedgerState> {
  // Alarm reminders use second precision. Keep SDK deadlines on that boundary
  // so an early, rounded reminder cannot arrive before its task is due
  // (same fix as edge-cron-scheduler).
  protected override now(): number {
    return Math.floor(Date.now() / 1000) * 1000;
  }

  protected override initialState(): LedgerState {
    return {
      tenantId: "",
      tokenGroupId: null,
      tokenKeyId: null,
      tokenKeySecret: null,
      monthlyBudget: 0,
      budgetStartedAt: null,
      resetsAt: null,
      alerted80: false,
      alerted100: false,
      readOnly: false,
      lastRollupAt: null,
      lastRollupError: null,
      rollupDebug: null,
      lastSms: null,
      budgetAudit: [],
      createdAt: new Date().toISOString(),
    };
  }

  private async client(): Promise<GatewayClient> {
    return new GatewayClient(await this.setting("TELNYX_API_KEY"));
  }

  private setting(key: string): Promise<string> {
    return this.env.SECRETS.get(key);
  }

  private async envSetting(key: "ALLOWED_MODELS" | "ROLLUP_INTERVAL_SECONDS" | "WARN_PCT" | "HARD_PCT" | "ADMIN_SMS_FROM" | "ADMIN_SMS_TO"): Promise<string | undefined> {
    // Edge env vars arrive via this.env when present; fall back to process.env,
    // then to the secrets binding (the one mechanism that reliably reaches actors).
    const direct = this.env[key] ?? process.env?.[key];
    if (direct !== undefined) return direct;
    try {
      return await this.env.SECRETS.get(key);
    } catch {
      return undefined;
    }
  }

  private async allowedModels(): Promise<string[]> {
    const raw = await this.envSetting("ALLOWED_MODELS");
    const parsed = raw
      ? raw.split(",").map((m) => m.trim()).filter(Boolean)
      : [];
    return parsed.length > 0 ? parsed : DEFAULT_ALLOWED_MODELS;
  }

  private async warnPct(): Promise<number> {
    const n = Number.parseInt((await this.envSetting("WARN_PCT")) ?? "80", 10);
    return Number.isFinite(n) ? n : 80;
  }

  private async hardPct(): Promise<number> {
    const n = Number.parseInt((await this.envSetting("HARD_PCT")) ?? "100", 10);
    return Number.isFinite(n) ? n : 100;
  }

  /** True unless the gateway reports the group gone (404). Transient errors count as existing. */
  private async groupStillExists(groupId: string): Promise<boolean> {
    try {
      await (await this.client()).getTokenGroup(groupId);
      return true;
    } catch (error) {
      return !(error instanceof GatewayError && error.status === 404);
    }
  }

  /** Wipe per-actor ledger rows (used when the token group was deleted out-of-band). */
  private clearLedger(): void {
    this.ctx.storage.sql.exec("DELETE FROM spend_days");
    this.ctx.storage.sql.exec("DELETE FROM alerts");
    this.ctx.storage.sql.exec("DELETE FROM guardrail_events");
  }

  private requireProvisioned(state: LedgerState): void {
    if (!state.tokenGroupId) {
      throw new ValidationError(`Ledger not provisioned for tenant "${state.tenantId}"`);
    }
  }

  private async armRollup(): Promise<string> {
    const interval = await this.rollupInterval();
    return this.every(interval, "rollup", undefined, {
      id: ROLLUP_SCHEDULE_ID,
    });
  }

  private async rollupInterval(): Promise<number> {
    return rollupIntervalSeconds(await this.envSetting("ROLLUP_INTERVAL_SECONDS"));
  }

  private createSchema(): void {
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS spend_days (
      tenant TEXT NOT NULL,
      day TEXT NOT NULL,
      spend REAL NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      blocked INTEGER NOT NULL DEFAULT 0,
      flagged INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (tenant, day)
    )`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS alerts (
      tenant TEXT NOT NULL,
      level TEXT NOT NULL,
      at TEXT NOT NULL,
      PRIMARY KEY (tenant, level, at)
    )`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS guardrail_events (
      event_id TEXT PRIMARY KEY,
      tenant TEXT NOT NULL,
      day TEXT NOT NULL,
      stage TEXT NOT NULL,
      outcome TEXT NOT NULL,
      detector TEXT NOT NULL,
      code TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1
    )`);
  }

  /** One ledger row per (tenant, day). Re-running a day overwrites — idempotent. */
  private upsertSpendDay(row: {
    tenant: string;
    day: string;
    spend: number;
    inputTokens: number;
    outputTokens: number;
    blocked: number;
    flagged: number;
  }): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO spend_days (tenant, day, spend, input_tokens, output_tokens, blocked, flagged)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant, day) DO UPDATE SET
         spend = excluded.spend,
         input_tokens = excluded.input_tokens,
         output_tokens = excluded.output_tokens,
         blocked = excluded.blocked,
         flagged = excluded.flagged`,
      row.tenant,
      row.day,
      row.spend,
      row.inputTokens,
      row.outputTokens,
      row.blocked,
      row.flagged,
    );
  }

  private recordFinding(tenantId: string, eventId: string, row: FindingRow): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO guardrail_events (event_id, tenant, day, stage, outcome, detector, code, count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET
         day = excluded.day,
         stage = excluded.stage,
         outcome = excluded.outcome,
         detector = excluded.detector,
         code = excluded.code,
         count = excluded.count`,
      eventId,
      tenantId,
      row.day,
      row.stage,
      row.outcome,
      row.detector,
      row.code,
      row.count,
    );
  }

  private async syncPeriod(group: TokenGroup): Promise<void> {
    const state = await this.getState();
    if (state.resetsAt && group.resets_at && group.resets_at !== state.resetsAt) {
      // The gateway rolled into a new budget period — reset the once-per-period guards.
      await this.setState({
        resetsAt: group.resets_at,
        budgetStartedAt: group.budget_started_at,
        alerted80: false,
        alerted100: false,
        readOnly: false,
      });
    } else if (!state.resetsAt) {
      await this.setState({
        resetsAt: group.resets_at,
        budgetStartedAt: group.budget_started_at,
      });
    }
  }

  private async pullUsage(state: LedgerState): Promise<UsageSummary> {
    const window = summaryWindow(state.budgetStartedAt);
    const client = await this.client();
    return client.usageSummary(state.tokenGroupId as string, window.startDate, window.endDate);
  }

  @rpc({ description: "Provision a tenant: token group + token key on the AI Gateway" })
  async provision(
    tenantId: string,
    monthlyBudget: number,
  ): Promise<{
    gatewayBaseUrl: string;
    tokenGroupId: string;
    tokenKeyId: string;
    tokenKey: string;
    allowedModels: string[];
    alreadyProvisioned: boolean;
  }> {
    const { tenantId: id, monthlyBudget: budget } = validateProvisionInput(tenantId, monthlyBudget);
    const state = await this.getState();
    if (state.tokenGroupId) {
      if (await this.groupStillExists(state.tokenGroupId)) {
        await this.armRollup();
        return {
          gatewayBaseUrl: INFERENCE_BASE_URL,
          tokenGroupId: state.tokenGroupId,
          tokenKeyId: state.tokenKeyId ?? "",
          tokenKey: state.tokenKeySecret ?? "",
          allowedModels: await this.allowedModels(),
          alreadyProvisioned: true,
        };
      }
      // The token group was deleted out-of-band (e.g. in the portal): rebuild
      // the ledger fresh — durable state reset, SQL rows cleared.
      await this.replaceState(this.initialState());
      this.clearLedger();
    }

    const client = await this.client();
    const group = await client.createTokenGroup(id, await this.allowedModels(), budget);
    const key = await client.createTokenKey(`${id}-primary`, group.id);

    await this.setState({
      tenantId: id,
      tokenGroupId: group.id,
      tokenKeyId: key.id,
      tokenKeySecret: key.token,
      monthlyBudget: budget,
      budgetStartedAt: group.budget_started_at,
      resetsAt: group.resets_at,
      alerted80: false,
      alerted100: false,
      readOnly: false,
      createdAt: new Date().toISOString(),
    });
    this.createSchema();
    // Immediate first rollup so the ledger is populated (and thresholds proven)
    // within seconds of provisioning; the recurring cadence takes over from there.
    await this.queue("rollup");
    await this.armRollup();

    return {
      gatewayBaseUrl: INFERENCE_BASE_URL,
      tokenGroupId: group.id,
      tokenKeyId: key.id,
      tokenKey: key.token,
      allowedModels: await this.allowedModels(),
      alreadyProvisioned: false,
    };
  }

  @rpc({ description: "Month-to-date spend, by-model split, guardrail findings, alerts" })
  async spendView(tenantId: string): Promise<SpendView> {
    const state = await this.getState();
    if (!tenantId || state.tenantId !== tenantId.trim()) {
      throw new ValidationError(`Ledger not provisioned for tenant "${tenantId}"`);
    }
    this.requireProvisioned(state);
    this.createSchema();

    const client = await this.client();
    const group = await client.getTokenGroup(state.tokenGroupId as string);
    await this.syncPeriod(group);

    const current = await this.getState();
    const summary = await this.pullUsage(current);
    const totals = summary.totals ?? {};
    const monthToDate = totals.spend ?? 0;
    const budget = current.monthlyBudget;

    const byModel: SpendView["byModel"] = {};
    for (const row of summary.by_model ?? []) {
      if (!row.model) continue;
      byModel[row.model] = {
        spend: row.spend ?? 0,
        inputTokens: row.input_tokens ?? 0,
        outputTokens: row.output_tokens ?? 0,
      };
    }

    const window = summaryWindow(current.budgetStartedAt);
    let findings: FindingRow[] = [];
    try {
      const events = await client.guardrailEvents(
        state.tokenGroupId as string,
        window.startDate,
        window.endDate,
      );
      for (const event of events) {
        for (const row of toFindingRows([event], 50)) {
          this.recordFinding(tenantId.trim(), event.id, row);
        }
      }
      findings = this.ctx.storage.sql
        .exec(
          "SELECT day, stage, outcome, detector, code, count FROM guardrail_events WHERE tenant = ? ORDER BY day DESC LIMIT 50",
          tenantId.trim(),
        )
        .toArray() as unknown as FindingRow[];
    } catch {
      findings = [];
    }

    const alerts = this.ctx.storage.sql
      .exec("SELECT level, at FROM alerts WHERE tenant = ? ORDER BY at DESC", tenantId.trim())
      .toArray() as unknown as { level: string; at: string }[];

    return {
      tenantId: current.tenantId,
      monthToDate,
      budget: current.monthlyBudget,
      pct: pctOf(monthToDate, current.monthlyBudget),
      byModel,
      guardrails: {
        blocked: summary.guardrails?.blocked_events ?? 0,
        flagged: summary.guardrails?.flagged_events ?? 0,
        findings,
      },
      alerts,
      readOnly: current.readOnly,
      budgetPeriod: { startedAt: current.budgetStartedAt, resetsAt: current.resetsAt },
      lastRollupAt: current.lastRollupAt,
      lastRollupError: current.lastRollupError,
      rollupDebug: current.rollupDebug,
      lastSms: current.lastSms,
    };
  }

  @rpc({ description: "PATCH the tenant's token group budget (ETag-preconditioned, audited)" })
  async adjustBudget(monthlyBudget: number): Promise<AdjustResult> {
    const state = await this.getState();
    this.requireProvisioned(state);
    const { monthlyBudget: budget } = validateProvisionInput(state.tenantId, monthlyBudget);

    const client = await this.client();
    const group = await client.getTokenGroup(state.tokenGroupId as string);
    const updated = await client.patchTokenGroup(group.id, group.version, {
      max_budget: budget,
    });
    const from = state.monthlyBudget;
    const audit = [
      ...state.budgetAudit.slice(-49),
      { at: new Date().toISOString(), from, to: budget },
    ];
    await this.setState({ monthlyBudget: budget, budgetAudit: audit });
    return { ok: true, maxBudget: updated.max_budget ?? budget, groupVersion: updated.version, audit };
  }

  /** Durable task: pull gateway usage + guardrail findings into SQL, alert. */
  async rollup(): Promise<void> {
    const state = await this.getState();
    if (!state.tokenGroupId) return;
    this.createSchema();

    const envRaw = await this.envSetting("ROLLUP_INTERVAL_SECONDS");
    const envProp = (this.env as unknown as Record<string, unknown>).ROLLUP_INTERVAL_SECONDS;
    const procEnv = process.env?.ROLLUP_INTERVAL_SECONDS;
    const mark = async (step: string, error: string | null = null): Promise<void> => {
      await this.setState({
        rollupDebug: {
          at: new Date().toISOString(),
          step,
          intervalSeconds: rollupIntervalSeconds(envRaw),
          envRaw: envRaw ?? "",
          envProp: envProp == null ? "" : String(envProp),
          procEnv: procEnv ?? "",
          error,
        },
      });
    };

    await mark("start");
    try {
      const client = await this.client();
      let group: TokenGroup;
      try {
        group = await client.getTokenGroup(state.tokenGroupId);
      } catch (error) {
        await mark("get-group", `getTokenGroup: ${(error as Error).message}`);
        await this.setState({ lastRollupError: `getTokenGroup: ${(error as Error).message}` });
        return;
      }
      await mark("got-group");
      await this.syncPeriod(group);

      const current = await this.getState();
      let summary: UsageSummary;
      try {
        summary = await this.pullUsage(current);
      } catch (error) {
        await mark("usage", `usageSummary: ${(error as Error).message}`);
        await this.setState({ lastRollupError: `usageSummary: ${(error as Error).message}` });
        return;
      }
      await mark("usage-pulled");

      for (const dayRow of summary.by_day ?? []) {
        if (!dayRow.date) continue;
        this.upsertSpendDay({
          tenant: current.tenantId,
          day: dayRow.date,
          spend: dayRow.spend ?? 0,
          inputTokens: dayRow.input_tokens ?? 0,
          outputTokens: dayRow.output_tokens ?? 0,
          blocked: 0,
          flagged: 0,
        });
      }
      await mark("sql-upserted");

      try {
        const window = summaryWindow(current.budgetStartedAt);
        const events = await client.guardrailEvents(current.tokenGroupId as string, window.startDate, window.endDate);
        for (const event of events) {
          for (const row of toFindingRows([event], 50)) {
            this.recordFinding(current.tenantId, event.id, row);
          }
        }
      } catch (error) {
        // Findings are additive context; a failed pull must not break the spend rollup.
        await this.setState({ lastRollupError: `guardrailEvents: ${(error as Error).message}` });
      }
      await mark("findings");

      const monthToDate = summary.totals?.spend ?? 0;
      const p = pctOf(monthToDate, current.monthlyBudget);

      try {
        if (p >= (await this.warnPct()) && !current.alerted80) {
          await mark("alert-80");
          await this.recordAlert(
            "80",
            `Tenant ${current.tenantId} is at ${p}% of its monthly AI budget ($${monthToDate.toFixed(2)} of $${current.monthlyBudget.toFixed(2)}).`,
          );
          await mark("alert-80-sent");
        }
        if (p >= (await this.hardPct()) && !current.alerted100) {
          await mark("alert-100");
          await this.recordAlert(
            "100",
            `Tenant ${current.tenantId} reached 100% of its monthly AI budget. The gateway now denies requests with 403 budget_exceeded; the tenant view is read-only.`,
          );
          await mark("alert-100-sent");
        }
      } catch (error) {
        // One failed alert must not block the ledger completion — it retries next cycle.
        await mark("alerts-failed", `alerts: ${(error as Error).message}`);
        await this.setState({ lastRollupError: `alerts: ${(error as Error).message}` });
      }

      await mark("finishing");
      await this.setState({ lastRollupAt: new Date().toISOString(), lastRollupError: null });
      // No re-arm here: the every() mechanism schedules the next fire itself.
      // Replacing the task from inside its own handler races with that re-insert.
    } catch (error) {
      await mark("crashed", (error as Error).message);
      await this.setState({ lastRollupError: `rollup: ${(error as Error).message}` });
    }
  }

  private async recordAlert(level: string, body: string): Promise<void> {
    const tenantId = (await this.getState()).tenantId;
    // Durable alert first: the history row and once-per-period guard must not
    // depend on a successful SMS delivery. The live send is best-effort after.
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO alerts (tenant, level, at) VALUES (?, ?, ?)",
      tenantId,
      level,
      new Date().toISOString(),
    );
    if (level === "80") {
      await this.setState({ alerted80: true });
    } else {
      await this.setState({ alerted100: true, readOnly: true });
    }
    try {
      await this.sendAdminSms(body);
    } catch (error) {
      await this.setState({ lastRollupError: `sms-send: ${(error as Error).message}` });
    }
  }

  private async sendAdminSms(body: string): Promise<void> {
    let demoMode = true;
    try {
      demoMode = (await this.setting("DEMO_MODE")) !== "false";
    } catch {
      demoMode = true;
    }
    const to = (await this.envSetting("ADMIN_SMS_TO")) ?? "";
    const from = (await this.envSetting("ADMIN_SMS_FROM")) ?? "";
    // Record the alert in durable state — the spend view shows exactly what
    // would be (or was) sent, in demo mode and live alike.
    await this.setState({ lastSms: { to, at: new Date().toISOString(), body } });
    if (demoMode) return;
    await this.env.TELNYX.messages.send({ to, from, text: body });
  }

  async fetch(req: Request): Promise<Response> {
    if (new URL(req.url).pathname === "/health") {
      return Response.json({ status: "ok" });
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  }
}

export type LedgerStub = ActorStub &
  Pick<SpendLedger, "provision" | "spendView" | "adjustBudget">;

export interface LedgerNamespace extends ActorNamespace {
  idFromName(name: string): LedgerStub;
}

function unauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export async function authorizeRequest(
  req: Request,
  secrets: Secrets | undefined,
): Promise<boolean> {
  let expected: string | null = null;
  if (secrets) {
    try {
      expected = await secrets.get("API_TOKEN");
    } catch {
      expected = null;
    }
  }
  if (!expected) return true;
  const header = req.headers.get("Authorization") ?? "";
  return header === `Bearer ${expected}`;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/health") {
      return Response.json({ status: "ok" });
    }
    if (path !== "/provision" && path !== "/spend" && path !== "/adjust") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    try {
      if (!(await authorizeRequest(req, env.SECRETS))) return unauthorized();

      if (path === "/provision" && req.method === "POST") {
        const body = (await req.json()) as { tenantId?: unknown; monthlyBudget?: unknown };
        const stub = env.LEDGERS.idFromName(String(body.tenantId ?? ""));
        return Response.json(
          await stub.provision(
            String(body.tenantId ?? ""),
            Number(body.monthlyBudget ?? NaN),
          ),
        );
      }

      if (path === "/spend" && req.method === "GET") {
        const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) {
          return Response.json({ error: "tenantId is required" }, { status: 400 });
        }
        const stub = env.LEDGERS.idFromName(tenantId);
        return Response.json(await stub.spendView(tenantId));
      }

      if (path === "/adjust" && req.method === "POST") {
        const body = (await req.json()) as { tenantId?: unknown; monthlyBudget?: unknown };
        const tenantId = String(body.tenantId ?? "");
        if (!tenantId) {
          return Response.json({ error: "tenantId is required" }, { status: 400 });
        }
        const stub = env.LEDGERS.idFromName(tenantId);
        return Response.json(await stub.adjustBudget(Number(body.monthlyBudget ?? NaN)));
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      if (error instanceof GatewayError) {
        const status = error.status >= 500 ? 502 : 400;
        return Response.json({ error: error.message, code: error.code }, { status });
      }
      return Response.json({ error: "Request failed" }, { status: 500 });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
};
