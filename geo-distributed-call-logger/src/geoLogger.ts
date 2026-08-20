import { Agent } from "@telnyx/edge-runtime";

// ── Region detection ─────────────────────────────────────────────────────
// Map country codes to regions. In production you'd use a carrier lookup or
// number prefix library. For this sample we map E.164 country codes to
// named regions — the same regions used as KV counter keys.
const COUNTRY_TO_REGION: Record<string, string> = {
  "1": "us-east-1",      // US/Canada (+1)
  "44": "eu-west-1",      // UK (+44)
  "33": "eu-west-1",      // France (+33)
  "49": "eu-central-1",  // Germany (+49)
  "31": "eu-west-1",     // Netherlands (+31)
  "39": "eu-south-1",   // Italy (+39)
  "34": "eu-south-1",    // Spain (+34)
  "81": "ap-northeast-1", // Japan (+81)
  "82": "ap-northeast-1", // South Korea (+82)
  "86": "ap-east-1",     // China (+86)
  "91": "ap-south-1",    // India (+91)
  "61": "ap-southeast-1", // Australia (+61)
  "55": "sa-east-1",     // Brazil (+55)
  "52": "us-east-1",      // Mexico (+52)
};

/** Detect region from an E.164 phone number by country code prefix. */
export function detectRegion(phoneNumber: string): string {
  // Strip the leading "+"
  const digits = phoneNumber.replace(/^\+/, "");
  // Try 2-digit, then 1-digit country code (longest match first)
  const cc2 = digits.slice(0, 2);
  const cc1 = digits.slice(0, 1);
  if (COUNTRY_TO_REGION[cc2]) return COUNTRY_TO_REGION[cc2];
  if (COUNTRY_TO_REGION[cc1]) return COUNTRY_TO_REGION[cc1];
  return "unknown";
}

// ── State ────────────────────────────────────────────────────────────────
export interface GeoLoggerState extends Record<string, unknown> {
  callControlId: string;
  fromNumber: string;
  toNumber: string;
  direction: "inbound" | "outbound";
  region: string;
  status: "ringing" | "answered" | "hungup" | "logged" | "alerting" | "done" | "error";
  startedAt: number;
  answeredAt: number;
  endedAt: number;
  durationSec: number;
  logged: boolean;
  alertTriggered: boolean;
  regionCount: number;      // count AFTER increment
  threshold: number;
  error: string;
}

// ── Env: [telnyx] binding + KV + SQL (actor-local) ────────────────────────
interface GeoLoggerEnv {
  TELNYX: {
    messages: {
      send(m: { from: string; to: string; text: string }): Promise<unknown>;
    };
  };
  REGION_KV: KvNamespace;
  ALERT_PHONE: string;
  SENDER_PHONE: string;
  REGION_THRESHOLD: string;
  WINDOW_SECONDS: string;
}

const WINDOW_DEFAULT_SEC = 3600; // 1 hour
const THRESHOLD_DEFAULT = 100;

/**
 * GeoLoggerAgent — one actor instance per call.
 *
 * Pipeline (each stage queued for non-blocking execution):
 *   1. logCall()   — insert call record into SQL DB, increment region KV counter
 *   2. checkThreshold() — if region count exceeds threshold, queue alert
 *   3. alert()     — send SMS to ops via this.env.TELNYX.messages.send()
 */
export class GeoLoggerAgent extends Agent<GeoLoggerEnv, GeoLoggerState> {
  protected override initialState(): GeoLoggerState {
    return {
      callControlId: "",
      fromNumber: "",
      toNumber: "",
      direction: "inbound",
      region: "unknown",
      status: "ringing",
      startedAt: 0,
      answeredAt: 0,
      endedAt: 0,
      durationSec: 0,
      logged: false,
      alertTriggered: false,
      regionCount: 0,
      threshold: 0,
      error: "",
    };
  }

  /** Initialize the agent when a call starts. */
  async onCallStart(params: {
    callControlId: string;
    fromNumber: string;
    toNumber: string;
    direction: "inbound" | "outbound";
  }): Promise<void> {
    const region = detectRegion(params.fromNumber);
    const threshold = parseInt(this.env.REGION_THRESHOLD, 10) || THRESHOLD_DEFAULT;
    await this.setState({
      callControlId: params.callControlId,
      fromNumber: params.fromNumber,
      toNumber: params.toNumber,
      direction: params.direction,
      region,
      status: "ringing",
      startedAt: Date.now(),
      threshold,
    });
  }

  /** Mark the call as answered. */
  async onAnswered(): Promise<void> {
    await this.setState({
      ...await this.getState(),
      status: "answered",
      answeredAt: Date.now(),
    });
  }

  /** Mark the call as hung up and queue the log pipeline. */
  async onHangup(): Promise<void> {
    const state = await this.getState();
    const endedAt = Date.now();
    const durationSec = state.answeredAt
      ? Math.round((endedAt - state.answeredAt) / 1000)
      : 0;
    await this.setState({
      ...state,
      status: "hungup",
      endedAt,
      durationSec,
    });
    await this.queue("logCall");
  }

  /** Stage 1: Log the call to SQL DB and increment the region counter in KV. */
  async logCall(): Promise<void> {
    const state = await this.getState();
    try {
      // ── SQL: insert call record ──────────────────────────────────────
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS calls (
          call_control_id TEXT PRIMARY KEY,
          from_number     TEXT NOT NULL,
          to_number       TEXT NOT NULL,
          direction       TEXT NOT NULL,
          region          TEXT NOT NULL,
          duration_sec    INTEGER NOT NULL,
          started_at      INTEGER NOT NULL,
          ended_at        INTEGER NOT NULL,
          status          TEXT NOT NULL
        )`,
      );
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO calls
          (call_control_id, from_number, to_number, direction, region,
           duration_sec, started_at, ended_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        state.callControlId,
        state.fromNumber,
        state.toNumber,
        state.direction,
        state.region,
        state.durationSec,
        state.startedAt,
        state.endedAt,
        "completed",
      );

      // ── KV: increment region counter (rolling window) ─────────────────
      const windowSec = parseInt(this.env.WINDOW_SECONDS, 10) || WINDOW_DEFAULT_SEC;
      const windowStart = Math.floor(Date.now() / 1000 / windowSec) * windowSec;
      const kvKey = `region:${state.region}:${windowStart}`;
      const currentStr = await this.env.REGION_KV.get(kvKey);
      const current = currentStr ? parseInt(currentStr, 10) : 0;
      const newCount = current + 1;
      await this.env.REGION_KV.put(kvKey, String(newCount), {
        expirationTtl: windowSec,
      });

      await this.setState({
        ...state,
        logged: true,
        regionCount: newCount,
        status: "logged",
      });
      await this.queue("checkThreshold");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.setState({
        ...state,
        status: "error",
        error: `logCall: ${msg}`,
      });
    }
  }

  /** Stage 2: Check if the region's call count exceeds the threshold. */
  async checkThreshold(): Promise<void> {
    const state = await this.getState();
    try {
      if (state.regionCount >= state.threshold) {
        await this.setState({
          ...state,
          status: "alerting",
          alertTriggered: true,
        });
        await this.queue("alert");
      } else {
        await this.setState({
          ...state,
          status: "done",
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.setState({
        ...state,
        status: "error",
        error: `checkThreshold: ${msg}`,
      });
    }
  }

  /** Stage 3: Send SMS alert to ops (zero-credential binding). */
  async alert(): Promise<void> {
    const state = await this.getState();
    try {
      const smsText =
        `Geo Call Alert: region "${state.region}" hit ${state.regionCount} calls ` +
        `in the current window (threshold: ${state.threshold}). ` +
        `Last call: ${state.fromNumber} → ${state.toNumber}, ${state.durationSec}s. ` +
        `Check the dashboard.`;

      await this.env.TELNYX.messages.send({
        from: this.env.SENDER_PHONE,
        to: this.env.ALERT_PHONE,
        text: smsText,
      });

      await this.setState({
        ...state,
        status: "done",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.setState({
        ...state,
        status: "error",
        error: `alert: ${msg}`,
      });
    }
  }

  /** Debug helper — return current agent state. */
  async getStatus(): Promise<GeoLoggerState> {
    return await this.getState();
  }

  /** Get the current call count for a region in the active window. */
  async getRegionCount(region: string): Promise<{ region: string; count: number; windowStart: number }> {
    const windowSec = parseInt(this.env.WINDOW_SECONDS, 10) || WINDOW_DEFAULT_SEC;
    const windowStart = Math.floor(Date.now() / 1000 / windowSec) * windowSec;
    const kvKey = `region:${region}:${windowStart}`;
    const countStr = await this.env.REGION_KV.get(kvKey);
    return {
      region,
      count: countStr ? parseInt(countStr, 10) : 0,
      windowStart,
    };
  }
}

// ── Registry actor: cross-call listing ────────────────────────────────────
export interface CallRecord {
  call_control_id: string;
  from_number: string;
  to_number: string;
  direction: string;
  region: string;
  duration_sec: number;
  started_at: number;
  ended_at: number;
  status: string;
}

export class CallRegistry extends Agent<Record<string, unknown>, Record<string, unknown>> {
  protected override initialState(): Record<string, unknown> {
    return { records: [] as CallRecord[] };
  }

  async record(entry: CallRecord): Promise<void> {
    const state = await this.getState();
    const records = (state.records as CallRecord[]) || [];
    // Keep last 1000 calls
    const updated = [...records, entry].slice(-1000);
    await this.setState({ records: updated });
  }

  async list(limit = 50): Promise<CallRecord[]> {
    const state = await this.getState();
    const records = (state.records as CallRecord[]) || [];
    return records.slice(-limit).reverse();
  }
}
