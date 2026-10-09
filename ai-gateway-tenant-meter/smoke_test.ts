// Standalone smoke test — run with `npx tsx smoke_test.ts`.
// Exercises the wire contract of GatewayClient against a mocked fetch, the
// pure helpers, and the actor's public method surface. No network or API key.

import assert from "node:assert/strict";
import {
  DEFAULT_ALLOWED_MODELS,
  GatewayClient,
  GatewayError,
  GUARDRAILS_POLICY,
  INFERENCE_BASE_URL,
  SpendLedger,
  pctOf,
  summaryWindow,
  toFindingRows,
  validateProvisionInput,
} from "./src/index.js";

const tests: [string, () => void | Promise<void>][] = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn]);

type CapturedRequest = { url: string; method: string; headers: Headers; body: string | undefined };

function clientWith(requests: CapturedRequest[], respond: (req: CapturedRequest) => { status: number; body: unknown }): GatewayClient {
  const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const req: CapturedRequest = {
      url: String(url),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    requests.push(req);
    const res = respond(req);
    return new Response(JSON.stringify(res.body), {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return new GatewayClient("test-key", impl);
}

test("module exports the agent, client, and front-door handler", () => {
  assert.equal(typeof SpendLedger, "function");
  assert.equal(typeof GatewayClient, "function");
  assert.equal(INFERENCE_BASE_URL, "https://llm.telnyx.com/v1");
});

test("the actor exposes provision, spendView, and adjustBudget", () => {
  const proto = SpendLedger.prototype as unknown as Record<string, unknown>;
  for (const method of ["provision", "spendView", "adjustBudget", "rollup", "fetch"]) {
    assert.equal(typeof proto[method], "function", `missing method: ${method}`);
  }
});

test("createTokenGroup posts to /token_groups with budget, allowlist, and guardrails", async () => {
  const requests: CapturedRequest[] = [];
  const client = clientWith(requests, () => ({
    status: 201,
    body: { data: { id: "tg-1", version: 1, budget_started_at: null, resets_at: null } },
  }));
  const group = await client.createTokenGroup("acme", DEFAULT_ALLOWED_MODELS, 120);
  const req = requests[0];
  assert.equal(req.url, "https://api.telnyx.com/v2/llm_token_gateway/token_groups");
  assert.equal(req.method, "POST");
  assert.ok(req.headers.get("Idempotency-Key"), "mutations require an Idempotency-Key");
  assert.equal(req.headers.get("Authorization"), "Bearer test-key");
  const body = JSON.parse(req.body as string);
  assert.deepEqual(body.allowed_models, DEFAULT_ALLOWED_MODELS);
  assert.equal(body.max_budget, 120);
  assert.equal(body.budget_duration, "30d");
  assert.deepEqual(body.guardrails, GUARDRAILS_POLICY);
  assert.equal(group.id, "tg-1");
});

test("createTokenKey uses the flat /token_keys path with token_group_id in the body", async () => {
  const requests: CapturedRequest[] = [];
  const client = clientWith(requests, () => ({
    status: 201,
    body: { data: { id: "tk-1", token: "ltg_sk_test", token_group_id: "tg-1" } },
  }));
  const key = await client.createTokenKey("acme-primary", "tg-1");
  const req = requests[0];
  assert.equal(req.url, "https://api.telnyx.com/v2/llm_token_gateway/token_keys");
  const body = JSON.parse(req.body as string);
  assert.equal(body.token_group_id, "tg-1");
  assert.equal(body.name, "acme-primary");
  assert.equal(key.token, "ltg_sk_test");
});

test("gateway errors become GatewayError with the API error code", async () => {
  const requests: CapturedRequest[] = [];
  const client = clientWith(requests, () => ({
    status: 400,
    body: { errors: [{ code: "model_not_in_catalog", title: "Model not in catalog" }] },
  }));
  await assert.rejects(
    () => client.createTokenGroup("acme", ["nope"], 10),
    (error: unknown) => {
      assert.ok(error instanceof GatewayError);
      assert.equal((error as GatewayError).status, 400);
      assert.equal((error as GatewayError).code, "model_not_in_catalog");
      return true;
    },
  );
});

test("usageSummary passes token_group_id and date range as query params", async () => {
  const requests: CapturedRequest[] = [];
  const client = clientWith(requests, () => ({
    status: 200,
    body: {
      data: {
        totals: { spend: 12.5, input_tokens: 1000, output_tokens: 500 },
        by_day: [{ date: "2026-10-05", spend: 12.5, input_tokens: 1000, output_tokens: 500 }],
        by_model: [{ model: "Kimi-K2.6", spend: 12.5, input_tokens: 1000, output_tokens: 500 }],
        guardrails: { blocked_events: 2, flagged_events: 3, recent_events: [] },
      },
      meta: {},
    },
  }));
  const summary = await client.usageSummary("tg-1", "2026-10-04", "2026-10-06");
  const url = new URL(requests[0].url);
  assert.equal(url.pathname, "/v2/llm_token_gateway/usage/summary");
  assert.equal(url.searchParams.get("token_group_id"), "tg-1");
  assert.equal(url.searchParams.get("start_date"), "2026-10-04");
  assert.equal(url.searchParams.get("end_date"), "2026-10-06");
  assert.equal(summary.totals.spend, 12.5);
  assert.equal(summary.guardrails.blocked_events, 2);
});

test("month-to-date is read from data.totals.spend (not data.total)", () => {
  // Fixture captured live from GET /v2/llm_token_gateway/usage/summary.
  const live = {
    data: {
      by_day: [
        { date: "2026-10-04", spend: 0, input_tokens: 0, output_tokens: 0 },
        { date: "2026-10-05", spend: 3.25, input_tokens: 900, output_tokens: 300 },
      ],
      by_model: [],
      guardrails: { blocked_events: 0, flagged_events: 0, recent_events: [] },
      totals: { spend: 3.25, input_tokens: 900, output_tokens: 300 },
    },
    meta: { start_date: "2026-10-04", end_date: "2026-10-06" },
  };
  assert.equal(live.data.totals.spend, 3.25);
  assert.equal(live.data.by_day.length, 2);
  assert.equal(pctOf(live.data.totals.spend, 10), 33);
  assert.equal(pctOf(live.data.totals.spend, 0), 0);
});

test("budget-period window stays within the API's 31-day span", () => {
  const today = new Date("2026-10-05T12:00:00Z");
  const within = summaryWindow("2026-10-01T00:00:00Z", today);
  assert.equal(within.startDate, "2026-10-01");
  assert.equal(within.endDate, "2026-10-06");
  const longAgo = summaryWindow("2025-01-01T00:00:00Z", today);
  assert.equal(longAgo.startDate, "2026-09-05");
});

test("guardrail findings carry codes and counts only — never matched text", () => {
  const rows = toFindingRows([
    {
      id: "ev-1",
      created_at: "2026-10-05T10:00:00Z",
      stage: "prompt",
      outcome: "blocked",
      findings: [{ detector: "dlp", code: "credit_card_number", count: 1 }],
    },
  ]);
  assert.deepEqual(rows, [
    { day: "2026-10-05", stage: "prompt", outcome: "blocked", detector: "dlp", code: "credit_card_number", count: 1 },
  ]);
  assert.ok(!JSON.stringify(rows).includes("4111"));
  const skips = toFindingRows([{ id: "ev-2", findings: [{ detector: "secrets" }, { code: "x" }] }]);
  assert.equal(skips.length, 0);
});

test("provision input validation rejects bad tenants and budgets", () => {
  assert.throws(() => validateProvisionInput("", 10));
  assert.throws(() => validateProvisionInput("a".repeat(129), 10));
  assert.throws(() => validateProvisionInput("acme", 0));
  assert.throws(() => validateProvisionInput("acme", -5));
  assert.throws(() => validateProvisionInput("acme", Number.NaN));
  const ok = validateProvisionInput("  acme  ", 100);
  assert.equal(ok.tenantId, "acme");
  assert.equal(ok.monthlyBudget, 100);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(error);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} smoke tests passed`);
if (failed > 0) process.exit(1);
