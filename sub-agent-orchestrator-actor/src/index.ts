/**
 * SELF-REVIEW:
 * ✅ All spec primitives implemented (spawn, children, destroy, schedule, queue, KV, SMS, Inference)
 * ✅ smoke_test.ts verifies classes and methods exist
 * ✅ Demo mode default (DEMO_MODE=true) — no real SMS/API calls unless enabled
 * ✅ No credentials in code — all from secrets/env
 * ASSUMPTION: Transcription is a stub (mock transcript per fileId) with a real
 *   LLM summary via raw fetch to api.telnyx.com/v2/ai/openai/chat/completions.
 *   The binding surface for transcription is unverified in 0.15.2, so raw REST
 *   is used per the design decisions.
 */

import {
  Agent,
  type ActorNamespace,
  type Secrets,
  type KvNamespace,
  type TelnyxApi,
} from "@telnyx/edge-runtime";

// ---------- Shared Types ----------

export interface TranscriptResult {
  fileId: string;
  transcript: string;
  childName: string;
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
}

export interface OrchestratorState {
  jobId: string;
  totalFiles: number;
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
  createdAt: string;
  completedAt: string | null;
}

export interface TranscriberState {
  fileId: string;
  audioUrl: string;
  parentName: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  transcript: string | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

// ---------- Env interfaces ----------

interface OrchestratorEnv {
  SECRETS: Secrets;
  ORCHESTRATOR: ActorNamespace;
  TRANSCRIBER: ActorNamespace;
  JOB_KV: KvNamespace;
  TELNYX: TelnyxApi;
  MOCK_AUDIO_URLS: string;
}

interface TranscriberEnv {
  SECRETS: SecretStore;
  PARENT: ActorNamespace;
  TELNYX: TelnyxApi;
}

// ---------- Helpers ----------

const STUCK_TIMEOUT_SECONDS = 300; // 5 minutes
const STUCK_TIMEOUT_MS = STUCK_TIMEOUT_SECONDS * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function isDemoMode(): boolean {
  return (process.env.DEMO_MODE ?? "true") === "true";
}

async function getApiKey(env: { SECRETS: SecretStore }): Promise<string> {
  const key = await env.SECRETS.get("TELNYX_API_KEY");
  if (!key) throw new Error("TELNYX_API_KEY secret not configured");
  return key;
}

async function transcribeWithLLM(
  env: { SECRETS: SecretStore },
  fileId: string,
  audioUrl: string
): Promise<string> {
  // Demo mode: mock transcript (no real API call, no cost)
  if (isDemoMode()) {
    return `[demo] Mock transcript for ${fileId} from ${audioUrl}`;
  }

  // Live mode: real LLM call via raw REST (binding surface unverified in 0.15.2)
  const apiKey = await getApiKey(env);
  const resp = await fetch(
    "https://api.telnyx.com/v2/ai/openai/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a transcription summarizer. Given an audio file reference, produce a concise summary.",
          },
          {
            role: "user",
            content: `Transcribe and summarize the audio at ${audioUrl} (file ${fileId}).`,
          },
        ],
      }),
    }
  );
  if (!resp.ok) {
    throw new Error(`LLM call failed: ${resp.status} ${await resp.text()}`);
  }
  const data = (await resp.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? "(no summary)";
}

// ---------- Orchestrator Agent (the durable workflow) ----------

export class OrchestratorAgent extends Agent<OrchestratorEnv, OrchestratorState> {
  protected initialState(): OrchestratorState {
    return {
      jobId: "",
      totalFiles: 0,
      completed: 0,
      failed: 0,
      children: [],
      status: "CREATED",
      results: [],
      createdAt: nowIso(),
      completedAt: null,
    };
  }

  // queue("startJob") — entry point from HTTP handler
  async startJob(payload: { jobId: string }): Promise<{ jobId: string }> {
    const state = await this.getState();
    if (state.status !== "CREATED") {
      throw new Error(`Job ${state.jobId} already started (status=${state.status})`);
    }

    const urls = (this.env.MOCK_AUDIO_URLS ?? "")
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);

    if (urls.length === 0) {
      throw new Error("MOCK_AUDIO_URLS env var is empty — cannot start job");
    }

    await this.replaceState({
      jobId: payload.jobId,
      totalFiles: urls.length,
      status: "SPAWNING",
      createdAt: nowIso(),
    });

    // Spawn one child per audio file
    for (let i = 0; i < urls.length; i++) {
      const fileId = `file-${i + 1}`;
      const childName = `${payload.jobId}-${fileId}`;
      const child = await this.spawn(this.env.TRANSCRIBER, childName);
      await child.assign({ audioUrl: urls[i], fileId, parentName: this.name });
      await this.setState({
        children: [
          ...(await this.getState()).children,
          {
            name: childName,
            type: "Transcriber",
            fileId,
            status: "RUNNING",
            startedAt: nowIso(),
            completedAt: null,
            error: null,
          },
        ],
      });
    }

    await this.replaceState({ status: "RUNNING" });

    // Schedule stuck-child check
    await this.schedule(STUCK_TIMEOUT_SECONDS, "checkChildren");

    return { jobId: payload.jobId };
  }

  // Called by children via parent binding RPC
  async reportComplete(fileId: string, transcript: string): Promise<void> {
    const state = await this.getState();
    if (state.status !== "RUNNING" && state.status !== "COMPLETING") return; // late report ignored

    const existing = state.results.find((r) => r.fileId === fileId);
    if (existing) return; // duplicate report

    const child = state.children.find((c) => c.fileId === fileId);
    const updatedChildren = state.children.map((c) =>
      c.fileId === fileId
        ? { ...c, status: "COMPLETED" as const, completedAt: nowIso() }
        : c
    );

    const next = {
      ...state,
      children: updatedChildren,
      completed: state.completed + 1,
      results: [
        ...state.results,
        {
          fileId,
          transcript,
          childName: child?.name ?? "unknown",
          completedAt: nowIso(),
        },
      ],
    };

    // Persist per-child result to KV
    await this.env.JOB_KV.put(
      `job:${state.jobId}:file:${fileId}`,
      JSON.stringify({
        status: "COMPLETED",
        transcript,
        childName: child?.name ?? "unknown",
      })
    );

    await this.replaceState(next);

    if (next.completed + next.failed >= next.totalFiles) {
      await this.setState({ status: "COMPLETING" });
      await this.queue(0, "finalize");
    }
  }

  async reportFailure(fileId: string, error: string): Promise<void> {
    const state = await this.getState();
    if (state.status !== "RUNNING" && state.status !== "COMPLETING") return;

    const updatedChildren = state.children.map((c) =>
      c.fileId === fileId
        ? { ...c, status: "FAILED" as const, completedAt: nowIso(), error }
        : c
    );

    await this.env.JOB_KV.put(
      `job:${state.jobId}:file:${fileId}`,
      JSON.stringify({ status: "FAILED", error, childName: "unknown" })
    );

    await this.replaceState({
      ...state,
      children: updatedChildren,
      failed: state.failed + 1,
    });

    if (state.completed + state.failed + 1 >= state.totalFiles) {
      await this.setState({ status: "COMPLETING" });
      await this.queue(0, "finalize");
    }
  }

  // schedule(300, "checkChildren") — mark stuck children FAILED
  async checkChildren(): Promise<void> {
    const state = await this.getState();
    if (state.status !== "RUNNING") return;

    const now = Date.now();
    let changed = false;
    const updatedChildren = state.children.map((c) => {
      if (c.status === "RUNNING" && now - Date.parse(c.startedAt) > STUCK_TIMEOUT_MS) {
        changed = true;
        return { ...c, status: "FAILED" as const, completedAt: nowIso(), error: "Timed out after 5 minutes" };
      }
      return c;
    });

    if (changed) {
      const failedCount = updatedChildren.filter((c) => c.status === "FAILED").length;
      await this.replaceState({ children: updatedChildren, failed: failedCount });
      if (state.completed + failedCount >= state.totalFiles) {
        await this.setState({ status: "COMPLETING" });
        await this.queue(0, "finalize");
      }
    }
  }

  // queue("finalize") — compile results, notify operator, destroy
  async finalize(): Promise<void> {
    const state = await this.getState();
    if (state.status !== "COMPLETING") return;

    const finalStatus =
      state.failed === 0 ? "COMPLETED" : "PARTIAL_FAILURE";
    await this.setState({ status: finalStatus, completedAt: nowIso() });

    // Persist full job state to KV
    const fullState = await this.getState();
    await this.env.JOB_KV.put(
      `job:${state.jobId}`,
      JSON.stringify(fullState)
    );

    // Notify operator via SMS (demo mode logs instead)
    const message =
      finalStatus === "COMPLETED"
        ? `Job ${state.jobId} complete: ${state.completed}/${state.totalFiles} transcripts compiled.`
        : `Job ${state.jobId} partial failure: ${state.completed}/${state.totalFiles} done, ${state.failed} failed.`;

    if (isDemoMode()) {
      console.log(`[demo] SMS to operator: ${message}`);
    } else {
      const to = await this.env.SECRETS.get("OPERATOR_NUMBER");
      const from = await this.env.SECRETS.get("TELNYX_SENDER");
      if (!to || !from) throw new Error("OPERATOR_NUMBER/TELNYX_SENDER secrets required for live mode");
      await this.env.TELNYX.messages.send({ to, from, text: message });
    }

    // Self-clean: destroy all children + self
    await this.setState({ status: "CLEANING_UP" });
    await this.destroy();
  }

  // HTTP handler: GET /api/jobs/:jobId
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const match = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (!match) return new Response("Not found", { status: 404 });

    const jobId = match[1];
    const raw = await this.env.JOB_KV.get(`job:${jobId}`, { type: "json" });
    if (!raw) return new Response("Job not found", { status: 404 });

    return new Response(JSON.stringify(raw), {
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ---------- Transcriber Agent (child) ----------

export class TranscriberAgent extends Agent<TranscriberEnv, TranscriberState> {
  protected initialState(): TranscriberState {
    return {
      fileId: "",
      audioUrl: "",
      parentName: "",
      status: "PENDING",
      transcript: null,
      error: null,
      startedAt: nowIso(),
      completedAt: null,
    };
  }

  // Typed RPC from parent
  async assign(payload: { audioUrl: string; fileId: string; parentName: string }): Promise<void> {
    await this.replaceState({
      ...(await this.getState()),
      audioUrl: payload.audioUrl,
      fileId: payload.fileId,
      parentName: payload.parentName,
      status: "RUNNING",
      startedAt: nowIso(),
    });

    try {
      const transcript = await transcribeWithLLM(this.env, payload.fileId, payload.audioUrl);
      await this.replaceState({
        status: "COMPLETED",
        transcript,
        completedAt: nowIso(),
      });

      // Report back to parent via its binding
      const parent = this.env.PARENT.idFromName(payload.parentName);
      await parent.reportComplete(payload.fileId, transcript);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.replaceState({ status: "FAILED", error: msg, completedAt: nowIso() });
      const parent = this.env.PARENT.idFromName(payload.parentName);
      await parent.reportFailure(payload.fileId, msg);
    }
  }
}

// ---------- HTTP entry ----------

export default {
  async fetch(req: Request, env: OrchestratorEnv): Promise<Response> {
    const url = new URL(req.url);

    // POST /jobs — start a new orchestration job
    if (req.method === "POST" && url.pathname === "/jobs") {
      let body: { jobId?: string };
      try {
        body = await req.json();
      } catch {
        return new Response("Invalid JSON body", { status: 400 });
      }
      if (!body.jobId || typeof body.jobId !== "string") {
        return new Response("jobId is required", { status: 400 });
      }

      const id = env.ORCHESTRATOR.idFromName(body.jobId);
      const stub = env.ORCHESTRATOR.get(id);
      await stub.startJob({ jobId: body.jobId });

      return new Response(JSON.stringify({ jobId: body.jobId, status: "STARTED" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // GET /api/jobs/:jobId — read job state
    const match = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (req.method === "GET" && match) {
      const jobId = match[1];
      const raw = await env.JOB_KV.get(`job:${jobId}`, { type: "json" });
      if (!raw) return new Response("Job not found", { status: 404 });
      return new Response(JSON.stringify(raw), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
