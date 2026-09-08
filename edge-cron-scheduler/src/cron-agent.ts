import { Agent } from "@telnyx/edge-runtime";
import type Telnyx from "telnyx";
import {
  type Job,
  nextRun,
  ordered,
  validateJob,
  ValidationError,
} from "./jobs.js";

export interface SchedulerEnv {
  TELNYX?: Pick<Telnyx, "calls" | "messages">;
  DEMO_MODE?: string;
  TELNYX_PHONE_NUMBER?: string;
  TELNYX_CONNECTION_ID?: string;
  NOTIFICATION_PHONE_NUMBER?: string;
  WEBHOOK_HOSTS?: string;
}
interface Execution {
  runId: string;
  job: Job;
  scheduledAt: string;
}
export class CronAgent extends Agent<SchedulerEnv> {
  // Dapr reminders use second precision. Keep SDK deadlines on that boundary
  // so an early, rounded reminder cannot arrive before its task is due.
  protected override now(): number {
    return Math.floor(Date.now() / 1000) * 1000;
  }

  // Return expected errors as data: RPC transports do not preserve custom Error classes.
  async mutate(
    action: "create" | "delete" | "run",
    input: unknown,
  ): Promise<
    { ok: true; value: Job | boolean | string } | { ok: false; error: string }
  > {
    try {
      const value =
        action === "create"
          ? await this.registerJob(input)
          : action === "delete"
            ? await this.deleteJob(String(input))
            : await this.runNow(String(input));
      return { ok: true, value };
    } catch (error) {
      if (error instanceof ValidationError)
        return { ok: false, error: error.message };
      throw error;
    }
  }
  private schema(): void {
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS executions (
      run_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL, result TEXT NOT NULL, notification TEXT NOT NULL,
      started_at TEXT NOT NULL, finished_at TEXT
    )`);
  }
  async initialize(): Promise<void> {
    this.schema();
    if (!(await this.listSchedules()).some((t) => t.id === "cron-poll")) {
      await this.every(60, "poll", undefined, { id: "cron-poll" });
    }
  }
  async status() {
    await this.initialize();
    const schedules = await this.listSchedules();
    const stalled = schedules.some((task) => task.due < this.now() - 60000);
    return {
      status: stalled ? "degraded" : "ok",
      demoMode: this.setting("DEMO_MODE") !== "false",
      jobs: (await this.getJobs()).length,
      schedules: schedules.map((t) => ({
        id: t.id,
        due: t.due,
        method: t.name,
      })),
    };
  }
  async getJobs(): Promise<Job[]> {
    return (await this.ctx.storage.get<Job[]>("jobs")) ?? [];
  }
  async registerJob(input: unknown): Promise<Job> {
    await this.initialize();
    const job = validateJob(input, this.now());
    const jobs = await this.getJobs();
    if (jobs.some((j) => j.id === job.id))
      throw new ValidationError(
        "Job ID already exists; delete it before replacing it",
      );
    if (jobs.length >= 100) throw new ValidationError("Maximum 100 jobs");
    ordered([...jobs, job]);
    await this.ctx.storage.put("jobs", [...jobs, job]);
    return job;
  }
  async deleteJob(id: string): Promise<boolean> {
    const jobs = await this.getJobs();
    if (jobs.some((j) => j.dependsOn.includes(id)))
      throw new ValidationError("Delete dependent jobs first");
    if (!jobs.some((j) => j.id === id)) return false;
    await this.ctx.storage.put(
      "jobs",
      jobs.filter((j) => j.id !== id),
    );
    for (const task of await this.listSchedules()) {
      if (task.name === "execute" && (task.payload as Execution).job.id === id)
        await this.cancelSchedule(task.id);
    }
    return true;
  }
  async poll(): Promise<void> {
    this.schema();
    const jobs = ordered(await this.getJobs());
    const now = this.now();
    for (const job of jobs) {
      if (Date.parse(job.nextRun) > now) continue;
      const scheduledAt = job.nextRun;
      const runId = `${job.id}:${scheduledAt}`;
      // Queue first: a crash before advancing the registry re-queues the same durable ID.
      await this.queue(
        "execute",
        { runId, job: { ...job }, scheduledAt },
        { id: runId },
      );
      job.nextRun = nextRun(job.cron, now);
      await this.ctx.storage.put("jobs", jobs);
    }
  }
  async runNow(id: string): Promise<string> {
    await this.initialize();
    const job = (await this.getJobs()).find((j) => j.id === id);
    if (!job) throw new ValidationError("Unknown job");
    if (job.dependsOn.length)
      throw new ValidationError("Dependent jobs run on schedule only");
    const runId = `${id}:manual:${crypto.randomUUID()}`;
    await this.queue(
      "execute",
      { runId, job, scheduledAt: new Date(this.now()).toISOString() },
      { id: runId },
    );
    return runId;
  }
  async execute(task: Execution): Promise<void> {
    this.schema();
    // An existing row, including an interrupted "running" attempt, is never resent.
    // This deliberately prefers an inspectable uncertain result over duplicate calls/SMS.
    const prior = this.ctx.storage.sql
      .exec("SELECT status FROM executions WHERE run_id = ?", task.runId)
      .toArray()[0];
    if (prior) return;
    if (!(await this.getJobs()).some((j) => j.id === task.job.id)) return;
    for (const id of task.job.dependsOn) {
      const dep = this.ctx.storage.sql
        .exec(
          "SELECT status FROM executions WHERE job_id = ? AND scheduled_at = ? ORDER BY started_at DESC LIMIT 1",
          id,
          task.scheduledAt,
        )
        .toArray()[0];
      if (!dep || dep.status === "running")
        throw new Error("Waiting for dependency");
      if (dep.status !== "success") {
        this.record(task, "skipped", "Dependency did not succeed");
        return;
      }
    }
    this.record(task, "running", "Execution started");
    let status = "success",
      result: string;
    try {
      result = await this.perform(task.job, task.runId);
    } catch (error) {
      status = "failure";
      result = error instanceof Error ? error.message : "Execution failed";
    }
    this.ctx.storage.sql.exec(
      "UPDATE executions SET status = ?, result = ?, finished_at = ? WHERE run_id = ?",
      status,
      result.slice(0, 1000),
      new Date(this.now()).toISOString(),
      task.runId,
    );
    if (status === "failure") {
      let notification = "simulated";
      if (this.setting("DEMO_MODE") === "false") {
        try {
          const client = this.client();
          await client.messages.send(
            {
              from: this.required("TELNYX_PHONE_NUMBER"),
              to: this.required("NOTIFICATION_PHONE_NUMBER"),
              text: `Cron job "${task.job.name}" failed. Run: ${task.runId}`,
            },
            { maxRetries: 0, timeout: 10000 },
          );
          notification = "sent";
        } catch {
          notification = "failed";
        }
      }
      this.ctx.storage.sql.exec(
        "UPDATE executions SET notification = ? WHERE run_id = ?",
        notification,
        task.runId,
      );
    }
  }
  private record(task: Execution, status: string, result: string) {
    this.ctx.storage.sql.exec(
      "INSERT INTO executions (run_id,job_id,scheduled_at,status,result,notification,started_at,finished_at) VALUES (?,?,?,?,?,?,?,?)",
      task.runId,
      task.job.id,
      task.scheduledAt,
      status,
      result,
      "not_needed",
      new Date(this.now()).toISOString(),
      status === "skipped" ? new Date(this.now()).toISOString() : null,
    );
  }
  private setting(
    key: Exclude<keyof SchedulerEnv, "TELNYX">,
  ): string | undefined {
    return this.env[key] ?? process.env[key];
  }
  private required(
    key:
      | "TELNYX_PHONE_NUMBER"
      | "TELNYX_CONNECTION_ID"
      | "NOTIFICATION_PHONE_NUMBER",
  ): string {
    const value = this.setting(key);
    if (!value) throw new Error(`Missing ${key}`);
    return value;
  }
  private client() {
    if (!this.env.TELNYX) throw new Error("Missing TELNYX binding");
    return this.env.TELNYX;
  }
  private async perform(job: Job, runId: string): Promise<string> {
    if (this.setting("DEMO_MODE") !== "false") {
      if (job.demoFailure) throw new Error("Simulated job failure");
      return `simulated_${job.type}`;
    }
    if (job.type === "sms") {
      const response = await this.client().messages.send(
        {
          from: this.required("TELNYX_PHONE_NUMBER"),
          to: job.target,
          text:
            typeof job.payload.text === "string"
              ? job.payload.text
              : "Hello from CronAgent",
        },
        { maxRetries: 0, timeout: 10000 },
      );
      return `sms_accepted:${response.data?.id ?? "unknown"}`;
    }
    if (job.type === "call") {
      const response = await this.client().calls.dial(
        {
          connection_id: this.required("TELNYX_CONNECTION_ID"),
          from: this.required("TELNYX_PHONE_NUMBER"),
          to: job.target,
          command_id: runId,
        },
        { maxRetries: 0, timeout: 10000 },
      );
      return `call_accepted:${response.data?.call_control_id ?? "unknown"}`;
    }
    const url = new URL(job.target);
    const allowed = (this.setting("WEBHOOK_HOSTS") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!allowed.includes(url.hostname))
      throw new Error("Webhook hostname is not in WEBHOOK_HOSTS");
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": runId },
      body: JSON.stringify(job.payload),
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`Webhook HTTP ${response.status}`);
    return `webhook_accepted:${response.status}`;
  }
  async logs(limit = 100) {
    this.schema();
    return this.ctx.storage.sql
      .exec(
        "SELECT * FROM executions ORDER BY started_at DESC, run_id DESC LIMIT ?",
        Math.max(1, Math.min(100, limit)),
      )
      .toArray();
  }
}
