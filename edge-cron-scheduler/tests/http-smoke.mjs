// Run against an already-started demo server: SCHEDULER_TOKEN=... npm run test:http
import assert from "node:assert/strict";
const base = process.env.SCHEDULER_URL ?? "http://127.0.0.1:8787";
const token = process.env.SCHEDULER_TOKEN;
if (!token) throw new Error("Set SCHEDULER_TOKEN to the demo server token");
const request = async (path, method = "GET", body) => {
  const response = await fetch(base + path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok)
    throw new Error(
      `${method} ${path}: ${response.status} ${await response.text()}`,
    );
  return response.status === 204 ? undefined : response.json();
};
assert.equal(
  (await request("/health")).demoMode,
  true,
  "HTTP smoke requires demo mode",
);
const prefix = `smoke-${Date.now()}`;
const ids = ["call", "sms", "webhook"].map((type) => `${prefix}-${type}`);
try {
  for (const [i, type] of ["call", "sms", "webhook"].entries())
    await request("/jobs", "POST", {
      id: ids[i],
      name: ids[i],
      cron: "* * * * *",
      type,
      target: type === "webhook" ? "https://example.com/hook" : "+18005550102",
    });
  const deadline = Date.now() + 150000;
  let passed = false;
  while (Date.now() < deadline) {
    const rows = (await request("/logs")).filter((row) =>
      ids.includes(row.job_id),
    );
    if (
      ids.every(
        (id) =>
          rows.filter((row) => row.job_id === id && row.status === "success")
            .length >= 2,
      )
    ) {
      assert.equal(new Set(rows.map((row) => row.run_id)).size, rows.length);
      console.log(
        "PASS: two automatic executions of call, SMS and webhook jobs",
      );
      passed = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  assert.ok(passed, "Timed out waiting for two automatic cycles");
} finally {
  for (const id of ids) await request(`/jobs/${id}`, "DELETE").catch(() => {});
}
