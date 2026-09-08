import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CronAgent, type SchedulerEnv } from "../src/cron-agent.js";
import { localContext } from "../local/context.js";
import { nextRun } from "../src/jobs.js";
import app from "../src/index.js";
let time = Date.parse("2026-09-08T08:02:30Z");
class TestAgent extends CronAgent {
  protected override now() {
    return time;
  }
}
const definition = (id: string, type = "sms", extra = {}) => ({
  id,
  name: id,
  type,
  cron: "* * * * *",
  target: type === "webhook" ? "https://example.com/hook" : "+18005550102",
  ...extra,
});
async function setup(env: SchedulerEnv = {}, path = ":memory:") {
  const local = localContext(path),
    agent = new TestAgent(local.ctx, { DEMO_MODE: "true", ...env });
  await local.ready();
  await agent.initialize();
  return {
    agent,
    local,
    async drain() {
      await agent.alarm({ retryCount: 0, isRetry: false });
    },
  };
}
test("cron follows UTC calendar boundaries and rejects malformed expressions", () => {
  const now = Date.parse("2026-09-08T08:02:30Z");
  assert.equal(nextRun("*/5 * * * *", now), "2026-09-08T08:05:00.000Z");
  assert.equal(nextRun("0 9 * * *", now), "2026-09-08T09:00:00.000Z");
  assert.equal(nextRun("0 0 * * 1", now), "2026-09-14T00:00:00.000Z");
  for (const cron of ["bad", "61 * * * *", "* * * * * *"])
    assert.throws(() => nextRun(cron, now));
});
test("real SDK alarm runs all three types repeatedly and preserves separate SQL rows", async () => {
  time = Date.parse("2026-09-08T08:02:30Z");
  const h = await setup();
  try {
    for (const type of ["call", "sms", "webhook"])
      await h.agent.registerJob(definition(type, type));
    await h.drain();
    assert.equal((await h.agent.logs()).length, 0);
    time += 60000;
    await h.drain();
    assert.equal((await h.agent.logs()).length, 3);
    time += 60000;
    await h.drain();
    const logs = await h.agent.logs();
    assert.equal(logs.length, 6);
    assert.ok(logs.every((l) => l.status === "success"));
    assert.equal(new Set(logs.map((l) => l.run_id)).size, 6);
    await h.agent.initialize();
    assert.equal(
      (await h.agent.status()).schedules.filter((t) => t.id === "cron-poll")
        .length,
      1,
    );
  } finally {
    h.local.close();
  }
});
test("failure alert is recorded and dependencies skip failed executions", async () => {
  time = Date.parse("2026-09-08T08:02:30Z");
  const h = await setup();
  try {
    await h.agent.registerJob(
      definition("a", "webhook", { demoFailure: true }),
    );
    await h.agent.registerJob(definition("b", "sms", { dependsOn: ["a"] }));
    time += 60000;
    await h.drain();
    time += 2000;
    await h.drain();
    const logs = await h.agent.logs();
    assert.equal(logs.find((l) => l.job_id === "a")?.notification, "simulated");
    assert.equal(logs.find((l) => l.job_id === "b")?.status, "skipped");
    await assert.rejects(h.agent.deleteJob("a"), /dependent/);
  } finally {
    h.local.close();
  }
});
test("dependencies execute after successful parents even when task ID ordering is reversed", async () => {
  time = Date.parse("2026-09-08T08:02:30Z");
  const h = await setup();
  try {
    await h.agent.registerJob(definition("z"));
    await h.agent.registerJob(definition("a", "sms", { dependsOn: ["z"] }));
    time += 60000;
    await h.drain();
    time += 2000;
    await h.drain();
    assert.equal(
      (await h.agent.logs()).filter((l) => l.status === "success").length,
      2,
    );
  } finally {
    h.local.close();
  }
});
test("disk restart resumes timers and retains registry and history", async () => {
  time = Date.parse("2026-09-08T08:02:30Z");
  const dir = mkdtempSync(join(tmpdir(), "cron-test-")),
    path = join(dir, "state.sqlite");
  let h = await setup({}, path);
  try {
    await h.agent.registerJob(definition("restart"));
    time += 60000;
    await h.drain();
    h.local.close();
    h = await setup({}, path);
    assert.equal((await h.agent.getJobs()).length, 1);
    time += 60000;
    await h.drain();
    assert.equal((await h.agent.logs()).length, 2);
  } finally {
    h.local.close();
    rmSync(dir, { recursive: true });
  }
});
test("duplicate delivery does not resend a completed execution; deletion cancels queued work", async () => {
  time = Date.parse("2026-09-08T08:02:30Z");
  const h = await setup();
  try {
    const job = await h.agent.registerJob(definition("once"));
    const task = { job, runId: "duplicate", scheduledAt: job.nextRun };
    await h.agent.execute(task);
    await h.agent.execute(task);
    assert.equal((await h.agent.logs()).length, 1);
    await h.agent.runNow("once");
    await h.agent.deleteJob("once");
    await h.drain();
    assert.equal((await h.agent.logs()).length, 1);
  } finally {
    h.local.close();
  }
});
test("live branches call supported SDK methods with retries disabled and log acceptance", async () => {
  time = Date.parse("2026-09-08T08:02:30Z");
  const sent: unknown[] = [];
  const client = {
    calls: {
      dial: async (body: unknown, opts: unknown) => {
        sent.push([body, opts]);
        return { data: { call_control_id: "call-id" } };
      },
    },
    messages: {
      send: async (body: unknown, opts: unknown) => {
        sent.push([body, opts]);
        return { data: { id: "sms-id" } };
      },
    },
  } as unknown as NonNullable<SchedulerEnv["TELNYX"]>;
  const h = await setup({
    DEMO_MODE: "false",
    TELNYX: client,
    TELNYX_PHONE_NUMBER: "+18005550100",
    TELNYX_CONNECTION_ID: "test",
  });
  try {
    for (const type of ["call", "sms"]) {
      await h.agent.registerJob(definition(type, type));
      await h.agent.runNow(type);
    }
    await h.drain();
    assert.equal(sent.length, 2);
    assert.ok(
      (await h.agent.logs()).every((l) =>
        String(l.result).includes("_accepted:"),
      ),
    );
    assert.ok(
      sent.every(
        (x) => (x as [unknown, { maxRetries: number }])[1].maxRetries === 0,
      ),
    );
  } finally {
    h.local.close();
  }
});
test("HTTP auth, validation, CRUD, manual dispatch and history form an end-to-end flow", async () => {
  time = Date.parse("2026-09-08T08:02:30Z");
  const h = await setup();
  const env = {
    SCHEDULER_TOKEN: "test-token",
    CRON_AGENT: { idFromName: () => h.agent },
  };
  const request = (path: string, method = "GET", body?: unknown, auth = true) =>
    app.fetch(
      new Request("http://local" + path, {
        method,
        headers: auth ? { authorization: "Bearer test-token" } : {},
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
      env,
    );
  try {
    assert.equal((await request("/jobs", "GET", undefined, false)).status, 401);
    assert.equal((await request("/jobs", "POST", {})).status, 400);
    assert.equal(
      (await request("/jobs", "POST", definition("api"))).status,
      201,
    );
    assert.equal((await request("/jobs/api")).status, 200);
    assert.equal((await request("/jobs/api/run", "POST")).status, 202);
    await h.drain();
    const logs = (await (await request("/logs")).json()) as unknown[];
    assert.equal(logs.length, 1);
    assert.equal((await request("/logs?limit=NaN")).status, 400);
    assert.equal((await request("/jobs/api", "DELETE")).status, 204);
    assert.equal((await request("/jobs/api")).status, 404);
  } finally {
    h.local.close();
  }
});

test("live webhook failure attempts an alert and does not stop the next job", async () => {
  time = Date.parse("2026-09-08T08:02:30Z");
  const originalFetch = globalThis.fetch;
  let requests = 0,
    alerts = 0;
  globalThis.fetch = async (_input, options) => {
    requests++;
    assert.equal(options?.redirect, "error");
    assert.ok((options?.headers as Record<string, string>)["idempotency-key"]);
    return new Response("unavailable", { status: 503 });
  };
  const client = {
    messages: {
      send: async () => {
        alerts++;
        throw new Error("notification provider unavailable");
      },
    },
  } as unknown as NonNullable<SchedulerEnv["TELNYX"]>;
  const h = await setup({
    DEMO_MODE: "false",
    TELNYX: client,
    WEBHOOK_HOSTS: "example.com",
    TELNYX_PHONE_NUMBER: "+18005550100",
    NOTIFICATION_PHONE_NUMBER: "+18005550101",
  });
  try {
    await h.agent.registerJob(definition("hook", "webhook"));
    await h.agent.runNow("hook");
    await h.drain();
    const row = (await h.agent.logs())[0];
    assert.equal(row.status, "failure");
    assert.equal(row.notification, "failed");
    assert.equal(requests, 1);
    assert.equal(alerts, 1);
  } finally {
    globalThis.fetch = originalFetch;
    h.local.close();
  }
});
test("expected mutation errors survive serialization and secret binding authorizes HTTP", async () => {
  const h = await setup();
  try {
    await h.agent.registerJob(definition("unique"));
    const result = JSON.parse(
      JSON.stringify(await h.agent.mutate("create", definition("unique"))),
    );
    assert.equal(result.ok, false);
    assert.match(result.error, /already exists/);
    const response = await app.fetch(
      new Request("http://local/jobs", {
        headers: { authorization: "Bearer secret-value" },
      }),
      {
        SECRETS: {
          get: async (name) => {
            assert.equal(name, "SCHEDULER_TOKEN");
            return "secret-value";
          },
        },
        CRON_AGENT: { idFromName: () => h.agent },
      },
    );
    assert.equal(response.status, 200);
  } finally {
    h.local.close();
  }
});

test("health reports a stalled recurring task instead of claiming readiness", async () => {
  time = Date.parse("2026-09-08T08:02:30Z");
  const h = await setup();
  try {
    time += 121000;
    assert.equal((await h.agent.status()).status, "degraded");
    const response = await app.fetch(
      new Request("http://local/health", {
        headers: { authorization: "Bearer test" },
      }),
      { SCHEDULER_TOKEN: "test", CRON_AGENT: { idFromName: () => h.agent } },
    );
    assert.equal(response.status, 503);
  } finally {
    h.local.close();
  }
});
