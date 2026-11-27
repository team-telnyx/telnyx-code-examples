import assert from "node:assert/strict";
import worker, { DialOdometer, GAP_REGION } from "./src/index";

async function runSmokeTest(): Promise<void> {
  assert.equal(typeof worker.fetch, "function", "default export must expose fetch()");
  assert.equal(typeof DialOdometer, "function", "DialOdometer class must be exported");
  assert.equal(GAP_REGION, "__gap__", "gap sentinel must be stable");

  for (const method of ["arm", "onPoll", "status", "initialState"]) {
    const fn = (DialOdometer.prototype as unknown as Record<string, unknown>)[method];
    assert.equal(typeof fn, "function", `DialOdometer.${method}() must exist`);
  }

  const badCampaign = await worker.fetch(
    new Request("https://example.com/odometer", {
      method: "POST",
      body: JSON.stringify({ campaign: "Spring Reminders!" }),
    }),
    {} as never
  );
  assert.equal(badCampaign.status, 400, "invalid campaign must be rejected with 400");

  const wrongMethod = await worker.fetch(new Request("https://example.com/odometer"), {} as never);
  assert.equal(wrongMethod.status, 405, "GET /odometer must be rejected with 405");

  const missing = await worker.fetch(new Request("https://example.com/nope"), {} as never);
  assert.equal(missing.status, 404, "unknown routes must 404");

  console.log("smoke_test: dial-odometer OK");
}

runSmokeTest().catch((error) => {
  console.error(error);
  process.exit(1);
});
