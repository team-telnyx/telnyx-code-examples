import { dashboard } from "./dashboard.js";
export { CronAgent } from "./cron-agent.js";
import type { CronAgent } from "./cron-agent.js";
import { ValidationError, validateJob } from "./jobs.js";
export interface Env {
  CRON_AGENT: {
    idFromName(
      name: string,
    ): Pick<
      CronAgent,
      | "mutate"
      | "initialize"
      | "status"
      | "getJobs"
      | "registerJob"
      | "deleteJob"
      | "runNow"
      | "logs"
    >;
  };
  SCHEDULER_TOKEN?: string;
  SECRETS?: { get(name: string): Promise<string> };
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(dashboard(), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
          "content-security-policy":
            "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        },
      });
    }
    if (url.pathname === "/health/liveness")
      return Response.json({ status: "ok" });
    let token = env.SCHEDULER_TOKEN || process.env.SCHEDULER_TOKEN;
    if (!token && env.SECRETS) {
      try {
        token = await env.SECRETS.get("SCHEDULER_TOKEN");
      } catch {
        return Response.json(
          { error: "Scheduler authentication is unavailable" },
          { status: 503 },
        );
      }
    }
    if (!token)
      return Response.json(
        { error: "Scheduler authentication is not configured" },
        { status: 503 },
      );
    if (request.headers.get("authorization") !== `Bearer ${token}`)
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    try {
      const agent = env.CRON_AGENT.idFromName("scheduler");
      const mutate = async (
        action: "create" | "delete" | "run",
        input: unknown,
      ) => {
        const result = await agent.mutate(action, input);
        if (!result.ok) throw new ValidationError(result.error);
        return result.value;
      };
      if (request.method === "GET" && url.pathname === "/health") {
        const health = await agent.status();
        return Response.json(health, {
          status: health.status === "ok" ? 200 : 503,
        });
      }
      if (request.method === "GET" && url.pathname === "/jobs")
        return Response.json(await agent.getJobs());
      if (request.method === "POST" && url.pathname === "/jobs") {
        const raw = await request.text();
        if (raw.length > 16384)
          return Response.json(
            { error: "Job body exceeds 16 KB" },
            { status: 413 },
          );
        let input: unknown;
        try {
          input = JSON.parse(raw);
        } catch {
          throw new ValidationError("Invalid JSON");
        }
        validateJob(input, Date.now());
        return Response.json(await mutate("create", input), { status: 201 });
      }
      const match = url.pathname.match(
        /^\/jobs\/([a-zA-Z0-9_-]{1,64})(\/run)?$/,
      );
      if (match) {
        if (request.method === "POST" && match[2])
          return Response.json(
            { runId: await mutate("run", match[1]) },
            { status: 202 },
          );
        if (request.method === "DELETE" && !match[2])
          return (await mutate("delete", match[1]))
            ? new Response(null, { status: 204 })
            : Response.json({ error: "Not found" }, { status: 404 });
        if (request.method === "GET" && !match[2]) {
          const job = (await agent.getJobs()).find((j) => j.id === match[1]);
          return job
            ? Response.json(job)
            : Response.json({ error: "Not found" }, { status: 404 });
        }
      }
      if (request.method === "GET" && url.pathname === "/logs") {
        const limit = Number(url.searchParams.get("limit") ?? 100);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100)
          throw new ValidationError("limit must be 1–100");
        return Response.json(await agent.logs(limit));
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    } catch (error) {
      // RPC transports may preserve only the error name.
      if (
        error instanceof Error &&
        (error instanceof ValidationError || error.name === "ValidationError")
      )
        return Response.json({ error: error.message }, { status: 400 });
      console.error("Scheduler request failed", error);
      return Response.json(
        { error: "Scheduler operation failed" },
        { status: 500 },
      );
    }
  },
};
