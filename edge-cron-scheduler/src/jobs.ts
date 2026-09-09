import { CronExpressionParser } from "cron-parser";

export interface Job {
  id: string;
  name: string;
  cron: string;
  type: "call" | "sms" | "webhook";
  target: string;
  payload: Record<string, unknown>;
  dependsOn: string[];
  demoFailure: boolean;
  nextRun: string;
}
export class ValidationError extends Error {
  override name = "ValidationError";
}
export function nextRun(cron: string, now: number): string {
  if (cron.trim().split(/\s+/).length !== 5)
    throw new ValidationError("Use a five-field UTC cron expression");
  try {
    return CronExpressionParser.parse(cron, {
      currentDate: new Date(now),
      tz: "UTC",
    })
      .next()
      .toISOString()!;
  } catch {
    throw new ValidationError("Invalid cron expression");
  }
}
export function validateJob(input: unknown, now: number): Job {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ValidationError("Expected a job object");
  const x = input as Record<string, unknown>;
  if (typeof x.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(x.id))
    throw new ValidationError(
      "id must contain 1–64 letters, digits, underscores or hyphens",
    );
  if (typeof x.name !== "string" || !x.name.trim() || x.name.length > 120)
    throw new ValidationError("name is required (maximum 120 characters)");
  if (typeof x.cron !== "string") throw new ValidationError("cron is required");
  if (!["call", "sms", "webhook"].includes(String(x.type)))
    throw new ValidationError("type must be call, sms or webhook");
  if (typeof x.target !== "string")
    throw new ValidationError("target is required");
  if (x.type === "webhook") {
    let u: URL;
    try {
      u = new URL(x.target);
    } catch {
      throw new ValidationError("target must be an HTTPS URL");
    }
    if (u.protocol !== "https:" || u.username || u.password)
      throw new ValidationError(
        "target must be an HTTPS URL without credentials",
      );
  } else if (!/^\+[1-9]\d{7,14}$/.test(x.target))
    throw new ValidationError("target must be an E.164 phone number");
  if (
    x.payload !== undefined &&
    (!x.payload || typeof x.payload !== "object" || Array.isArray(x.payload))
  )
    throw new ValidationError("payload must be an object");
  if (
    x.dependsOn !== undefined &&
    (!Array.isArray(x.dependsOn) ||
      x.dependsOn.some((v) => typeof v !== "string"))
  )
    throw new ValidationError("dependsOn must be an array of job IDs");
  if (x.demoFailure !== undefined && typeof x.demoFailure !== "boolean")
    throw new ValidationError("demoFailure must be boolean");
  const cron = x.cron.trim().replace(/\s+/g, " ");
  return {
    id: x.id,
    name: x.name.trim(),
    cron,
    type: x.type as Job["type"],
    target: x.target,
    payload: (x.payload ?? {}) as Job["payload"],
    dependsOn: [...new Set((x.dependsOn ?? []) as string[])],
    demoFailure: x.demoFailure === true,
    nextRun: nextRun(cron, now),
  };
}
export function ordered(jobs: Job[]): Job[] {
  const result: Job[] = [],
    visiting = new Set<string>(),
    visited = new Set<string>();
  const visit = (job: Job) => {
    if (visited.has(job.id)) return;
    if (visiting.has(job.id)) throw new ValidationError("Dependency cycle");
    visiting.add(job.id);
    for (const id of job.dependsOn) {
      const parent = jobs.find((j) => j.id === id);
      if (!parent) throw new ValidationError(`Unknown dependency: ${id}`);
      if (parent.cron !== job.cron)
        throw new ValidationError(
          "Dependent jobs must use the same cron expression",
        );
      visit(parent);
    }
    visiting.delete(job.id);
    visited.add(job.id);
    result.push(job);
  };
  jobs.forEach(visit);
  return result;
}
