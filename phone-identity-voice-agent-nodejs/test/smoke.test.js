/* ------------------------------------------------------------------ *
 *  smoke.test.js — settings.js + lookup.js tests (node:test)          *
 * ------------------------------------------------------------------ */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

/* ── settings.js ───────────────────────────────────────────────────── */

describe("settings", () => {
  const saved = {};

  before(() => {
    // Snapshot env vars we'll mutate
    for (const k of ["TELNYX_RUNTIME_BINDINGS", "K_SERVICE", "PHONEID_FOO", "FOO"]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  // Fresh import each test to avoid module-cache issues with env reads
  async function loadSettings() {
    // settings.js reads env at call time (functions, not top-level consts)
    // so a single import works; env changes take effect on next call
    return await import("../settings.js");
  }

  it("onEdge() returns false without Edge env vars", async () => {
    delete process.env.TELNYX_RUNTIME_BINDINGS;
    delete process.env.K_SERVICE;
    const { onEdge } = await loadSettings();
    assert.equal(onEdge(), false);
  });

  it("onEdge() returns true with TELNYX_RUNTIME_BINDINGS", async () => {
    process.env.TELNYX_RUNTIME_BINDINGS = "1";
    const { onEdge } = await loadSettings();
    assert.equal(onEdge(), true);
    delete process.env.TELNYX_RUNTIME_BINDINGS;
  });

  it("onEdge() returns true with K_SERVICE", async () => {
    process.env.K_SERVICE = "phone-identity";
    const { onEdge } = await loadSettings();
    assert.equal(onEdge(), true);
    delete process.env.K_SERVICE;
  });

  it("setting() reads plain env var when no PHONEID_ prefix exists", async () => {
    delete process.env.PHONEID_FOO;
    process.env.FOO = "plain_val";
    const { setting } = await loadSettings();
    assert.equal(setting("FOO"), "plain_val");
    delete process.env.FOO;
  });

  it("setting() prefers PHONEID_ prefixed var when both exist", async () => {
    process.env.PHONEID_FOO = "prefixed_val";
    process.env.FOO = "plain_val";
    const { setting } = await loadSettings();
    assert.equal(setting("FOO"), "prefixed_val");
    delete process.env.PHONEID_FOO;
    delete process.env.FOO;
  });

  it("setting() returns undefined for missing vars on Edge", async () => {
    process.env.TELNYX_RUNTIME_BINDINGS = "1";
    delete process.env.PHONEID_MISSING;
    delete process.env.MISSING;
    const { setting } = await loadSettings();
    assert.equal(setting("MISSING"), undefined);
    delete process.env.TELNYX_RUNTIME_BINDINGS;
  });

  it("prefixedOnly: when PHONEID_ vars exist, plain vars are ignored", async () => {
    delete process.env.TELNYX_RUNTIME_BINDINGS;
    delete process.env.K_SERVICE;
    process.env.PHONEID_FOO = "prefixed";
    process.env.BAR = "should_be_ignored";
    delete process.env.PHONEID_BAR;
    const { setting } = await loadSettings();
    // PHONEID_FOO exists → prefixedOnly() is true → plain BAR ignored
    assert.equal(setting("BAR"), undefined);
    delete process.env.PHONEID_FOO;
    delete process.env.BAR;
  });

  it("setting() falls back to plain var when no PHONEID_ vars exist anywhere", async () => {
    delete process.env.TELNYX_RUNTIME_BINDINGS;
    delete process.env.K_SERVICE;
    // Make sure no PHONEID_ vars exist at all
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("PHONEID_")) delete process.env[k];
    }
    process.env.BAR = "plain_fallback";
    const { setting } = await loadSettings();
    assert.equal(setting("BAR"), "plain_fallback");
    delete process.env.BAR;
  });
});

/* ── lookup.js — assessRisk ────────────────────────────────────────── */

describe("assessRisk", () => {
  let assessRisk;

  before(async () => {
    const mod = await import("../lookup.js");
    assessRisk = mod.assessRisk;
  });

  it("trusted: high confidence + name + mobile + not ported + address → score ≥ 70", () => {
    const data = {
      caller_identity: { name: "Sarah Johnson", confidence_score: 85, postal_address: { city: "Austin", state: "TX" } },
      caller_name: { caller_name: "Sarah Johnson" },
      carrier: { name: "T-Mobile", type: "mobile" },
      portability: { ported_status: "not_ported" },
    };
    const r = assessRisk(data);
    assert.ok(r.score >= 70, `expected ≥70, got ${r.score}`);
    assert.equal(r.level, "trusted");
  });

  it("suspicious: no confidence + no name + VoIP + ported + no address → score < 40", () => {
    const data = {
      caller_identity: {},
      caller_name: {},
      carrier: { name: "Unknown", type: "voip" },
      portability: { ported_status: "ported" },
    };
    const r = assessRisk(data);
    assert.ok(r.score < 40, `expected <40, got ${r.score}`);
    assert.equal(r.level, "suspicious");
  });

  it("standard: moderate confidence (60-79) → score 40-69", () => {
    const data = {
      caller_identity: { name: "John Doe", confidence_score: 65 },
      caller_name: { caller_name: "John Doe" },
      carrier: { type: "landline" },
      portability: { ported_status: "not_ported" },
    };
    const r = assessRisk(data);
    // -25 (moderate conf) -10 (no address) = 65
    assert.ok(r.score >= 40 && r.score < 70, `expected 40-69, got ${r.score}`);
    assert.equal(r.level, "standard");
  });

  it("score is clamped to 0-100 range", () => {
    // Maximum negatives: no confidence (-40), no name (-15), voip (-20), ported (-10), no address (-10) = -95 → 5
    const worst = {
      caller_identity: {},
      caller_name: {},
      carrier: { type: "voip" },
      portability: { ported_status: "ported" },
    };
    const r = assessRisk(worst);
    assert.ok(r.score >= 0, "score should not go below 0");
    assert.ok(r.score <= 100, "score should not exceed 100");
  });

  it("no identity confidence deducts 40 points", () => {
    const base = {
      caller_identity: {},
      caller_name: { caller_name: "Name" },
      carrier: { type: "mobile" },
      portability: { ported_status: "not_ported" },
    };
    const r = assessRisk(base);
    // -40 (no confidence) -10 (no address) = 50
    assert.equal(r.score, 50);
  });

  it("no CNAM deducts 15 points", () => {
    const base = {
      caller_identity: { name: "Name", confidence_score: 90, postal_address: { city: "NY", state: "NY" } },
      caller_name: {},
      carrier: { type: "mobile" },
      portability: { ported_status: "not_ported" },
    };
    const r = assessRisk(base);
    // -15 (no cnam) = 85
    assert.equal(r.score, 85);
  });

  it("VoIP line type deducts 20 points", () => {
    const base = {
      caller_identity: { name: "Name", confidence_score: 90, postal_address: { city: "NY", state: "NY" } },
      caller_name: { caller_name: "Name" },
      carrier: { type: "voip" },
      portability: { ported_status: "not_ported" },
    };
    const r = assessRisk(base);
    // -20 (voip) = 80
    assert.equal(r.score, 80);
  });

  it("ported number deducts 10 points", () => {
    const base = {
      caller_identity: { name: "Name", confidence_score: 90, postal_address: { city: "NY", state: "NY" } },
      caller_name: { caller_name: "Name" },
      carrier: { type: "mobile" },
      portability: { ported_status: "ported" },
    };
    const r = assessRisk(base);
    // -10 (ported) = 90
    assert.equal(r.score, 90);
  });

  it("factors array populated with signal/value/impact", () => {
    const data = {
      caller_identity: { name: "Name", confidence_score: 90, postal_address: { city: "Austin", state: "TX" } },
      caller_name: { caller_name: "Name" },
      carrier: { type: "mobile" },
      portability: { ported_status: "not_ported" },
    };
    const r = assessRisk(data);
    assert.ok(r.factors.length >= 4, "should have multiple factors");
    for (const f of r.factors) {
      assert.ok("signal" in f, "factor must have signal");
      assert.ok("value" in f, "factor must have value");
      assert.ok("impact" in f, "factor must have impact");
    }
  });
});

/* ── lookup.js — buildDynamicVars ──────────────────────────────────── */

describe("buildDynamicVars", () => {
  let buildDynamicVars;

  before(async () => {
    const mod = await import("../lookup.js");
    buildDynamicVars = mod.buildDynamicVars;
  });

  it("trusted with name: personalized greeting with first name, skip verification", () => {
    const data = {
      caller_identity: { name: "Sarah Johnson", confidence_score: 85, postal_address: { city: "Austin", state: "TX" } },
      caller_name: { caller_name: "Sarah Johnson" },
      carrier: { name: "T-Mobile", type: "mobile" },
      portability: {},
    };
    const risk = { score: 85, level: "trusted", factors: [] };
    const v = buildDynamicVars(data, risk);
    assert.ok(v.greetingText.includes("Sarah"));
    assert.ok(v.behaviorInstructions.includes("skip identity verification"));
    assert.ok(v.callerContext.includes("Sarah Johnson"));
  });

  it("standard with name: professional greeting, standard verification", () => {
    const data = {
      caller_identity: { name: "John Doe", confidence_score: 65 },
      caller_name: { caller_name: "John Doe" },
      carrier: { name: "AT&T", type: "landline" },
      portability: {},
    };
    const risk = { score: 55, level: "standard", factors: [] };
    const v = buildDynamicVars(data, risk);
    assert.ok(v.behaviorInstructions.includes("Verify their identity"));
    assert.ok(v.callerContext.includes("John Doe"));
  });

  it("standard without name: uses generic reference", () => {
    const data = {
      caller_identity: {},
      caller_name: {},
      carrier: { name: "Unknown", type: "landline" },
      portability: {},
    };
    const risk = { score: 50, level: "standard", factors: [] };
    const v = buildDynamicVars(data, risk);
    assert.ok(v.callerContext.includes("Partially verified caller"));
    assert.ok(!v.callerContext.includes("undefined"));
  });

  it("suspicious: formal greeting, MUST verify, full security", () => {
    const data = {
      caller_identity: {},
      caller_name: {},
      carrier: { type: "voip" },
      portability: { ported_status: "ported" },
    };
    const risk = { score: 25, level: "suspicious", factors: [] };
    const v = buildDynamicVars(data, risk);
    assert.ok(v.behaviorInstructions.includes("MUST verify"));
    assert.ok(v.behaviorInstructions.includes("full name"));
  });

  it("includes confidence value in caller context", () => {
    const data = {
      caller_identity: { name: "Test", confidence_score: 92 },
      caller_name: { caller_name: "Test" },
      carrier: { name: "T-Mobile", type: "mobile" },
      portability: {},
    };
    const risk = { score: 90, level: "trusted", factors: [] };
    const v = buildDynamicVars(data, risk);
    assert.ok(v.callerContext.includes("92"), "should include confidence score");
  });

  it("includes location in caller context when address available", () => {
    const data = {
      caller_identity: { name: "Test", confidence_score: 90, postal_address: { city: "Austin", state: "TX" } },
      caller_name: { caller_name: "Test" },
      carrier: { name: "T-Mobile", type: "mobile" },
      portability: {},
    };
    const risk = { score: 90, level: "trusted", factors: [] };
    const v = buildDynamicVars(data, risk);
    assert.ok(v.callerContext.includes("Austin"), "should include city");
    assert.ok(v.callerContext.includes("TX"), "should include state");
  });
});

/* ── lookup.js — buildIdentityCard ────────────────────────────────── */

describe("buildIdentityCard", () => {
  let buildIdentityCard;

  before(async () => {
    const mod = await import("../lookup.js");
    buildIdentityCard = mod.buildIdentityCard;
  });

  it("all fields populated from full lookup data", () => {
    const data = {
      caller_identity: { name: "Sarah Johnson", confidence_score: 85, postal_address: { city: "Austin", state: "TX" } },
      caller_name: { caller_name: "Sarah Johnson" },
      carrier: { name: "T-Mobile", type: "mobile" },
      portability: { ported_status: "not_ported" },
    };
    const risk = { score: 85, level: "trusted", factors: [{ signal: "s", value: "v", impact: "positive" }] };
    const c = buildIdentityCard("+15125551234", data, risk);
    assert.equal(c.phone, "+15125551234");
    assert.equal(c.name, "Sarah Johnson");
    assert.equal(c.carrier, "T-Mobile");
    assert.equal(c.lineType, "mobile");
    assert.equal(c.confidence, 85);
    assert.equal(c.location, "Austin, TX");
    assert.equal(c.ported, "not_ported");
    assert.equal(c.cnam, "Sarah Johnson");
    assert.equal(c.trustScore, 85);
    assert.equal(c.trustLevel, "trusted");
    assert.equal(c.factors.length, 1);
  });

  it("graceful nulls when data missing", () => {
    const data = { caller_identity: {}, caller_name: {}, carrier: {}, portability: {} };
    const risk = { score: 5, level: "suspicious", factors: [] };
    const c = buildIdentityCard("+10000000000", data, risk);
    assert.equal(c.phone, "+10000000000");
    assert.equal(c.name, null);
    assert.equal(c.carrier, null);
    assert.equal(c.lineType, null);
    assert.equal(c.confidence, null);
    assert.equal(c.location, null);
    assert.equal(c.trustScore, 5);
  });

  it("falls back caller_name → caller_identity.name", () => {
    const data = {
      caller_identity: { name: "Identity Name" },
      caller_name: {},
      carrier: {},
      portability: {},
    };
    const risk = { score: 50, level: "standard", factors: [] };
    const c = buildIdentityCard("+11111111111", data, risk);
    assert.equal(c.name, "Identity Name");
  });

  it("includes trust score/level/factors from risk", () => {
    const data = { caller_identity: {}, caller_name: {}, carrier: {}, portability: {} };
    const factors = [
      { signal: "A", value: "1", impact: "positive" },
      { signal: "B", value: "2", impact: "negative" },
    ];
    const risk = { score: 42, level: "standard", factors };
    const c = buildIdentityCard("+12222222222", data, risk);
    assert.equal(c.trustScore, 42);
    assert.equal(c.trustLevel, "standard");
    assert.deepEqual(c.factors, factors);
  });
});

/* ── lookup.js — numberLookup ─────────────────────────────────────── */

describe("numberLookup", () => {
  let numberLookup;
  let originalFetch;

  before(async () => {
    const mod = await import("../lookup.js");
    numberLookup = mod.numberLookup;
    originalFetch = globalThis.fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    // Clear the module's internal cache by looking up a unique number each time
    // For cache tests we use specific numbers
  });

  it("throws when TELNYX_API_KEY not configured", async () => {
    const savedKey = process.env.TELNYX_API_KEY;
    const savedPrefixed = process.env.PHONEID_TELNYX_API_KEY;
    delete process.env.TELNYX_API_KEY;
    delete process.env.PHONEID_TELNYX_API_KEY;
    // Also clear any other PHONEID_ vars to avoid prefixedOnly blocking fallback
    const savedEnv = {};
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("PHONEID_")) { savedEnv[k] = process.env[k]; delete process.env[k]; }
    }

    await assert.rejects(() => numberLookup("+19999999999"), { message: /TELNYX_API_KEY/ });

    // Restore
    for (const [k, v] of Object.entries(savedEnv)) process.env[k] = v;
    if (savedKey) process.env.TELNYX_API_KEY = savedKey;
    if (savedPrefixed) process.env.PHONEID_TELNYX_API_KEY = savedPrefixed;
  });

  it("calls API and returns data (mock fetch)", async () => {
    process.env.TELNYX_API_KEY = "test_key_for_lookup";
    const mockData = { phone_number: "+15550001111", carrier: { name: "Test" }, caller_name: {} };
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ data: mockData }),
    });

    const result = await numberLookup("+15550001111");
    assert.equal(result.phone_number, "+15550001111");
    assert.equal(result.carrier.name, "Test");

    delete process.env.TELNYX_API_KEY;
    globalThis.fetch = originalFetch;
  });

  it("returns cached data within TTL", async () => {
    process.env.TELNYX_API_KEY = "test_key_for_cache";
    let fetchCount = 0;
    const mockData = { phone_number: "+15550002222", carrier: { name: "Cached" } };
    globalThis.fetch = async () => {
      fetchCount++;
      return { ok: true, json: async () => ({ data: mockData }) };
    };

    await numberLookup("+15550002222");
    await numberLookup("+15550002222");
    assert.equal(fetchCount, 1, "second call should use cache");

    delete process.env.TELNYX_API_KEY;
    globalThis.fetch = originalFetch;
  });

  it("returns fallback data on API error", async () => {
    process.env.TELNYX_API_KEY = "test_key_for_error";
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      text: async () => "Server Error",
    });

    const result = await numberLookup("+15550003333");
    assert.equal(result.phone_number, "+15550003333");
    assert.deepEqual(result.carrier, {});
    assert.deepEqual(result.caller_name, {});

    delete process.env.TELNYX_API_KEY;
    globalThis.fetch = originalFetch;
  });
});
