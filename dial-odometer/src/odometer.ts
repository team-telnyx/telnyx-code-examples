import { Agent } from "@telnyx/edge-runtime";
import type { ActorNamespace, Secrets, SqlDatabase } from "@telnyx/edge-runtime";

const DEFAULT_POLL_EVERY = 60;
const DEFAULT_WARN_PCT = 80;
const WARN_STREAK = 2;
const WINDOW_SECONDS = 120;
const BACKOFF_MS = [2000, 4000, 8000];
const KNOWN_REGION_LOOKBACK_MS = 60 * 60 * 1000;
const API_BASE = "https://api.telnyx.com/v2/dial_metrics";

/** Region sentinel for a minute the API never answered for. Metrics stay NULL. */
export const GAP_REGION = "__gap__";

export interface Env {
  SECRETS: Secrets;
  ODOMETER: ActorNamespace;
  ODOMETER_DB: SqlDatabase;
  POLL_EVERY?: string;
  WARN_PCT?: string;
  DEMO_MODE?: string;
}

export interface DialMetricRecord {
  region: string;
  start_time: string;
  dials?: { total?: number };
  average_dps?: number;
  peak_dps?: number;
  dps_limit?: number;
}

export interface OdometerState {
  campaign: string;
  /** Signed: > 0 consecutive minutes at/above WARN_PCT, < 0 consecutive minutes below. */
  streak: number;
  throttling: boolean;
  lastDps: number;
}

export interface ReadingView {
  region: string;
  bucketStart: string;
  dialsTotal: number | null;
  averageDps: number | null;
  peakDps: number | null;
  dpsLimit: number | null;
  gap: boolean;
}

export interface StatusScreen {
  campaign: string;
  throttling: boolean;
  streak: number;
  lastDps: number;
  warnPct: number;
  headline: string;
  readings: ReadingView[];
}

interface ReadingRow {
  region: string;
  bucketStart: Date;
  dialsTotal: number | null;
  averageDps: number | null;
  peakDps: number | null;
  dpsLimit: number | null;
}

function floorToMinute(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 60_000) * 60_000);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Deterministic synthetic metrics for safe demo mode (no Telnyx credentials needed). */
function demoMetrics(now: Date): DialMetricRecord[] {
  const phase = Math.floor(now.getTime() / 60_000) % 10;
  const dps = phase === 0 ? 0.82 : phase === 1 ? 0.83 : phase === 2 ? 0.41 : phase === 3 ? 0.42 : 0.55;
  const bucket = floorToMinute(now).toISOString();
  const records: DialMetricRecord[] = [
    {
      region: "us-east",
      start_time: bucket,
      dials: { total: Math.round(dps * 60) },
      average_dps: dps,
      peak_dps: round2(dps * 1.2),
      dps_limit: 1,
    },
  ];
  if (phase % 3 !== 0) {
    records.push({ region: "eu-west", start_time: bucket, dials: { total: 12 }, average_dps: 0.2, peak_dps: 0.24, dps_limit: 1 });
  }
  return records;
}

function newestPerRegion(records: DialMetricRecord[]): Map<string, DialMetricRecord> {
  const newest = new Map<string, DialMetricRecord>();
  for (const record of records) {
    if (!record || typeof record.region !== "string" || record.region.length === 0) continue;
    const current = newest.get(record.region);
    if (!current || Date.parse(record.start_time) > Date.parse(current.start_time)) {
      newest.set(record.region, record);
    }
  }
  return newest;
}

function latestBucket(newest: Map<string, DialMetricRecord>, now: Date): Date {
  let latest = 0;
  for (const record of newest.values()) {
    const parsed = Date.parse(record.start_time);
    if (Number.isFinite(parsed) && parsed > latest) latest = parsed;
  }
  return latest > 0 ? new Date(latest) : floorToMinute(new Date(now.getTime() - 60_000));
}

/**
 * One durable odometer per outbound campaign. The actor owns the streak counter,
 * the throttle flag and the reading history across polls, pods and days.
 */
export class DialOdometer extends Agent<Env, OdometerState> {
  protected initialState(): OdometerState {
    return { campaign: "", streak: 0, throttling: false, lastDps: 0 };
  }

  /** POST /odometer \u2014 arms the odometer and starts the poll loop. */
  async arm(campaign: string): Promise<OdometerState> {
    const state = await this.getState();
    if (state.campaign !== campaign) {
      await this.setState({ campaign, streak: 0, throttling: false, lastDps: 0 });
    }
    await this.ensureSchema();
    await this.schedulePoll();
    return this.getState();
  }

  /** Fires every POLL_EVERY seconds; also callable on demand via POST /odometer/:campaign/poll. */
  async onPoll(): Promise<void> {
    const state = await this.getState();
    if (!state.campaign) return;
    const now = new Date();
    try {
      const records = await this.fetchMetrics(new Date(now.getTime() - WINDOW_SECONDS * 1000), now);
      await this.fileReadings(state.campaign, records, now);
    } catch (error) {
      await this.onGap(now, error);
    } finally {
      await this.schedulePoll();
    }
  }

  /** RPC surface \u2014 the one-screen history the team reads. */
  async status(): Promise<StatusScreen> {
    const state = await this.getState();
    const warnPct = this.warnPct();
    const rows = await this.query<{
      region: string;
      bucket_start: string;
      dials_total: number | null;
      average_dps: number | null;
      peak_dps: number | null;
      dps_limit: number | null;
    }>(
      `SELECT region, bucket_start, dials_total, average_dps, peak_dps, dps_limit
         FROM dps_readings WHERE campaign = ?
        ORDER BY bucket_start DESC, region ASC LIMIT 30`,
      state.campaign
    );

    const readings: ReadingView[] = rows.map((row) => ({
      region: row.region,
      bucketStart: row.bucket_start,
      dialsTotal: row.dials_total,
      averageDps: row.average_dps,
      peakDps: row.peak_dps,
      dpsLimit: row.dps_limit,
      gap: row.region === GAP_REGION,
    }));

    const limit = rows.find((row) => typeof row.dps_limit === "number" && row.dps_limit > 0)?.dps_limit ?? 0;
    const target = round2((limit * warnPct) / 100);
    const headline = state.throttling
      ? `${state.campaign}: slow to \u2264${target} dps until further notice.`
      : `${state.campaign}: clear at ${state.lastDps} dps (${warnPct}% ceiling ${target} dps).`;

    return {
      campaign: state.campaign,
      throttling: state.throttling,
      streak: state.streak,
      lastDps: state.lastDps,
      warnPct,
      headline,
      readings,
    };
  }

  /** Two consecutive minutes at/above WARN_PCT flip the campaign into throttling. */
  private async onStreak(streak: number): Promise<void> {
    if (streak < WARN_STREAK) return;
    const state = await this.getState();
    if (state.throttling) return;
    await this.setState({ throttling: true });
    console.log(`dial-odometer: ${state.campaign} throttling after ${streak} hot minutes`);
  }

  /** Two consecutive minutes below WARN_PCT clear the flag. */
  private async onClear(streak: number): Promise<void> {
    if (streak > -WARN_STREAK) return;
    const state = await this.getState();
    if (!state.throttling) return;
    await this.setState({ throttling: false });
    console.log(`dial-odometer: ${state.campaign} cleared after ${Math.abs(streak)} calm minutes`);
  }

  /** API outage \u2014 mark the minute, never fabricate a reading and never move the streak. */
  private async onGap(now: Date, error: unknown): Promise<void> {
    const state = await this.getState();
    if (!state.campaign) return;
    console.error("dial_metrics unavailable, marking gap", error instanceof Error ? error.message : "unknown error");
    await this.insertReading(
      state.campaign,
      { region: GAP_REGION, bucketStart: floorToMinute(now), dialsTotal: null, averageDps: null, peakDps: null, dpsLimit: null },
      now
    );
  }

  private async fileReadings(campaign: string, records: DialMetricRecord[], now: Date): Promise<void> {
    const newest = newestPerRegion(records);
    const referenceBucket = latestBucket(newest, now);
    const campaignLimit = Math.max(0, ...Array.from(newest.values(), (record) => record.dps_limit ?? 0));

    // Documented missing-bucket rule: a region with no record in the window reads 0 dps.
    for (const region of await this.knownRegions(campaign, now)) {
      if (newest.has(region)) continue;
      await this.insertReading(
        campaign,
        { region, bucketStart: referenceBucket, dialsTotal: 0, averageDps: 0, peakDps: 0, dpsLimit: campaignLimit },
        now
      );
    }

    let liveDps = 0;
    let pct = 0;
    for (const record of newest.values()) {
      const bucketStart = new Date(record.start_time);
      if (Number.isNaN(bucketStart.getTime())) continue;
      const limit = record.dps_limit ?? 0;
      const dps = record.average_dps ?? 0;
      await this.insertReading(
        campaign,
        {
          region: record.region,
          bucketStart,
          dialsTotal: record.dials?.total ?? 0,
          averageDps: dps,
          peakDps: record.peak_dps ?? 0,
          dpsLimit: limit,
        },
        now
      );
      if (limit > 0 && (dps / limit) * 100 > pct) {
        pct = (dps / limit) * 100;
        liveDps = dps;
      }
    }

    const state = await this.getState();
    const above = pct >= this.warnPct();
    const streak = above ? Math.max(state.streak, 0) + 1 : Math.min(state.streak, 0) - 1;
    await this.setState({ streak, lastDps: round2(liveDps) });

    if (above) await this.onStreak(streak);
    else await this.onClear(streak);
  }

  private async fetchMetrics(start: Date, end: Date): Promise<DialMetricRecord[]> {
    if (this.demoMode()) return demoMetrics(end);

    const apiKey = await this.env.SECRETS.get("TELNYX_API_KEY");
    if (!apiKey) throw new Error("TELNYX_API_KEY is not configured");

    const url = new URL(API_BASE);
    url.searchParams.set("granularity", "second");
    url.searchParams.set("sort", "-start_time");
    url.searchParams.set("start_time", start.toISOString());
    url.searchParams.set("end_time", end.toISOString());

    let lastError: unknown = new Error("dial_metrics unreachable");
    for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt += 1) {
      if (attempt > 0) await sleep(BACKOFF_MS[attempt - 1]);
      let response: Response;
      try {
        response = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        });
      } catch (error) {
        lastError = error;
        continue;
      }
      if (response.ok) {
        const body = (await response.json()) as { data?: DialMetricRecord[] };
        return Array.isArray(body.data) ? body.data : [];
      }
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`dial_metrics responded ${response.status}`);
      }
      lastError = new Error(`dial_metrics responded ${response.status}`);
    }
    throw lastError instanceof Error ? lastError : new Error("dial_metrics unreachable");
  }

  private async schedulePoll(): Promise<void> {
    const state = await this.getState();
    if (!state.campaign) return;
    await this.schedule(this.pollEverySeconds(), "onPoll", undefined, { id: `poll:${state.campaign}` });
  }

  private async knownRegions(campaign: string, now: Date): Promise<string[]> {
    const cutoff = new Date(now.getTime() - KNOWN_REGION_LOOKBACK_MS).toISOString();
    const rows = await this.query<{ region: string }>(
      `SELECT DISTINCT region FROM dps_readings
        WHERE campaign = ? AND bucket_start >= ? AND region <> ?`,
      campaign,
      cutoff,
      GAP_REGION
    );
    return rows.map((row) => row.region);
  }

  private async ensureSchema(): Promise<void> {
    await this.env.ODOMETER_DB.exec(
      `CREATE TABLE IF NOT EXISTS dps_readings (
         campaign TEXT NOT NULL,
         region TEXT NOT NULL,
         bucket_start TIMESTAMPTZ NOT NULL,
         dials_total INT,
         average_dps REAL,
         peak_dps REAL,
         dps_limit REAL,
         recorded_at TIMESTAMPTZ NOT NULL,
         PRIMARY KEY (campaign, region, bucket_start)
       )`
    );
  }

  private async insertReading(campaign: string, row: ReadingRow, now: Date): Promise<void> {
    await this.env.ODOMETER_DB.prepare(
      `INSERT INTO dps_readings
         (campaign, region, bucket_start, dials_total, average_dps, peak_dps, dps_limit, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (campaign, region, bucket_start) DO NOTHING`
    )
      .bind(
        campaign,
        row.region,
        row.bucketStart.toISOString(),
        row.dialsTotal,
        row.averageDps,
        row.peakDps,
        row.dpsLimit,
        now.toISOString()
      )
      .run();
  }

  private async query<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    const result = (await this.env.ODOMETER_DB.prepare(sql).bind(...params).all()) as { results?: T[] } | T[];
    return Array.isArray(result) ? result : (result.results ?? []);
  }

  private pollEverySeconds(): number {
    return envInt(this.env.POLL_EVERY, DEFAULT_POLL_EVERY);
  }

  private warnPct(): number {
    return envInt(this.env.WARN_PCT, DEFAULT_WARN_PCT);
  }

  private demoMode(): boolean {
    return (this.env.DEMO_MODE ?? "true").toLowerCase() !== "false";
  }
}
