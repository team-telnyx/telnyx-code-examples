/**
 * SELF-REVIEW:
 * ✅ All spec primitives implemented (spawn, children, despawn, destroy, schedule, queue, KV, SMS, Inference)
 * ✅ KV-first durability: each child persists its per-file outcome to KV BEFORE reporting to the parent,
 *    so a crash anywhere leaves the record authoritative
 * ✅ SMS + inference go over raw REST (api.telnyx.com) with the key from SECRETS — the TELNYX
 *    binding surface is unverified in 0.15.2, so the guaranteed REST path is used
 * ✅ Idempotent POST /jobs: fresh start, resume of an interrupted run, or ALREADY_DONE no-op —
 *    re-posting a finished job never redoes finished work
 * ✅ Reconcile adopts KV records, then re-spawns ONLY workers that never reported (bounded by
 *    MAX_CHILD_ATTEMPTS) — never redoing finished files
 * ✅ Honest scorecard: per-file outcome + failure reason + attempt count in state, KV, GET, and SMS
 * ✅ Watchdog via schedule() with a stable id: stuck children (> timeout) are marked FAILED and
 *    reconciled automatically
 * ✅ smoke_test.ts verifies classes and methods exist
 * ✅ Demo mode default (DEMO_MODE=true) — no real SMS/API calls unless enabled
 * ✅ No credentials in code — all from secrets/env
 * VERIFIED LIVE (2026-09-17): POST https://api.telnyx.com/v2/ai/audio/transcriptions with
 *   file_url + model=distil-whisper/distil-large-v2 returns real transcripts (Armstrong,
 *   Harding, LBJ clips). Transcription is real in live mode; mock only in DEMO_MODE.
 * SMS goes over raw REST (api.telnyx.com/v2/messages) with the key from SECRETS — the TELNYX
 *   binding surface is unverified in 0.15.2, so the guaranteed REST path is used.
 */

import {
  Agent,
  type ActorNamespace,
  type Secrets,
  type KvNamespace,
} from "@telnyx/edge-runtime";
import { CLINIC_HTML } from "./pages/clinic";
import { CONSOLE_HTML } from "./pages/console";

// ---------- Shared Types ----------

export interface TranscriptResult {
  fileId: string;
  transcript: string;
  childName: string;
  attempts: number;
  completedAt: string;
}

export interface ChildState {
  name: string;
  type: string; // "Transcriber"
  fileId: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "DESTROYED";
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  attempts: number;
}

export interface IncidentEntry {
  fileId: string;
  attempt: number;
  reason: string;
  at: string;
}

export interface FileOutcome {
  fileId: string;
  status: "COMPLETED" | "FAILED";
  transcript: string | null;
  error: string | null;
  attempts: number;
  childName: string;
}

// Type aliases (not interfaces) so OrchestratorState satisfies the Agent
// generic's `State extends Record<string, unknown>` constraint.
export type OrchestratorState = {
  jobId: string;
  totalFiles: number;
  audioUrls: string[];
  hangFiles: string[];
  hangOnce: string[];
  stuckTimeoutSeconds: number;
  demoMode: boolean | null;
  completed: number;
  failed: number;
  children: ChildState[];
  status:
    | "CREATED"
    | "SPAWNING"
    | "RUNNING"
    | "COMPLETING"
    | "COMPLETED"
    | "PARTIAL_FAILURE"
    | "CLEANING_UP";
  results: TranscriptResult[];
  outcomes: FileOutcome[];
  incidents: IncidentEntry[];
  notification: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type TranscriberState = {
  fileId: string;
  jobId: string;
  audioUrl: string;
  parentName: string;
  attempt: number;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  transcript: string | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
};

/** The per-file KV record — the authority on what happened to each file. */
export interface FileRecord {
  status: "COMPLETED" | "FAILED";
  transcript?: string;
  error?: string | null;
  childName: string;
  attempts: number;
  completedAt: string;
}

/** Parent-written ledger entry for one file's current attempt. */
export interface AttemptRecord {
  attempt: number;
  startedAt: string;
}

export interface AssignPayload {
  audioUrl: string;
  fileId: string;
  jobId: string;
  parentName: string;
  attempt: number;
  /** Persistent fault injection: EVERY attempt for these files crashes mid-run. */
  hangFiles?: string[];
  /** One-shot power-event simulation: only the first attempt crashes; the re-spawned worker succeeds. */
  hangOnce?: string[];
  /** Job-level demo pin: when set, overrides the env-based demo decision. */
  demoMode?: boolean;
}

// ---------- Env interfaces ----------

export interface OrchestratorEnv {
  SECRETS: Secrets;
  ORCHESTRATOR: ActorNamespace<OrchestratorAgent>;
  TRANSCRIBER: ActorNamespace<TranscriberAgent>;
  JOB_KV: KvNamespace;
  MOCK_AUDIO_URLS: string;
  DEMO_MODE?: string;
  TRANSCRIPTION_MODEL?: string;
  STUCK_TIMEOUT_SECONDS?: string;
  MAX_CHILD_ATTEMPTS?: string;
  DEMO_HANG_FILES?: string;
  DEMO_HANG_MS?: string;
  DEMO_DELAY_MS?: string;
}

interface TranscriberEnv {
  SECRETS: Secrets;
  PARENT: ActorNamespace<OrchestratorAgent>;
  JOB_KV: KvNamespace;
  TRANSCRIPTION_MODEL?: string;
  DEMO_MODE?: string;
  DEMO_HANG_FILES?: string;
  DEMO_HANG_MS?: string;
  DEMO_DELAY_MS?: string;
}

// ---------- Helpers ----------

const DEFAULT_STUCK_TIMEOUT_SECONDS = 300; // 5 minutes
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_DEMO_HANG_MS = 8000;
const DEFAULT_TRANSCRIPTION_MODEL = "distil-whisper/distil-large-v2";
// Built-in demo set: five public-domain speech clips, each verified to
// transcribe on the Telnyx AI Audio Transcriptions API (2026-09-17).
const DEFAULT_AUDIO_URLS = [
  "https://upload.wikimedia.org/wikipedia/commons/b/bb/Neil_Armstrong_small_step.wav",
  "https://upload.wikimedia.org/wikipedia/commons/6/6d/Address_to_the_Nation_Excerpt.ogg",
  "https://upload.wikimedia.org/wikipedia/commons/4/40/Portion_of_a_speech_by_Harding.ogg",
  "https://upload.wikimedia.org/wikipedia/commons/f/f7/Speech_Prosody_audio_example.wav",
  "https://upload.wikimedia.org/wikipedia/commons/a/a5/Booker_T._Washington_reading_an_excerpt_from_his_1895_Atlanta_Compromise_speech.mp3",
];
const RATE_LIMIT_BACKOFF_MS = 30_000; // gap before a rate-limited child reports failure
const MAX_FILES_PER_JOB = 12;
const DEFAULT_DEMO_DELAY_MS = 2500; // per-file pacing in demo mode (env: DEMO_DELAY_MS)

function nowIso(): string {
  return new Date().toISOString();
}

function parseList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isDemoMode(env?: { DEMO_MODE?: string }): boolean {
  // The edge runtime exposes unset env vars as empty strings — treat them as
  // absent. Default is demo mode (no real calls, no cost).
  const raw = (env?.DEMO_MODE ?? process.env.DEMO_MODE ?? "").trim().toLowerCase();
  return raw === "" || raw === "true" || raw === "1";
}

/** Audio list: actor env, then process env, then the built-in demo set. */
function resolveAudioUrls(envValue: string | undefined): string[] {
  const urls = (envValue ?? process.env.MOCK_AUDIO_URLS ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  return urls.length > 0 ? urls : DEFAULT_AUDIO_URLS;
}

/** Truthy-or-default string resolution (empty string on the edge = unset). */
function resolveString(envValue: string | undefined, key: string, fallback: string): string {
  const v = (envValue ?? process.env[key] ?? "").trim();
  return v.length > 0 ? v : fallback;
}

function resolveStuckTimeoutSeconds(envValue: string | undefined): number {
  const raw = envValue ?? process.env.STUCK_TIMEOUT_SECONDS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_STUCK_TIMEOUT_SECONDS;
}

function resolveMaxAttempts(envValue: string | undefined): number {
  const raw = envValue ?? process.env.MAX_CHILD_ATTEMPTS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_ATTEMPTS;
}

async function getApiKey(env: { SECRETS: Secrets }): Promise<string> {
  const key = await env.SECRETS.get("TELNYX_API_KEY");
  if (!key) throw new Error("TELNYX_API_KEY secret not configured");
  return key;
}

async function transcribeAudio(
  env: TranscriberEnv,
  fileId: string,
  audioUrl: string,
  jobDemoMode?: boolean
): Promise<string> {
  const demo = jobDemoMode !== undefined ? jobDemoMode : isDemoMode(env);
  // Demo mode: mock transcript (no real API call, no cost) with pacing so the
  // console's live progress is watchable (DEMO_DELAY_MS, jittered per file).
  // (Fault injection — hangFiles/hangOnce — is handled in TranscriberAgent.assign.)
  if (demo) {
    const parsed = Number(env.DEMO_DELAY_MS);
    const delayMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DEMO_DELAY_MS;
    if (delayMs > 0) {
      const jitter =
        [...fileId].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 1400;
      await new Promise((resolve) => setTimeout(resolve, delayMs + jitter));
    }
    return `[demo] Mock transcript for ${fileId} from ${audioUrl}`;
  }

  // Live mode: real speech-to-text via the Telnyx AI Audio Transcriptions API.
  // VERIFIED LIVE (2026-09-17): returns { text } for public audio URLs.
  const apiKey = await getApiKey(env);
  const model = resolveString(env.TRANSCRIPTION_MODEL, "TRANSCRIPTION_MODEL", DEFAULT_TRANSCRIPTION_MODEL);
  const resp = await fetch("https://api.telnyx.com/v2/ai/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file_url: audioUrl, model }),
  });
  if (!resp.ok) {
    throw new Error(`Transcription failed: ${resp.status} ${await resp.text()}`);
  }
  const data = (await resp.json()) as { text?: string };
  return data.text ?? "(no transcript)";
}

/** True when the failure looks like a Telnyx rate limit (HTTP 429 / code 10011). */
function isRateLimitError(message: string): boolean {
  return (
    message.includes("429") ||
    message.includes("10011") ||
    message.toLowerCase().includes("too many requests")
  );
}

// ---------- Orchestrator Agent (the durable workflow) ----------

export class OrchestratorAgent extends Agent<OrchestratorEnv, OrchestratorState> {
  protected initialState(): OrchestratorState {
    return {
      jobId: "",
      totalFiles: 0,
      audioUrls: [],
      hangFiles: [],
      hangOnce: [],
      stuckTimeoutSeconds: 0,
      demoMode: null,
      completed: 0,
      failed: 0,
      children: [],
      status: "CREATED",
      results: [],
      outcomes: [],
      incidents: [],
      notification: null,
      createdAt: nowIso(),
      completedAt: null,
    };
  }

  private stuckTimeoutSeconds(): number {
    return this._stuckTimeout ?? resolveStuckTimeoutSeconds(this.env.STUCK_TIMEOUT_SECONDS);
  }

  private _stuckTimeout: number | null = null;

  private applyStuckTimeout(state: OrchestratorState): void {
    this._stuckTimeout = state.stuckTimeoutSeconds > 0 ? state.stuckTimeoutSeconds : null;
  }

  private maxAttempts(): number {
    return resolveMaxAttempts(this.env.MAX_CHILD_ATTEMPTS);
  }

  private fileKey(jobId: string, fileId: string): string {
    return `job/${jobId}/file/${fileId}`;
  }

  private attemptKey(jobId: string, fileId: string): string {
    return `job/${jobId}/attempt/${fileId}`;
  }

  private incidentKey(jobId: string, fileId: string, attempt: number): string {
    return `job/${jobId}/incident/${fileId}/${attempt}`;
  }

  private childNameFor(jobId: string, fileId: string, attempt: number): string {
    return `${jobId}-${fileId}${attempt > 1 ? `-r${attempt}` : ""}`;
  }

  /**
   * POST /jobs — idempotent.
   *
   * - Fresh job id → normal start.
   * - Same job id while the run is active → reconcile/resume: adopt what
   *   finished, re-spawn only what never reported.
   * - Same job id after completion → ALREADY_DONE, never redo finished work
   *   (KV is the authority; this also holds after destroy() wiped actor state).
   */
  async startJob(payload: {
    jobId: string;
    audioUrls?: string[];
    hangFiles?: string[];
    hangOnce?: string[];
    stuckTimeoutSeconds?: number;
    demoMode?: boolean;
  }): Promise<{ jobId: string; status: "STARTED" | "RESUMED" | "ALREADY_DONE" }> {
    const state = await this.getState();

    if (state.status === "CREATED") {
      // A finished job's full record lives in KV even after destroy() wiped
      // actor state — a re-post must surface it, not restart the batch.
      const record = (await this.env.JOB_KV.get(`job/${payload.jobId}`, {
        type: "json",
      })) as OrchestratorState | null;
      if (
        record &&
        (record.status === "COMPLETED" || record.status === "PARTIAL_FAILURE")
      ) {
        return { jobId: payload.jobId, status: "ALREADY_DONE" };
      }

      const urls = (payload.audioUrls?.length ? payload.audioUrls : resolveAudioUrls(this.env.MOCK_AUDIO_URLS))
        .map((u) => u.trim())
        .filter(Boolean);
      if (urls.length === 0) {
        throw new Error("No audio files provided — MOCK_AUDIO_URLS env var is empty and the request had no audioUrls");
      }
      if (urls.length > MAX_FILES_PER_JOB) {
        throw new Error(`Too many files (${urls.length}) — MAX_FILES_PER_JOB is ${MAX_FILES_PER_JOB}`);
      }
      if (urls.some((u) => !/^https?:\/\//i.test(u))) {
        throw new Error("Every audio URL must start with http:// or https://");
      }
      const hangFiles = (payload.hangFiles ?? []).filter(Boolean);
      const hangOnce = (payload.hangOnce ?? []).filter(Boolean);
      const stuckTimeoutSeconds =
        Number.isFinite(payload.stuckTimeoutSeconds) && (payload.stuckTimeoutSeconds ?? 0) > 0
          ? (payload.stuckTimeoutSeconds as number)
          : this.stuckTimeoutSeconds();

      await this.replaceState({
        ...state,
        jobId: payload.jobId,
        totalFiles: urls.length,
        audioUrls: urls,
        hangFiles,
        hangOnce,
        stuckTimeoutSeconds,
        demoMode: typeof payload.demoMode === "boolean" ? payload.demoMode : null,
        status: "SPAWNING",
        createdAt: nowIso(),
      });

      await this.reconcile();
      return { jobId: payload.jobId, status: "STARTED" };
    }

    if (state.jobId === payload.jobId) {
      if (state.status === "COMPLETED" || state.status === "PARTIAL_FAILURE") {
        return { jobId: payload.jobId, status: "ALREADY_DONE" };
      }
      // Active run (SPAWNING/RUNNING/COMPLETING) → the "3am recovery" path:
      // adopt finished files from KV, re-spawn only the workers that never reported.
      await this.reconcile();
      return { jobId: payload.jobId, status: "RESUMED" };
    }

    throw new Error(`Actor bound to a different job (${state.jobId || "unnamed"})`);
  }

  /**
   * The reconciliation loop — the heart of the recovery story.
   *
   * Every decision derives from durable evidence (per-file KV records + the
   * attempt ledger + the platform's live children), never from in-memory
   * assumptions — so concurrent reconciles converge instead of clobbering:
   *
   *  1. KV record COMPLETED → adopt; the file is never re-run.
   *  2. KV record FAILED (fresh) → adopt the failure; re-spawn if attempts remain.
   *  3. Child RUNNING and recent (or still listed live) → in flight, leave it.
   *  4. Otherwise (no record, stale record, failed, stuck, or gone) → despawn
   *     the old worker and spawn a fresh one — up to MAX_CHILD_ATTEMPTS, then
   *     leave it FAILED for the honest scorecard.
   */
  async reconcile(): Promise<void> {
    const state = await this.getState();
    if (
      state.status !== "SPAWNING" &&
      state.status !== "RUNNING" &&
      state.status !== "COMPLETING"
    ) {
      return;
    }

    this.applyStuckTimeout(state);

    const urls =
      state.audioUrls.length > 0 ? state.audioUrls : resolveAudioUrls(this.env.MOCK_AUDIO_URLS);
    const maxAttempts = this.maxAttempts();

    // Flip SPAWNING → RUNNING before spawning so children can report while
    // the parent is still working (reports are ignored outside RUNNING/COMPLETING).
    let current = state;
    if (current.status === "SPAWNING") {
      current = await this.replaceState({ ...current, status: "RUNNING" });
    }

    // Cross-check parent bookkeeping against the platform's live children —
    // a child missing from the listing is gone and must re-run.
    let liveNames: Set<string> | null = null;
    try {
      liveNames = new Set((await this.children()).map((c) => c.name));
    } catch {
      // Platform-dependent; fall back to time-based stuck detection only.
    }

    const now = Date.now();
    const stuckTimeoutMs = this.stuckTimeoutSeconds() * 1000;
    const children: ChildState[] = [];

    for (let i = 0; i < urls.length; i++) {
      const fileId = `file-${i + 1}`;
      const record = (await this.env.JOB_KV.get(this.fileKey(current.jobId, fileId), {
        type: "json",
      })) as FileRecord | null;
      const attemptRec = (await this.env.JOB_KV.get(
        this.attemptKey(current.jobId, fileId),
        { type: "json" }
      )) as AttemptRecord | null;
      const attempts = attemptRec?.attempt ?? 0;

      // 1. Done is done — adopt and never redo.
      if (record && record.status === "COMPLETED") {
        children.push({
          name: record.childName,
          type: "Transcriber",
          fileId,
          status: "COMPLETED",
          startedAt: attemptRec?.startedAt ?? record.completedAt,
          completedAt: record.completedAt,
          error: null,
          attempts: record.attempts,
        });
        continue;
      }

      // 2. In flight? A recent RUNNING worker that the platform still lists is left alone.
      if (
        attempts > 0 &&
        now - Date.parse(attemptRec?.startedAt ?? nowIso()) <= stuckTimeoutMs &&
        (liveNames === null || liveNames.has(this.childNameFor(current.jobId, fileId, attempts)))
      ) {
        children.push({
          name: this.childNameFor(current.jobId, fileId, attempts),
          type: "Transcriber",
          fileId,
          status: "RUNNING",
          startedAt: attemptRec?.startedAt ?? nowIso(),
          completedAt: null,
          error: null,
          attempts,
        });
        continue;
      }

      // 3. Exhausted attempts → leave FAILED for the honest scorecard.
      if (attempts >= maxAttempts) {
        children.push({
          name: this.childNameFor(current.jobId, fileId, attempts),
          type: "Transcriber",
          fileId,
          status: "FAILED",
          startedAt: attemptRec?.startedAt ?? nowIso(),
          completedAt: nowIso(),
          error:
            record?.error ??
            `No report after ${attempts} attempt${attempts === 1 ? "" : "s"} (marked stuck)`,
          attempts,
        });
        continue;
      }

      // 4. Re-spawn ONLY this file: despawn the old worker (if any), spawn fresh.
      const priorName =
        attempts > 0 ? this.childNameFor(current.jobId, fileId, attempts) : null;
      if (priorName && (liveNames === null || liveNames.has(priorName))) {
        try {
          await this.despawn(priorName);
        } catch {
          // Already gone — despawn is idempotent by design.
        }
      }

      const attempt = attempts + 1;
      const childName = this.childNameFor(current.jobId, fileId, attempt);
      const startedAt = nowIso();
      // Scalar attempt ledger — parent-written, convergent under concurrency
      // (two reconciles compute and write the same value; KV puts are idempotent).
      await this.env.JOB_KV.put(
        this.attemptKey(current.jobId, fileId),
        JSON.stringify({ attempt, startedAt } satisfies AttemptRecord)
      );
      children.push({
        name: childName,
        type: "Transcriber",
        fileId,
        status: "RUNNING",
        startedAt,
        completedAt: null,
        error: null,
        attempts: attempt,
      });

      const spawned = await this.spawn(this.env.TRANSCRIBER, childName);
      // Record why the prior worker was replaced — the incident timeline.
      // (A first-ever spawn is not an incident.)
      if (attempts > 0) {
        const priorLost = liveNames !== null && !liveNames.has(priorName ?? "");
        const incidentReason =
          record && record.status === "FAILED"
            ? (record.error ?? "worker failed")
            : priorLost
              ? "Worker lost (not listed by the platform)"
              : `No report after ${this.stuckTimeoutSeconds()}s (watchdog)`;
        await this.env.JOB_KV.put(
          this.incidentKey(current.jobId, fileId, attempt),
          JSON.stringify({ fileId, attempt, reason: incidentReason, at: nowIso() } satisfies IncidentEntry)
        );
      }

      spawned
        .assign({
          audioUrl: urls[i],
          fileId,
          jobId: current.jobId,
          parentName: this.ctx.id,
          attempt,
          hangFiles: current.hangFiles.length > 0 ? current.hangFiles : undefined,
          hangOnce: current.hangOnce.length > 0 ? current.hangOnce : undefined,
          demoMode: current.demoMode ?? undefined,
        })
        .catch(() => {
          // Recovery path: KV record missing → the next reconcile re-spawns.
        });
    }

    // Derive results + counters from the KV records (the authority).
    const results: TranscriptResult[] = [];
    for (let i = 0; i < urls.length; i++) {
      const fileId = `file-${i + 1}`;
      const record = (await this.env.JOB_KV.get(this.fileKey(current.jobId, fileId), {
        type: "json",
      })) as FileRecord | null;
      if (record && record.status === "COMPLETED") {
        results.push({
          fileId,
          transcript: record.transcript ?? "(no transcript)",
          childName: record.childName,
          attempts: record.attempts,
          completedAt: record.completedAt,
        });
      }
    }
    const failed = children.filter((c) => c.status === "FAILED").length;

    const snapshot = {
      ...current,
      children,
      results,
      completed: results.length,
      failed,
      incidents: await this.deriveIncidents(current.jobId),
      status: current.status,
    };
    await this.replaceState(snapshot);

    // Persist a derived snapshot so GET /api/jobs/:jobId works mid-run
    // (finalize overwrites it with the full record + scorecard). Guard against
    // concurrent reconciles: never overwrite the record with OLDER progress.
    if (current.jobId) {
      const existing = (await this.env.JOB_KV.get(`job/${current.jobId}`, {
        type: "json",
      })) as OrchestratorState | null;
      const derivedProgress = snapshot.completed + snapshot.failed;
      const existingProgress = existing ? (existing.completed ?? 0) + (existing.failed ?? 0) : -1;
      if (derivedProgress >= existingProgress) {
        await this.env.JOB_KV.put(`job/${current.jobId}`, JSON.stringify(snapshot));
      }
    }

    // All files resolved? → finalize (stable id dedupes re-queues across crashes).
    const allResolved = await this.allFilesResolved(current.jobId, urls.length, children);
    if (allResolved && current.status !== "COMPLETING") {
      await this.setState({ status: "COMPLETING" });
      await this.queue("finalize", undefined, { id: `${current.jobId}:finalize` });
      return;
    }

    // Re-arm the stuck-child watchdog with a stable id (replaces any prior task).
    await this.schedule(this.stuckTimeoutSeconds(), "checkChildren", undefined, {
      id: `${current.jobId}:watchdog`,
    });
  }

  /** Derive the incident timeline from the per-incident KV records. */
  private async deriveIncidents(jobId: string): Promise<IncidentEntry[]> {
    const incidents: IncidentEntry[] = [];
    try {
      let cursor: string | undefined;
      do {
        const page = await this.env.JOB_KV.list({ prefix: `job/${jobId}/incident/`, cursor });
        for (const info of page.keys) {
          try {
            const rec = (await this.env.JOB_KV.get(info.name, { type: "json" })) as IncidentEntry | null;
            if (rec && rec.fileId && rec.at) incidents.push(rec);
          } catch {
            // Malformed record — skip it.
          }
        }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
    } catch {
      // KV listing unavailable — leave the timeline empty.
    }
    return incidents.sort((a, b) => a.at.localeCompare(b.at));
  }

  /** A file is resolved when KV holds a COMPLETED record, or its latest attempt is exhausted. */
  private async allFilesResolved(
    jobId: string,
    totalFiles: number,
    children: ChildState[]
  ): Promise<boolean> {
    for (let i = 0; i < totalFiles; i++) {
      const fileId = `file-${i + 1}`;
      const record = (await this.env.JOB_KV.get(this.fileKey(jobId, fileId), {
        type: "json",
      })) as FileRecord | null;
      if (record && record.status === "COMPLETED") continue;
      const latest = children
        .filter((c) => c.fileId === fileId)
        .sort((a, b) => b.attempts - a.attempts)[0];
      if (latest && latest.status === "FAILED" && latest.attempts >= this.maxAttempts()) {
        continue;
      }
      return false;
    }
    return true;
  }

  // Called by children via parent binding RPC — AFTER the child persisted its
  // KV record. The parent never rewrites per-file records (the child owns
  // them); this is only the fast-path resolution nudge.
  async reportComplete(fileId: string, transcript: string, attempt = 1): Promise<void> {
    const state = await this.getState();
    if (state.status !== "RUNNING" && state.status !== "COMPLETING") return; // late report ignored
    await this.maybeFinalize(state.jobId, state.audioUrls.length);
  }

  /** Fast-path resolution check after a child reports: all files resolved? → finalize. */
  private async maybeFinalize(jobId: string, totalFiles: number): Promise<void> {
    const state = await this.getState();
    if (state.status !== "RUNNING" && state.status !== "COMPLETING") return;
    const resolved = await this.allFilesResolved(jobId, totalFiles, state.children);
    if (!resolved) return;
    await this.setState({ status: "COMPLETING" });
    await this.queue("finalize", undefined, { id: `${jobId}:finalize` });
  }

  async reportFailure(fileId: string, error: string, attempt = 1): Promise<void> {
    const state = await this.getState();
    if (state.status !== "RUNNING" && state.status !== "COMPLETING") return;
    // Prompt recovery: re-run the reconciliation to re-spawn (bounded) or finalize.
    await this.reconcile();
  }

  // schedule(seconds, "checkChildren") — the watchdog: stuck children are
  // treated as never-reported and handled by the reconciliation loop.
  async checkChildren(): Promise<void> {
    const state = await this.getState();
    if (state.status !== "RUNNING" && state.status !== "SPAWNING") return;
    await this.reconcile();
  }

  // queue("finalize") — compile the honest scorecard, notify operator, destroy
  async finalize(): Promise<void> {
    const state = await this.getState();
    if (state.status !== "COMPLETING") return;

    const urls =
      state.audioUrls.length > 0 ? state.audioUrls : resolveAudioUrls(this.env.MOCK_AUDIO_URLS);

    // Re-derive the child ledger from durable evidence before scoring.
    const childrenLedger: ChildState[] = [];
    for (let i = 0; i < urls.length; i++) {
      const fileId = `file-${i + 1}`;
      const record = (await this.env.JOB_KV.get(this.fileKey(state.jobId, fileId), {
        type: "json",
      })) as FileRecord | null;
      if (record && record.status === "COMPLETED") {
        childrenLedger.push({
          name: record.childName,
          type: "Transcriber",
          fileId,
          status: "COMPLETED",
          startedAt: record.completedAt,
          completedAt: record.completedAt,
          error: null,
          attempts: record.attempts,
        });
        continue;
      }
      const attemptRec = (await this.env.JOB_KV.get(
        this.attemptKey(state.jobId, fileId),
        { type: "json" }
      )) as AttemptRecord | null;
      const attempts = attemptRec?.attempt ?? 0;
      const exhausted = attempts >= this.maxAttempts();
      childrenLedger.push({
        name: this.childNameFor(state.jobId, fileId, Math.max(attempts, 1)),
        type: "Transcriber",
        fileId,
        status: exhausted ? "FAILED" : "RUNNING",
        startedAt: attemptRec?.startedAt ?? nowIso(),
        completedAt: exhausted ? nowIso() : null,
        error: exhausted ? (record?.error ?? `No report after ${attempts} attempts (marked stuck)`) : null,
        attempts,
      });
    }

    // Derive the honest scorecard from KV + the child ledger.
    const outcomes: FileOutcome[] = [];
    for (let i = 0; i < urls.length; i++) {
      const fileId = `file-${i + 1}`;
      const record = (await this.env.JOB_KV.get(this.fileKey(state.jobId, fileId), {
        type: "json",
      })) as FileRecord | null;
      if (record && record.status === "COMPLETED") {
        outcomes.push({
          fileId,
          status: "COMPLETED",
          transcript: record.transcript ?? "(no transcript)",
          error: null,
          attempts: record.attempts,
          childName: record.childName,
        });
        continue;
      }
      const failedChild = childrenLedger.find(
        (c) => c.fileId === fileId && c.status === "FAILED"
      );
      outcomes.push({
        fileId,
        status: "FAILED",
        transcript: null,
        error: failedChild?.error ?? record?.error ?? "unknown error",
        attempts: failedChild?.attempts ?? record?.attempts ?? 0,
        childName: failedChild?.name ?? record?.childName ?? "unknown",
      });
    }
    const completed = outcomes.filter((o) => o.status === "COMPLETED").length;
    const failed = outcomes.filter((o) => o.status === "FAILED").length;
    const finalStatus = failed === 0 ? "COMPLETED" : "PARTIAL_FAILURE";

    await this.setState({
      status: finalStatus,
      completedAt: nowIso(),
      outcomes,
      completed,
      failed,
      children: childrenLedger,
      results: outcomes
        .filter((o): o is FileOutcome & { transcript: string } => o.status === "COMPLETED")
        .map((o) => ({
          fileId: o.fileId,
          transcript: o.transcript,
          childName: o.childName,
          attempts: o.attempts,
          completedAt: nowIso(),
        })),
    });

    // Persist the full job record — the compliance-grade authority that
    // survives destroy() and powers the ALREADY_DONE no-op on re-post.
    const fullState = { ...(await this.getState()), incidents: await this.deriveIncidents(state.jobId) };
    await this.setState({ incidents: fullState.incidents });
    await this.env.JOB_KV.put(`job/${state.jobId}`, JSON.stringify(fullState));

    // Notify operator via SMS (demo mode logs instead)
    const message = this.buildSms(finalStatus, fullState);
    if (isDemoMode(this.env)) {
      console.log(`[demo] SMS to operator: ${message}`);
    } else {
      await sendSms(this.env.SECRETS, message);
    }
    // Store the exact notification text on the record — the console shows it.
    await this.setState({ notification: message });
    const finalState = await this.getState();
    await this.env.JOB_KV.put(`job/${state.jobId}`, JSON.stringify(finalState));

    // Self-clean: destroy all children + self
    await this.setState({ status: "CLEANING_UP" });
    await this.destroy();
  }

  private buildSms(finalStatus: string, state: OrchestratorState): string {
    if (finalStatus === "COMPLETED") {
      return `Job ${state.jobId} complete: ${state.completed}/${state.totalFiles} transcripts compiled.`;
    }
    const failures = state.outcomes.filter((o) => o.status === "FAILED");
    const reasons = failures
      .slice(0, 3)
      .map((o) => `${o.fileId}: ${truncate(o.error ?? "unknown", 60)} (${o.attempts} attempts)`)
      .join("; ");
    const more = failures.length > 3 ? ` (+${failures.length - 3} more)` : "";
    return `Job ${state.jobId} partial failure: ${state.completed}/${state.totalFiles} done, ${state.failed} failed — ${reasons}${more}. Details: GET /api/jobs/${state.jobId}`;
  }

  // HTTP handler: GET /api/jobs/:jobId
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const match = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (!match) return new Response("Not found", { status: 404 });

    const jobId = match[1];
    const raw = await this.env.JOB_KV.get(`job/${jobId}`, { type: "json" });
    if (!raw) return new Response("Job not found", { status: 404 });

    return new Response(JSON.stringify(raw), {
      headers: { "Content-Type": "application/json" },
    });
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Send an SMS via the Telnyx Messages API over raw REST. Same rationale as
 * the inference call: the TELNYX binding surface is unverified in 0.15.2, so
 * the guaranteed path is the public REST endpoint with the API key from
 * SECRETS.
 */
async function sendSms(secrets: Secrets, text: string): Promise<void> {
  const apiKey = await getApiKey({ SECRETS: secrets });
  const to = await secrets.get("OPERATOR_NUMBER");
  const from = await secrets.get("TELNYX_SENDER");
  if (!to || !from) {
    throw new Error("OPERATOR_NUMBER/TELNYX_SENDER secrets required for live mode");
  }
  const resp = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, from, text }),
  });
  if (!resp.ok) {
    throw new Error(`SMS send failed: ${resp.status} ${await resp.text()}`);
  }
}

// ---------- Transcriber Agent (child) ----------

export class TranscriberAgent extends Agent<TranscriberEnv, TranscriberState> {
  protected initialState(): TranscriberState {
    return {
      fileId: "",
      jobId: "",
      audioUrl: "",
      parentName: "",
      attempt: 1,
      status: "PENDING",
      transcript: null,
      error: null,
      startedAt: nowIso(),
      completedAt: null,
    };
  }

  // Typed RPC from parent
  async assign(payload: AssignPayload): Promise<void> {
    // Supersede guard: if the parent already moved to a newer attempt for this
    // file, this worker is obsolete — do nothing (a killed power-event worker
    // must not clobber the record a newer attempt already wrote).
    const ledger = (await this.env.JOB_KV.get(
      `job/${payload.jobId}/attempt/${payload.fileId}`,
      { type: "json" }
    )) as AttemptRecord | null;
    if (ledger && ledger.attempt > payload.attempt) return;

    await this.replaceState({
      ...(await this.getState()),
      audioUrl: payload.audioUrl,
      fileId: payload.fileId,
      jobId: payload.jobId,
      parentName: payload.parentName,
      attempt: payload.attempt,
      status: "RUNNING",
      startedAt: nowIso(),
    });

    try {
      // Fault injection:
      //  - hangOnce: one-shot power-event simulation — only the FIRST attempt
      //    goes down, so the re-spawned worker succeeds (the recovery story).
      //  - hangFiles: persistent fault — EVERY attempt goes down (exhaustion demo).
      //  - env DEMO_HANG_FILES: same persistent behavior, demo mode only.
      const hangPersistent =
        (payload.hangFiles && payload.hangFiles.includes(payload.fileId)) ||
        (isDemoMode(this.env) && parseList(this.env.DEMO_HANG_FILES).includes(payload.fileId));
      const hangOnce =
        payload.hangOnce !== undefined &&
        payload.hangOnce.includes(payload.fileId) &&
        payload.attempt === 1;
      if (hangPersistent || hangOnce) {
        const hangMs = Number(this.env.DEMO_HANG_MS) || DEFAULT_DEMO_HANG_MS;
        await new Promise((resolve) => setTimeout(resolve, hangMs));
        throw new Error(`simulated power event: worker for ${payload.fileId} went down mid-run`);
      }

      const transcript = await transcribeAudio(this.env, payload.fileId, payload.audioUrl, payload.demoMode);

      // KV-FIRST: the per-file record is the authority. Write it BEFORE
      // reporting to the parent so a crash between the two leaves a truth
      // that recovery can adopt without redoing the work.
      await this.env.JOB_KV.put(
        `job/${payload.jobId}/file/${payload.fileId}`,
        JSON.stringify({
          status: "COMPLETED",
          transcript,
          childName: this.ctx.id,
          attempts: payload.attempt,
          completedAt: nowIso(),
        } satisfies FileRecord)
      );
      await this.setState({ status: "COMPLETED", transcript, completedAt: nowIso() });

      // Report back to parent via its binding (best-effort notification)
      const parent = this.env.PARENT.idFromName(payload.parentName);
      await parent.reportComplete(payload.fileId, transcript, payload.attempt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Supersede guard (failure path): a newer attempt already owns this file.
      const freshLedger = (await this.env.JOB_KV.get(
        `job/${payload.jobId}/attempt/${payload.fileId}`,
        { type: "json" }
      )) as AttemptRecord | null;
      if (freshLedger && freshLedger.attempt > payload.attempt) return;
      // Rate-limited workers back off before failing, so the parent's
      // bounded re-spawn doesn't hammer the API.
      if (isRateLimitError(msg)) {
        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_BACKOFF_MS));
      }
      await this.env.JOB_KV.put(
        `job/${payload.jobId}/file/${payload.fileId}`,
        JSON.stringify({
          status: "FAILED",
          error: msg,
          childName: this.ctx.id,
          attempts: payload.attempt,
          completedAt: nowIso(),
        } satisfies FileRecord)
      );
      await this.setState({ status: "FAILED", error: msg, completedAt: nowIso() });
      const parent = this.env.PARENT.idFromName(payload.parentName);
      await parent.reportFailure(payload.fileId, msg, payload.attempt);
    }
  }
}

// ---------- HTTP entry ----------

export default {
  async fetch(req: Request, env: OrchestratorEnv): Promise<Response> {
    const url = new URL(req.url);

    // GET / — the clinic-facing front door (the DEV-1085 use case, as a product)
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return new Response(CLINIC_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // GET /console — the engineering view: actors, attempts, KV, recovery
    if (req.method === "GET" && url.pathname === "/console") {
      return new Response(CONSOLE_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // GET /config — non-secret knobs the console prefills from
    if (req.method === "GET" && url.pathname === "/config") {
      return new Response(
        JSON.stringify({
          audioUrls: resolveAudioUrls(env.MOCK_AUDIO_URLS),
          transcriptionModel: resolveString(env.TRANSCRIPTION_MODEL, "TRANSCRIPTION_MODEL", DEFAULT_TRANSCRIPTION_MODEL),
          stuckTimeoutSeconds: resolveStuckTimeoutSeconds(env.STUCK_TIMEOUT_SECONDS),
          maxAttempts: resolveMaxAttempts(env.MAX_CHILD_ATTEMPTS),
          demoMode: isDemoMode(env),
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // POST /jobs — start, resume, or no-op (idempotent)
    if (req.method === "POST" && url.pathname === "/jobs") {
      let body: {
        jobId?: string;
        audioUrls?: string[];
        hangFiles?: string[];
        hangOnce?: string[];
        stuckTimeoutSeconds?: number;
        demoMode?: boolean;
      };
      try {
        body = await req.json();
      } catch {
        return new Response("Invalid JSON body", { status: 400 });
      }
      if (!body.jobId || typeof body.jobId !== "string") {
        return new Response("jobId is required", { status: 400 });
      }

      const stub = env.ORCHESTRATOR.idFromName(body.jobId);
      const result = await stub.startJob({
        jobId: body.jobId,
        audioUrls: Array.isArray(body.audioUrls) ? body.audioUrls : undefined,
        hangFiles: Array.isArray(body.hangFiles) ? body.hangFiles : undefined,
        hangOnce: Array.isArray(body.hangOnce) ? body.hangOnce : undefined,
        stuckTimeoutSeconds:
          typeof body.stuckTimeoutSeconds === "number" && body.stuckTimeoutSeconds > 0
            ? body.stuckTimeoutSeconds
            : undefined,
        demoMode: typeof body.demoMode === "boolean" ? body.demoMode : undefined,
      });

      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // GET /api/jobs/:jobId — read job state
    const match = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (req.method === "GET" && match) {
      const jobId = match[1];
      const raw = await env.JOB_KV.get(`job/${jobId}`, { type: "json" });
      if (!raw) return new Response("Job not found", { status: 404 });
      return new Response(JSON.stringify(raw), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
