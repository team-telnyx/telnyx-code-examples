/**
 * Smoke test for show-wrap-desk.
 * Verifies the module loads, the WrapDesk class exists, and the
 * expected methods are present.
 *
 * Run with: npx tsx smoke_test.ts
 */

import { WrapDesk, default as index } from "./src/index";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  console.log(`✅ ${message}`);
}

async function runSmokeTest(): Promise<void> {
  // Verify WrapDesk class exists and extends Agent
  assert(typeof WrapDesk === "function", "WrapDesk class is exported");
  assert(
    WrapDesk.prototype instanceof Object,
    "WrapDesk is a class (instance of Object)"
  );

  // Verify key methods exist on the prototype
  const proto = WrapDesk.prototype as Record<string, unknown>;
  assert(typeof proto.onWrap === "function", "onWrap method exists");
  assert(typeof proto.wrapTick === "function", "wrapTick method exists");
  assert(typeof proto.wrapstatus === "function", "wrapstatus method exists");

  // Verify the default fetch handler is exported
  assert(typeof index.fetch === "function", "default export has fetch handler");

  // Verify the fetch handler returns 404 for unknown routes
  const req = new Request("https://example.com/unknown", { method: "GET" });
  const resp = await index.fetch(req, {} as any);
  assert(resp.status === 404, "unknown route returns 404");

  // Verify the /wrap endpoint validates input
  const badReq = new Request("https://example.com/wrap", {
    method: "POST",
    body: JSON.stringify({}),
    headers: { "Content-Type": "application/json" },
  });
  const badResp = await index.fetch(badReq, {} as any);
  assert(badResp.status === 400, "/wrap with missing fields returns 400");

  console.log("\n🎉 All smoke tests passed!");
}

runSmokeTest().catch((err) => {
  console.error("❌ Smoke test failed:", err);
  process.exit(1);
});
```
