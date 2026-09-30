import assert from "node:assert/strict";
import test from "node:test";
import { CatalogService, filterEligibleModels, orderModels } from "../src/catalog.js";
import { DEFAULT_PREFERRED_MODELS } from "../src/config.js";

function rawModel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "z-ai/glm-5.3-flash",
    name: "GLM 5.3 Flash",
    context_length: 131072,
    pricing: { prompt: "0.0000013926", completion: "0.0000041778" },
    trustedrouter: {
      endpoints: [
        {
          provider: "telnyx",
          provider_zero_data_retention: true,
          usage_type: "Credits",
          provider_policy_url: "https://telnyx.com/privacy-policy",
          provider_policy: "policy-backed ZDR",
        },
      ],
    },
    ...overrides,
  };
}

test("filterEligibleModels keeps only models with a Telnyx ZDR endpoint", () => {
  const models = filterEligibleModels([
    rawModel(),
    rawModel({ id: "openai/gpt-x", trustedrouter: { endpoints: [{ provider: "openai", provider_zero_data_retention: true }] } }),
    rawModel({ id: "z-ai/glm-5.2", trustedrouter: { endpoints: [{ provider: "telnyx", provider_zero_data_retention: false }] } }),
    rawModel({ id: "no/endpoints", trustedrouter: { endpoints: [] } }),
  ]);
  assert.deepEqual(
    models.map((m) => m.id),
    ["z-ai/glm-5.3-flash"]
  );
  const model = models[0] as NonNullable<typeof models[number]>;
  assert.equal(model.usageTypes[0], "Credits");
  assert.equal(model.promptPriceUsdPerMillion, 1.3926);
  assert.equal(model.completionPriceUsdPerMillion, 4.1778);
  assert.equal(model.providerPolicyUrl, "https://telnyx.com/privacy-policy");
});

test("filterEligibleModels is case-insensitive on provider slug and ignores malformed rows", () => {
  const models = filterEligibleModels([
    rawModel({ trustedrouter: { endpoints: [{ provider: "Telnyx", provider_zero_data_retention: true }] } }),
    rawModel({ id: null }),
    "not-an-object",
    null,
  ]);
  assert.equal(models.length, 1);
});

test("preferred models are ordered first (GLM 5.3 Flash, then Qwen fallback)", () => {
  const models = orderModels([
    { id: "a/other", name: "Other", contextLength: null, promptPriceUsdPerMillion: null, completionPriceUsdPerMillion: null, usageTypes: [], providerPolicyUrl: null, providerPolicySummary: null },
    { id: DEFAULT_PREFERRED_MODELS[1] as string, name: "Qwen", contextLength: null, promptPriceUsdPerMillion: null, completionPriceUsdPerMillion: null, usageTypes: [], providerPolicyUrl: null, providerPolicySummary: null },
    { id: DEFAULT_PREFERRED_MODELS[0] as string, name: "GLM", contextLength: null, promptPriceUsdPerMillion: null, completionPriceUsdPerMillion: null, usageTypes: [], providerPolicyUrl: null, providerPolicySummary: null },
  ]);
  assert.equal(models[0]?.id, DEFAULT_PREFERRED_MODELS[0]);
  assert.equal(models[1]?.id, DEFAULT_PREFERRED_MODELS[1]);
});

test("catalog failure without prior cache returns labeled fallback data", async () => {
  const service = new CatalogService({
    fetchImpl: async () => {
      throw new Error("offline");
    },
    ttlSeconds: 300,
  });
  const result = await service.getCatalog();
  assert.equal(result.source, "fallback");
  assert.equal(result.fetchedAt, null);
  assert.deepEqual(
    result.models.map((m) => m.id),
    [...DEFAULT_PREFERRED_MODELS]
  );
  for (const model of result.models) {
    assert.match(model.providerPolicySummary ?? "", /Fallback data/);
  }
});

test("catalog failure after TTL expiry returns cached data labeled as cached", async () => {
  let now = 1_000_000;
  let callCount = 0;
  const service = new CatalogService({
    fetchImpl: async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Response(JSON.stringify({ data: [rawModel()] }), { status: 200 });
      }
      throw new Error("offline");
    },
    ttlSeconds: 300,
    now: () => now,
  });
  const live = await service.getCatalog();
  assert.equal(live.source, "live");
  now += 301_000;
  const stale = await service.getCatalog();
  assert.equal(stale.source, "cached");
  assert.equal(stale.models.length, live.models.length);
});

test("cache honors TTL", async () => {
  let now = 1_000_000;
  let callCount = 0;
  const service = new CatalogService({
    fetchImpl: async () => {
      callCount += 1;
      return new Response(JSON.stringify({ data: [rawModel()] }), { status: 200 });
    },
    ttlSeconds: 300,
    now: () => now,
  });
  await service.getCatalog();
  assert.equal(callCount, 1);
  now += 299_000;
  await service.getCatalog();
  assert.equal(callCount, 1);
  now += 2_000;
  await service.getCatalog();
  assert.equal(callCount, 2);
});

test("validateModel checks the current catalog", async () => {
  const service = new CatalogService({
    fetchImpl: async () => new Response(JSON.stringify({ data: [rawModel()] }), { status: 200 }),
    ttlSeconds: 300,
  });
  assert.deepEqual(await service.validateModel("z-ai/glm-5.3-flash"), { eligible: true, source: "live" });
  const bad = await service.validateModel("openai/gpt-x");
  assert.equal(bad.eligible, false);
});

test("fallback data still validates its listed models", async () => {
  const service = new CatalogService({
    fetchImpl: async () => {
      throw new Error("offline");
    },
    ttlSeconds: 300,
  });
  const validation = await service.validateModel(DEFAULT_PREFERRED_MODELS[0] as string);
  assert.equal(validation.eligible, true);
  const offList = await service.validateModel("some/unknown-model");
  assert.equal(offList.eligible, false);
});
