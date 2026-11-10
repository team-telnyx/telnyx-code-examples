/**
 * Smoke test for concierge-diary.
 * Run with: npx tsx smoke_test.ts
 *
 * Verifies the module loads, the actor surface exists, the input validation
 * rejects bad intents, and the scheduled-event payload matches the contract
 * the ticket requires (channel, targets, timestamp, dynamic_variables, retries).
 */
import { Agent } from "@telnyx/edge-runtime";
import worker, {
  DiaryActor,
  HttpError,
  buildScheduledEventPayload,
  validateDiaryIntent,
} from "./src/index";

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const FUTURE = "2030-11-12T10:00:00-08:00";

const validBody = {
  conversationId: "conv_123",
  patientName: "Maya",
  reason: "MRI results call",
  callbackAt: FUTURE,
  opener: "Maya, Dr. Chen's office \u2014 your MRI results are in.",
  endUserTarget: "+15105550100",
  agentTarget: "+15105550199",
};

function expect400(fn: () => unknown, message: string): void {
  let threw = false;
  try {
    fn();
  } catch (err) {
    threw = err instanceof HttpError && err.status === 400;
  }
  assert(threw, message);
}

async function main(): Promise<void> {
  console.log("concierge-diary smoke test");

  await check("worker exposes a fetch handler", () => {
    assert(typeof worker.fetch === "function", "default export must have fetch()");
  });

  await check("DiaryActor extends Agent", () => {
    assert(Object.getPrototypeOf(DiaryActor) === Agent, "DiaryActor must extend Agent");
  });

  await check("DiaryActor exposes the diary surface", () => {
    const proto = DiaryActor.prototype as unknown as Record<string, unknown>;
    for (const method of ["fetch", "onWebhook", "onSweep", "onEventStatus", "onReschedule", "onCancel", "initialState"]) {
      assert(typeof proto[method] === "function", `missing ${method}()`);
    }
  });

  await check("validateDiaryIntent accepts a well-formed intent", () => {
    const intent = validateDiaryIntent(validBody);
    assert(intent.patientName === "Maya", "patientName not preserved");
    assert(intent.callbackAt === FUTURE, "callbackAt not preserved");
  });

  await check("validateDiaryIntent rejects a missing patient name", () => {
    expect400(() => validateDiaryIntent({ ...validBody, patientName: "" }), "empty patientName must be a 400");
  });

  await check("validateDiaryIntent rejects non-E.164 targets", () => {
    expect400(() => validateDiaryIntent({ ...validBody, endUserTarget: "510-555-0100" }), "non-E.164 endUserTarget must be a 400");
  });

  await check("validateDiaryIntent rejects past timestamps", () => {
    expect400(() => validateDiaryIntent({ ...validBody, callbackAt: "2020-01-01T00:00:00Z" }), "past callbackAt must be a 400");
  });

  await check("buildScheduledEventPayload matches the scheduled-events contract", () => {
    const payload = buildScheduledEventPayload(validateDiaryIntent(validBody), "Northside Imaging");
    assert(payload.telnyx_conversation_channel === "phone_call", "channel must be phone_call");
    assert(payload.telnyx_end_user_target === "+15105550100", "end user target mismatch");
    assert(payload.telnyx_agent_target === "+15105550199", "agent target mismatch");
    assert(payload.scheduled_at_fixed_datetime === FUTURE, "scheduled_at_fixed_datetime mismatch");
    assert(payload.dynamic_variables.patient_name === "Maya", "patient_name dynamic variable missing");
    assert(payload.dynamic_variables.topic === "MRI results call", "topic dynamic variable missing");
    assert(payload.dynamic_variables.clinic_name === "Northside Imaging", "clinic_name dynamic variable missing");
    assert(payload.dynamic_variables.opener.includes("MRI results"), "opener dynamic variable missing");
    assert(payload.max_retries_client_errors === 2, "retry budget must be 2");
    assert(payload.retry_interval_secs === 300, "retry interval must be 300");
  });

  await check("worker rejects a POST without conversationId", async () => {
    const res = await worker.fetch(
      new Request("https://example.com/diary/entries", { method: "POST", body: JSON.stringify({}) }),
      {} as never,
    );
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });

  await check("auth: live mode without DIARY_WEBHOOK_SECRET rejects POSTs", async () => {
    const env = { DEMO_MODE: "false" } as never;
    const res = await worker.fetch(
      new Request("https://example.com/diary/entries", { method: "POST", body: JSON.stringify(validBody) }),
      env,
    );
    assert(res.status === 401, `expected 401 in live mode without secret, got ${res.status}`);
  });

  await check("auth: wrong shared secret rejects POSTs", async () => {
    const env = { DEMO_MODE: "true", DIARY_WEBHOOK_SECRET: "s3cret" } as never;
    const res = await worker.fetch(
      new Request("https://example.com/diary/entries", {
        method: "POST",
        headers: { Authorization: "Bearer wrong" },
        body: JSON.stringify(validBody),
      }),
      env,
    );
    assert(res.status === 401, `expected 401 for wrong secret, got ${res.status}`);
  });

  await check("auth: correct shared secret passes the gate", async () => {
    const env = { DEMO_MODE: "true", DIARY_WEBHOOK_SECRET: "s3cret" } as never;
    const res = await worker.fetch(
      new Request("https://example.com/diary/entries", {
        method: "POST",
        headers: { "X-Diary-Token": "Bearer s3cret" },
        body: JSON.stringify({}),
      }),
      env,
    );
    // Auth passes; the empty body then fails intent validation with 400.
    assert(res.status === 400, `expected 400 past the auth gate, got ${res.status}`);
  });

  await check("auth: demo mode without a secret stays open (runnable out of the box)", async () => {
    const env = { DEMO_MODE: "true" } as never;
    const res = await worker.fetch(
      new Request("https://example.com/diary/entries", { method: "POST", body: JSON.stringify({}) }),
      env,
    );
    assert(res.status === 400, `expected 400 in demo mode, got ${res.status}`);
  });

  await check("worker rejects a GET without conversationId", async () => {
    const res = await worker.fetch(new Request("https://example.com/diary"), {} as never);
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });

  await check("worker returns 404 for unknown routes", async () => {
    const res = await worker.fetch(new Request("https://example.com/nope"), {} as never);
    assert(res.status === 404, `expected 404, got ${res.status}`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
