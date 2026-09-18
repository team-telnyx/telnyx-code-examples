import { Agent, type ActorContext, type ActorStub } from "@telnyx/edge-runtime";
import type { Env as RuntimeEnv } from "@telnyx/edge-runtime";

// ---------------------------------------------------------------------------
// BatchAgent — the actor IS the email campaign.
// A durable entity that owns per-message state, fires the Telnyx Email Batch
// API (POST /v2/email_messages/batch) with an Idempotency-Key header, parses
// the 207 Multi-Status response, and self-wakes via schedule() to retry only
// the failed indices with exponential backoff. On completion it persists the
// audit trail to KV and notifies the operator via SMS.
// ---------------------------------------------------------------------------

export type MessageStatus = "PENDING" | "SENT" | "FAILED" | "RETRYING" | "EXHAUSTED";
export type CampaignStatus = "CREATED" | "SENDING" | "RETRYING" | "COMPLETED" | "PARTIAL_FAILURE";

export interface MessageState {
  index: number;
  to: string;
  from: string | null;
  subject: string;
  text: string;
  status: MessageStatus;
  attempts: number;
  lastError: string | null;
  idempotencyKey: string | null;
  /** Idempotency keys used by every attempt so far, in order (initial + retries). */
  idempotencyKeys: string[];
  /** Telnyx email message id returned by a successful send. */
  messageId: string | null;
  updatedAt: string | null;
}

export interface CampaignState extends Record<string, unknown> {
  campaignId: string;
  total: number;
  sent: number;
  failed: number;
  exhausted: number;
  operatorNumber: string | null;
  smsFrom: string | null;
  messages: MessageState[];
  status: CampaignStatus;
  createdAt: string;
  completedAt: string | null;
  notifyError: string | null;
  kvError: string | null;
}

/**
 * Bindings declared in telnyx.toml ([[actors]], [telnyx], [[secrets]],
 * [storage.kv]) are typed by the generated telnyx-env.d.ts; env_vars land as
 * plain string properties on top of them.
 */
export interface Env extends RuntimeEnv {
  TELNYX_API_KEY?: string;
  EMAIL_FROM?: string;
  OPERATOR_NUMBER?: string;
  TELNYX_SENDER?: string;
  MOCK_MODE?: string;
}

// --- constants -------------------------------------------------------------

const BACKOFF_SECONDS = [60, 300]; // 60s -> 5m (25m tier documented, never fired at max 3 attempts)
const MAX_ATTEMPTS = 3; // 1 initial send + 2 retries
const EMAIL_BATCH_URL = "https://api.telnyx.com/v2/email_messages/batch";
const EMAIL_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const FROM_NAME = "Email Batch Retry Agent";

// --- Telnyx Email Batch API (207 Multi-Status) shapes ----------------------

interface BatchItemError {
  index: number;
  code: string;
  message: string;
}

interface BatchItemSuccess {
  id: string;
  status?: string;
  to?: Array<{ email?: string }>;
}

interface BatchResponse {
  data: BatchItemSuccess[];
  errors: BatchItemError[];
  meta?: { total: number; succeeded: number; failed: number };
}

export class BatchAgent extends Agent<Env, CampaignState> {
  // Durable default: an empty, freshly-created campaign.
  override initialState(): CampaignState {
    return {
      campaignId: "",
      total: 0,
      sent: 0,
      failed: 0,
      exhausted: 0,
      operatorNumber: null,
      smsFrom: null,
      messages: [],
      status: "CREATED",
      createdAt: new Date().toISOString(),
      completedAt: null,
      notifyError: null,
      kvError: null,
    };
  }

  // --- HTTP surface ---------------------------------------------------------

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "");

    if (req.method === "GET" && path === "") return demoDashboard();

    if (req.method === "POST" && path === "/campaigns") return this.handleCreateCampaign(req);

    if (req.method === "GET" && path === "/campaigns") return this.handleListCampaigns();

    const getCampaign = path.match(/^\/campaigns\/([^/]+)$/);
    if (req.method === "GET" && getCampaign) return this.handleGetCampaign(getCampaign[1]);

    return Response.json(
      { error: "Not found", endpoints: ["POST /campaigns", "GET /campaigns/:id", "GET /campaigns"] },
      { status: 404 },
    );
  }

  private async handleCreateCampaign(req: Request): Promise<Response> {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const campaignId = typeof body.campaignId === "string" ? body.campaignId.trim() : "";
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const operatorNumber = typeof body.operatorNumber === "string" ? body.operatorNumber.trim() : "";
    const smsFrom = typeof body.smsFrom === "string" ? body.smsFrom.trim() : "";
    if (!campaignId || messages.length === 0) {
      return Response.json({ error: "campaignId and non-empty messages[] required" }, { status: 400 });
    }

    const parsed: Array<Pick<MessageState, "to" | "from" | "subject" | "text">> = [];
    for (const raw of messages) {
      const m = (raw ?? {}) as Record<string, unknown>;
      const to = typeof m.to === "string" ? m.to.trim() : "";
      const subject = typeof m.subject === "string" ? m.subject : "";
      const text = typeof m.text === "string" ? m.text : "";
      const from = typeof m.from === "string" && m.from.trim() ? m.from.trim() : null;
      if (!to || !subject || !text) {
        return Response.json({ error: "Each message requires to, subject, text" }, { status: 400 });
      }
      if (!isValidEmailAddress(to)) {
        return Response.json({ error: `Invalid 'to' email address: ${to}` }, { status: 400 });
      }
      if (parsed.some((p) => p.to.toLowerCase() === to.toLowerCase())) {
        return Response.json({ error: `Duplicate recipient: ${to}` }, { status: 400 });
      }
      parsed.push({ to, from, subject, text });
    }

    const liveMode = envVar("MOCK_MODE", this.env) !== "true";
    if (liveMode) {
      const apiKey = await this.resolveApiKey();
      if (!apiKey) {
        return Response.json({ error: "TELNYX_API_KEY secret not configured" }, { status: 500 });
      }
    }
    if (!parsed[0].from && !(await this.resolveFromAddress())) {
      return Response.json({ error: "No from address: set message.from or the EMAIL_FROM secret" }, { status: 400 });
    }

    const state = await this.getState();
    if (state.campaignId && state.status !== "COMPLETED" && state.status !== "PARTIAL_FAILURE") {
      return Response.json(
        { error: `A campaign (${state.campaignId}) is already active on this actor` },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const next: CampaignState = {
      campaignId,
      total: parsed.length,
      sent: 0,
      failed: 0,
      exhausted: 0,
      operatorNumber: operatorNumber || null,
      smsFrom: smsFrom || null,
      messages: parsed.map((m, index): MessageState => ({
        index,
        to: m.to,
        from: m.from,
        subject: m.subject,
        text: m.text,
        status: "PENDING",
        attempts: 0,
        lastError: null,
        idempotencyKey: null,
        idempotencyKeys: [],
        messageId: null,
        updatedAt: null,
      })),
      status: "CREATED",
      createdAt: now,
      completedAt: null,
      notifyError: null,
      kvError: null,
    };
    await this.replaceState(next);
    await this.events.emit("campaign.created", { campaignId, total: parsed.length, mode: liveMode ? "live" : "mock" });
    await this.queue("sendBatch");
    return Response.json({ campaignId, status: "CREATED" }, { status: 202 });
  }

  private async handleGetCampaign(id: string): Promise<Response> {
    const state = await this.getState();
    if (state.campaignId !== id) {
      return Response.json({ error: "Campaign not found" }, { status: 404 });
    }
    return Response.json(state);
  }

  private async handleListCampaigns(): Promise<Response> {
    const audits: Array<Record<string, unknown>> = [];
    try {
      const listing = await this.env.RESULT_KV.list({ prefix: "campaign/" });
      for (const key of listing.keys) {
        if (!key.name.endsWith(":audit")) continue;
        const record = await this.env.RESULT_KV.get<Record<string, unknown>>(key.name, { type: "json" });
        if (record) audits.push(record);
      }
    } catch (err) {
      return Response.json(
        { error: "KV audit store unavailable", detail: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }
    return Response.json(audits);
  }

  // --- Task: initial batch send --------------------------------------------

  async sendBatch(): Promise<void> {
    const state = await this.getState();
    if (state.status === "COMPLETED" || state.status === "PARTIAL_FAILURE") return;

    const candidates = state.messages.filter((m) => m.status === "PENDING" || m.status === "FAILED");
    if (candidates.length === 0) return;

    const idempotencyKey = this.generateIdempotencyKey(state.campaignId);
    const attempt = Math.max(...candidates.map((m) => m.attempts)) + 1;

    await this.setState({ status: "SENDING" });
    await this.events.emit("batch.sending", { attempt, count: candidates.length, idempotencyKey });

    const response = await this.sendBatchRequest(candidates, idempotencyKey, attempt);
    await this.applyBatchResult(candidates, idempotencyKey, response);

    const after = await this.getState();
    if (after.sent === after.total) {
      await this.completeCampaign();
    } else {
      await this.scheduleRetry();
    }
  }

  // --- Task: self-waking retry with exponential backoff ----------------------

  async retryFailed(): Promise<void> {
    const state = await this.getState();
    if (state.status !== "RETRYING") return;

    const failed = state.messages.filter((m) => m.status === "FAILED");
    if (failed.length === 0) {
      await this.finishCampaign();
      return;
    }

    const idempotencyKey = this.generateIdempotencyKey(state.campaignId);
    const attempt = Math.max(...failed.map((m) => m.attempts)) + 1;
    await this.events.emit("retry.sending", { attempt, count: failed.length, idempotencyKey });

    const response = await this.sendBatchRequest(failed, idempotencyKey, attempt);
    await this.applyBatchResult(failed, idempotencyKey, response);

    const after = await this.getState();
    const stillFailed = after.messages.filter((m) => m.status === "FAILED");
    if (after.sent === after.total) {
      await this.completeCampaign();
    } else if (stillFailed.length > 0) {
      await this.scheduleRetry();
    } else {
      await this.finishCampaign();
    }
  }

  // --- Backoff / completion ---------------------------------------------------

  private async scheduleRetry(): Promise<void> {
    const state = await this.getState();
    const failed = state.messages.filter((m) => m.status === "FAILED");
    const maxAttempt = Math.max(...failed.map((m) => m.attempts), 1);

    if (maxAttempt >= MAX_ATTEMPTS) {
      await this.finishCampaign();
      return;
    }

    const backoffIdx = Math.min(maxAttempt - 1, BACKOFF_SECONDS.length - 1);
    const delay = BACKOFF_SECONDS[backoffIdx];

    await this.setState({ status: "RETRYING" });
    await this.events.emit("retry.scheduled", { delaySeconds: delay, maxAttempt });
    await this.schedule(delay, "retryFailed");
  }

  private async completeCampaign(): Promise<void> {
    const state = await this.getState();
    const next: CampaignState = {
      ...state,
      status: "COMPLETED",
      completedAt: new Date().toISOString(),
      failed: 0,
      exhausted: 0,
    };
    await this.replaceState(next);
    await this.events.emit("campaign.completed", { sent: next.sent, total: next.total });
    await this.persistAudit(next);
    await this.notifyOperator(next);
  }

  private async finishCampaign(): Promise<void> {
    const state = await this.getState();
    const messages = state.messages.map((m) =>
      m.status === "FAILED" ? { ...m, status: "EXHAUSTED" as MessageStatus, updatedAt: new Date().toISOString() } : m,
    );
    const next: CampaignState = {
      ...state,
      messages,
      sent: messages.filter((m) => m.status === "SENT").length,
      failed: 0,
      exhausted: messages.filter((m) => m.status === "EXHAUSTED").length,
      status: "PARTIAL_FAILURE",
      completedAt: new Date().toISOString(),
    };
    await this.replaceState(next);
    await this.events.emit("campaign.partial_failure", { sent: next.sent, exhausted: next.exhausted, total: next.total });
    for (const m of next.messages) {
      if (m.status === "EXHAUSTED") await this.persistMessage(next.campaignId, m);
    }
    await this.persistAudit(next);
    await this.notifyOperator(next);
  }

  // --- Batch plumbing -----------------------------------------------------------

  private async sendBatchRequest(
    batch: MessageState[],
    idempotencyKey: string,
    attempt: number,
  ): Promise<BatchResponse> {
    if (this.env.MOCK_MODE === "true") return this.mockBatchResponse(batch, attempt);

    const apiKey = await this.resolveApiKey();
    if (!apiKey) throw new Error("TELNYX_API_KEY secret not configured");
    const from = await this.resolveFromAddress();
    if (!from) throw new Error("No from address available (message.from or EMAIL_FROM secret)");

    const payload = {
      messages: batch.map((m) => ({
        from: { email: m.from ?? from, name: FROM_NAME },
        to: [m.to],
        subject: m.subject,
        text_body: m.text,
      })),
    };

    const response = await fetch(EMAIL_BATCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
    });

    const bodyText = await response.text();
    let parsedBody: unknown = null;
    try {
      parsedBody = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      parsedBody = null;
    }

    if (!response.ok) {
      // Batch-level failure: no per-message outcome. Surface a generic error.
      const detail = describeApiError(parsedBody, response.status);
      throw new Error(`Batch API error ${response.status}: ${detail}`);
    }

    const batchResponse = parsedBody as BatchResponse | null;
    if (!batchResponse || !Array.isArray(batchResponse.errors)) {
      throw new Error("Batch API returned an unexpected response shape");
    }
    return batchResponse;
  }

  /** Simulates the 207 response in mock mode: the last two indices fail on the
   *  first attempt and heal on the first retry. */
  private mockBatchResponse(batch: MessageState[], attempt: number): BatchResponse {
    const failuresStart = Math.max(0, batch.length - 2);
    const data: BatchItemSuccess[] = [];
    const errors: BatchItemError[] = [];
    batch.forEach((m, localIdx) => {
      if (attempt === 1 && localIdx >= failuresStart) {
        errors.push({ index: localIdx, code: "validation_error", message: "Simulated failure (mock mode)" });
      } else {
        data.push({ id: crypto.randomUUID(), status: "queued", to: [{ email: m.to }] });
      }
    });
    return {
      data,
      errors,
      meta: { total: batch.length, succeeded: data.length, failed: errors.length },
    };
  }

  private async applyBatchResult(
    batch: MessageState[],
    idempotencyKey: string,
    response: BatchResponse,
  ): Promise<void> {
    const failedByIndex = new Map<number, BatchItemError>();
    for (const err of response.errors ?? []) failedByIndex.set(err.index, err);

    const successByRecipient = new Map<string, BatchItemSuccess>();
    for (const item of response.data ?? []) {
      const email = item.to?.[0]?.email?.toLowerCase();
      if (email) successByRecipient.set(email, item);
    }

    const now = new Date().toISOString();
    const state = await this.getState();
    const updated = new Map<number, MessageState>();
    for (let localIdx = 0; localIdx < batch.length; localIdx += 1) {
      const original = batch[localIdx];
      const current = state.messages[original.index];
      const failure = failedByIndex.get(localIdx);
      const success = successByRecipient.get(original.to.toLowerCase());
      const nextMessage: MessageState = {
        ...current,
        attempts: current.attempts + 1,
        idempotencyKey,
        idempotencyKeys: [...current.idempotencyKeys, idempotencyKey],
        updatedAt: now,
      };
      if (failure) {
        nextMessage.status = "FAILED";
        nextMessage.lastError = failure.message || failure.code;
      } else if (success) {
        nextMessage.status = "SENT";
        nextMessage.lastError = null;
        nextMessage.messageId = success.id;
      } else {
        nextMessage.status = "FAILED";
        nextMessage.lastError = "No response entry for this message index";
      }
      updated.set(original.index, nextMessage);
    }

    const messages = state.messages.map((m) => updated.get(m.index) ?? m);
    await this.replaceState({
      ...state,
      messages,
      sent: messages.filter((m) => m.status === "SENT").length,
      failed: messages.filter((m) => m.status === "FAILED").length,
      exhausted: messages.filter((m) => m.status === "EXHAUSTED").length,
    });

    await this.events.emit("batch.parsed", {
      succeeded: response.meta?.succeeded ?? [...successByRecipient.values()].length,
      failed: response.meta?.failed ?? failedByIndex.size,
      failedIndices: [...failedByIndex.keys()],
    });

    for (const message of updated.values()) await this.persistMessage(state.campaignId, message);
  }

  // --- Persistence + notification -------------------------------------------

  private async persistMessage(campaignId: string, message: MessageState): Promise<void> {
    try {
      await this.env.RESULT_KV.put(
        // KV keys only allow a-z A-Z 0-9 - _ / = . — use "/" instead of ":"
        `campaign/${campaignId}/msg/${message.index}`,
        JSON.stringify({
          to: message.to,
          status: message.status,
          attempts: message.attempts,
          idempotencyKey: message.idempotencyKey,
          idempotencyKeys: message.idempotencyKeys,
          messageId: message.messageId,
          lastError: message.lastError,
          updatedAt: message.updatedAt,
        }),
        { expirationTtl: EMAIL_TTL_SECONDS },
      );
    } catch (err) {
      await this.setState({ kvError: err instanceof Error ? err.message : String(err) });
    }
  }

  private async persistAudit(state: CampaignState): Promise<void> {
    const audit = {
      campaignId: state.campaignId,
      status: state.status,
      total: state.total,
      sent: state.sent,
      failed: state.failed,
      exhausted: state.exhausted,
      createdAt: state.createdAt,
      completedAt: state.completedAt,
      messages: state.messages.map((m) => ({
        index: m.index,
        to: m.to,
        status: m.status,
        attempts: m.attempts,
        idempotencyKeys: m.idempotencyKeys,
        messageId: m.messageId,
        lastError: m.lastError,
      })),
    };
    try {
      await this.env.RESULT_KV.put(`campaign/${state.campaignId}/audit`, JSON.stringify(audit), {
        expirationTtl: EMAIL_TTL_SECONDS,
      });
    } catch (err) {
      await this.setState({ kvError: err instanceof Error ? err.message : String(err) });
    }
  }

  private async notifyOperator(state: CampaignState): Promise<void> {
    const to = state.operatorNumber || envVar("OPERATOR_NUMBER", this.env);
    const from = state.smsFrom || envVar("TELNYX_SENDER", this.env);
    const summary =
      state.status === "COMPLETED"
        ? `Campaign ${state.campaignId} complete: ${state.sent}/${state.total} sent.`
        : `Campaign ${state.campaignId} partial failure: ${state.sent}/${state.total} sent, ${state.exhausted} exhausted.`;

    if (!to || !from) {
      await this.setState({ notifyError: "OPERATOR_NUMBER or TELNYX_SENDER not configured" });
      await this.events.emit("operator.notify_failed", { reason: "missing configuration" });
      return;
    }
    try {
      await this.env.TELNYX.messages.send({ from, to, text: summary });
      await this.events.emit("operator.notified", { to: maskPhone(to), summary });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.setState({ notifyError: message });
      await this.events.emit("operator.notify_failed", { message });
    }
  }

  // --- helpers ---------------------------------------------------------------

  private async resolveApiKey(): Promise<string | null> {
    if (this.env.TELNYX_API_KEY) return this.env.TELNYX_API_KEY;
    try {
      return (await this.env.SECRETS.get("TELNYX_API_KEY")) || null;
    } catch {
      return null;
    }
  }

  private async resolveFromAddress(): Promise<string | null> {
    if (this.env.EMAIL_FROM) return this.env.EMAIL_FROM;
    try {
      return (await this.env.SECRETS.get("EMAIL_FROM")) || null;
    } catch {
      return null;
    }
  }

  private generateIdempotencyKey(campaignId: string): string {
    const safeId = campaignId.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80) || "campaign";
    const random = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    return `${safeId}-${Date.now()}-${random}`;
  }
}

/**
 * `[env_vars]` from telnyx.toml land on `process.env` at runtime, not on the
 * actor's `env` bindings object; check process.env first and fall back.
 */
function envVar(name: string, env: Env): string | undefined {
  const fromProcess = process.env[name];
  if (fromProcess !== undefined) return fromProcess;
  return (env as unknown as Record<string, unknown>)[name] as string | undefined;
}

function describeApiError(body: unknown, status: number): string {
  const envelope = body as { errors?: Array<{ detail?: string; title?: string }> } | null;
  const detail = envelope?.errors?.[0]?.detail ?? envelope?.errors?.[0]?.title;
  return detail ? String(detail).slice(0, 200) : `HTTP ${status}`;
}

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? `***${digits.slice(-4)}` : "***";
}

function isValidEmailAddress(value: string): boolean {
  if (value.length > 320 || value.includes(" ") || value.includes("\t") || value.includes("\n")) return false;
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (!local || !domain || domain.startsWith(".") || domain.endsWith(".")) return false;
  return domain.includes(".") && !domain.split(".").some((part) => part.length === 0);
}

// --- Worker entry point -------------------------------------------------------

export default {
  async fetch(req: Request, env: Env, _ctx: ActorContext): Promise<Response> {
    const stub: ActorStub = env.BATCH_AGENT.idFromName("default");
    return stub.fetch(req);
  },
};

function demoDashboard(): Response {
  const html = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Email Batch Retry Agent</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f8fb;
      --panel: #ffffff;
      --ink: #172033;
      --muted: #667085;
      --line: #d9e0ea;
      --blue: #1b5cff;
      --green: #087443;
      --amber: #a15c00;
      --red: #b42318;
      --slate: #344054;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    button, input { font: inherit; }
    .shell { max-width: 1180px; margin: 0 auto; padding: 28px; }
    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 24px;
      padding-bottom: 22px;
      border-bottom: 1px solid var(--line);
    }
    h1 { margin: 0; font-size: 32px; line-height: 1.1; letter-spacing: 0; }
    .lede { margin: 10px 0 0; max-width: 760px; color: var(--muted); font-size: 16px; line-height: 1.5; }
    .actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
    .button {
      border: 1px solid var(--blue);
      background: var(--blue);
      color: white;
      min-height: 40px;
      padding: 0 14px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 650;
    }
    .button.secondary { background: white; color: var(--blue); }
    .button:disabled { opacity: .55; cursor: not-allowed; }
    main { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(340px, .95fr); gap: 18px; margin-top: 22px; }
    section, .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 1px 2px rgba(16,24,40,.04);
    }
    section { padding: 18px; }
    h2 { margin: 0 0 14px; font-size: 18px; letter-spacing: 0; }
    .scenario {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin-top: 16px;
    }
    .step { padding: 13px; border: 1px solid var(--line); border-radius: 8px; background: #fbfcfe; min-height: 110px; }
    .step b { display: block; margin-bottom: 8px; color: var(--slate); }
    .step p { margin: 0; color: var(--muted); line-height: 1.4; font-size: 14px; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    .stat { padding: 14px; border: 1px solid var(--line); border-radius: 8px; background: white; }
    .label { color: var(--muted); font-size: 12px; text-transform: uppercase; font-weight: 750; letter-spacing: .04em; }
    .value { margin-top: 8px; font-size: 28px; font-weight: 760; }
    .status-pill {
      display: inline-flex;
      align-items: center;
      min-height: 30px;
      padding: 0 10px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 750;
      border: 1px solid var(--line);
      background: #f8fafc;
      color: var(--slate);
    }
    .status-SENT, .status-COMPLETED { color: var(--green); background: #ecfdf3; border-color: #abefc6; }
    .status-FAILED, .status-RETRYING { color: var(--amber); background: #fffaeb; border-color: #fedf89; }
    .status-EXHAUSTED, .status-PARTIAL_FAILURE { color: var(--red); background: #fef3f2; border-color: #fecdca; }
    .campaign-line {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      padding: 12px 0 16px;
    }
    code, pre {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    }
    code {
      color: #243b6b;
      background: #eef4ff;
      padding: 2px 5px;
      border-radius: 5px;
      overflow-wrap: anywhere;
    }
    .messages { display: grid; gap: 10px; margin-top: 14px; }
    .message {
      display: grid;
      grid-template-columns: 52px minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }
    .index {
      width: 36px;
      height: 36px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      background: #eef4ff;
      color: #174ea6;
      font-weight: 760;
    }
    .msg-title { font-weight: 720; overflow-wrap: anywhere; }
    .msg-meta { margin-top: 5px; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
    .attempts { text-align: right; color: var(--muted); font-size: 13px; min-width: 86px; }
    .attempts b { display: block; color: var(--ink); font-size: 22px; }
    .terminal {
      background: #111827;
      color: #d1d5db;
      border-radius: 8px;
      padding: 14px;
      overflow: auto;
      font-size: 12px;
      line-height: 1.55;
      max-height: 470px;
    }
    .terminal .prompt { color: #93c5fd; }
    .note { color: var(--muted); line-height: 1.45; font-size: 14px; margin: 10px 0 0; }
    @media (max-width: 900px) {
      .shell { padding: 18px; }
      header, main { display: block; }
      .actions { justify-content: flex-start; margin-top: 16px; }
      .scenario, .stats { grid-template-columns: 1fr; }
      section { margin-top: 14px; }
      .message { grid-template-columns: 42px minmax(0,1fr); }
      .attempts { grid-column: 2; text-align: left; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div>
        <h1>Fraud Alert Batch Campaign</h1>
        <p class="lede">A persistent actor owns the campaign, remembers every recipient, retries only failed messages, and keeps the audit trail operators need after a partial provider failure.</p>
      </div>
      <div class="actions">
        <button class="button" id="start">Start demo campaign</button>
        <button class="button secondary" id="refresh">Refresh state</button>
      </div>
    </header>

    <main>
      <div>
        <section>
          <h2>Use Case</h2>
          <div class="scenario">
            <div class="step"><b>1. Urgent batch</b><p>A fraud team needs to notify cardholders before a dispute window closes.</p></div>
            <div class="step"><b>2. Partial failure</b><p>One message sends, another fails because its sender domain is invalid.</p></div>
            <div class="step"><b>3. Durable retry</b><p>The actor wakes itself, retries only the failed message, and preserves proof.</p></div>
          </div>
        </section>

        <section>
          <div class="campaign-line">
            <div>
              <div class="label">Campaign ID</div>
              <code id="campaignId">No campaign yet</code>
            </div>
            <span class="status-pill" id="status">IDLE</span>
          </div>
          <div class="stats">
            <div class="stat"><div class="label">Total</div><div class="value" id="total">0</div></div>
            <div class="stat"><div class="label">Sent</div><div class="value" id="sent">0</div></div>
            <div class="stat"><div class="label">Failed</div><div class="value" id="failed">0</div></div>
            <div class="stat"><div class="label">Exhausted</div><div class="value" id="exhausted">0</div></div>
          </div>
          <div class="messages" id="messages"></div>
          <p class="note" id="note">Start a campaign, then keep this next to your terminal. The terminal proves the raw actor state; this view makes the story readable.</p>
        </section>
      </div>

      <div>
        <section>
          <h2>Terminal Command</h2>
          <pre class="terminal" id="terminal"><span class="prompt"># Start the demo in the UI, then run:</span>
curl -sS "$BASE/campaigns/$CAMPAIGN_ID" | jq '{
  campaignId,status,total,sent,failed,exhausted,notifyError,
  messages:[.messages[]|{index,status,attempts,lastError,messageId,idempotencyKeys}]
}'</pre>
        </section>
      </div>
    </main>
  </div>

  <script>
    const $ = (id) => document.getElementById(id);
    const base = location.origin;
    let campaignId = "";
    let pollTimer = null;

    function statusClass(status) {
      return "status-pill status-" + String(status || "IDLE").replace(/[^A-Z_]/g, "");
    }

    function render(state) {
      $("campaignId").textContent = state.campaignId || campaignId || "No campaign yet";
      $("status").textContent = state.status || "IDLE";
      $("status").className = statusClass(state.status);
      $("total").textContent = state.total ?? 0;
      $("sent").textContent = state.sent ?? 0;
      $("failed").textContent = state.failed ?? 0;
      $("exhausted").textContent = state.exhausted ?? 0;

      const messages = state.messages || [];
      $("messages").innerHTML = messages.map((m) => {
        const status = m.status || "PENDING";
        const title = m.index === 0 ? "Approved fraud alert" : "Bad sender demo";
        const detail = m.lastError ? m.lastError : (m.messageId ? "Telnyx message id: " + m.messageId : "Waiting for provider response");
        return '<div class="message">' +
          '<div class="index">' + m.index + '</div>' +
          '<div><div class="msg-title">' + title + ' <span class="' + statusClass(status) + '">' + status + '</span></div>' +
          '<div class="msg-meta">' + detail + '</div>' +
          '<div class="msg-meta">' + (m.idempotencyKeys || []).length + ' idempotency key(s)</div></div>' +
          '<div class="attempts"><b>' + (m.attempts || 0) + '</b>attempts</div>' +
          '</div>';
      }).join("");

      if (state.status === "RETRYING") {
        $("note").textContent = "This is the key moment: the actor has saved the campaign state and is waiting to retry only failed messages.";
      } else if (state.status === "PARTIAL_FAILURE") {
        $("note").textContent = "Final audit state: successful messages were not duplicated, failed messages exhausted their retry budget, and notification completed if notifyError is null.";
      } else if (state.status === "COMPLETED") {
        $("note").textContent = "All messages were delivered and the actor has completed the campaign.";
      }
    }

    async function refresh() {
      if (!campaignId) return;
      const res = await fetch("/campaigns/" + encodeURIComponent(campaignId));
      if (!res.ok) throw new Error("GET failed: HTTP " + res.status);
      render(await res.json());
    }

    async function startDemo() {
      $("start").disabled = true;
      campaignId = "fraud-alert-demo-" + Math.floor(Date.now() / 1000);
      const body = {
      campaignId,
        messages: [
          {
            to: "devrel-inbox+approved-" + campaignId + "@qsywfrdyuwdo.msgtelnyx.com",
            subject: "Fraud alert: suspicious card activity",
            text: "Suspicious card activity detected. Please review your account."
          },
          {
            to: "devrel-inbox+bad-sender-" + campaignId + "@qsywfrdyuwdo.msgtelnyx.com",
            from: "alerts@definitely-unverified-codex.invalid",
            subject: "Fraud alert: suspicious card activity",
            text: "Suspicious card activity detected. Please review your account."
          }
        ]
      };
      const res = await fetch("/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const text = await res.text();
        const active = text.match(/campaign \(([^)]+)\) is already active/i);
        if (res.status === 409 && active) {
          campaignId = active[1];
          $("note").textContent = "Another campaign is already active, so this dashboard loaded it instead.";
          await refresh();
          $("start").disabled = false;
          return;
        }
        $("start").disabled = false;
        throw new Error("POST failed: HTTP " + res.status + " " + text);
      }
      $("terminal").textContent = [
        'BASE="' + base + '"',
        'CAMPAIGN_ID="' + campaignId + '"',
        '',
        'curl -sS "$BASE/campaigns/$CAMPAIGN_ID" | jq ' + JSON.stringify('{campaignId,status,total,sent,failed,exhausted,notifyError,messages:[.messages[]|{index,status,attempts,lastError,messageId,idempotencyKeys}]}')
      ].join("\n");
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await refresh();
      clearInterval(pollTimer);
      pollTimer = setInterval(() => refresh().catch(console.error), 5000);
      $("start").disabled = false;
    }

    $("start").addEventListener("click", () => startDemo().catch((err) => {
      $("note").textContent = err.message;
      $("start").disabled = false;
    }));
    $("refresh").addEventListener("click", () => refresh().catch((err) => $("note").textContent = err.message));
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
