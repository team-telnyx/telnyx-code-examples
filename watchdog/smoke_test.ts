/**
 * Smoke test \u2014 runs with `npx tsx smoke_test.ts`. No network, no credentials.
 */
import handler, { Watchdog, isDemo, watchId } from "./src/index";

let failures = 0;
function check(ok: boolean, label: string): void {
  if (ok) {
    console.log(`ok - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${label}`);
  }
}

check(typeof Watchdog === "function", "Watchdog class is exported");
check(typeof handler.fetch === "function", "default export exposes fetch()");

for (const method of ["onMessage", "arm", "runCheck", "statusReport", "ensureSchema", "reply"]) {
  check(typeof (Watchdog.prototype as unknown as Record<string, unknown>)[method] === "function", `Watchdog.prototype.${method} exists`);
}

check(watchId("https://demo-shop.example.com/pricing") === "demo-shop.example.com", "watchId derives the host");
check(isDemo({ DEMO_MODE: "true" }) === true, "demo mode defaults on");
check(isDemo({ DEMO_MODE: "false" }) === false, "demo mode can be disabled");

const health = await handler.fetch(new Request("https://watchdog.example.com/health"), {} as never);
check(health.status === 200, "GET /health returns 200");
const body = (await health.json()) as { ok?: boolean; demo_mode?: boolean };
check(body.ok === true, "GET /health reports ok");
check(body.demo_mode === true, "GET /health reports demo mode");

const missing = await handler.fetch(new Request("https://watchdog.example.com/nope"), {} as never);
check(missing.status === 404, "unknown route returns 404");

const badWatch = await handler.fetch(
  new Request("https://watchdog.example.com/watch", { method: "POST", body: JSON.stringify({}) }),
  {} as never,
);
check(badWatch.status === 400, "POST /watch without url returns 400");

if (failures > 0) {
  console.error(`smoke_test: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("smoke_test: all checks passed");
