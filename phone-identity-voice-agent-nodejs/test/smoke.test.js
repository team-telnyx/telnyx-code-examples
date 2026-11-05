/* ------------------------------------------------------------------ *
 *  smoke.test.js — Basic smoke tests (node:test)                      *
 * ------------------------------------------------------------------ */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

/* ── settings.js ───────────────────────────────────────────────────── */

describe("settings", () => {
  it("exports onEdge and setting functions", async () => {
    const { onEdge, setting } = await import("../settings.js");
    assert.equal(typeof onEdge, "function");
    assert.equal(typeof setting, "function");
    assert.equal(onEdge(), false, "should not be on Edge in test");
  });
});

/* ── lookup.js — risk assessment ───────────────────────────────────── */

describe("assessRisk", () => {
  let assessRisk, buildDynamicVars, buildIdentityCard;

  it("imports lookup module", async () => {
    const mod = await import("../lookup.js");
    assessRisk = mod.assessRisk;
    buildDynamicVars = mod.buildDynamicVars;
    buildIdentityCard = mod.buildIdentityCard;
    assert.ok(assessRisk);
    assert.ok(buildDynamicVars);
    assert.ok(buildIdentityCard);
  });

  it("scores a trusted caller high", () => {
    const data = {
      caller_identity: { name: "Sarah Johnson", confidence_score: 85, postal_address: { city: "Austin", state: "TX" } },
      caller_name: { caller_name: "Sarah Johnson" },
      carrier: { name: "T-Mobile", type: "mobile" },
      portability: { ported_status: "not_ported" },
    };
    const risk = assessRisk(data);
    assert.ok(risk.score >= 70, `expected trusted (>=70), got ${risk.score}`);
    assert.equal(risk.level, "trusted");
    assert.ok(risk.factors.length > 0);
  });

  it("scores a suspicious caller low", () => {
    const data = {
      caller_identity: {},
      caller_name: {},
      carrier: { name: "Unknown", type: "voip" },
      portability: { ported_status: "ported" },
    };
    const risk = assessRisk(data);
    assert.ok(risk.score < 40, `expected suspicious (<40), got ${risk.score}`);
    assert.equal(risk.level, "suspicious");
  });

  it("buildDynamicVars returns trusted greeting with name", () => {
    const data = {
      caller_identity: { name: "Sarah Johnson", confidence_score: 85, postal_address: { city: "Austin", state: "TX" } },
      caller_name: { caller_name: "Sarah Johnson" },
      carrier: { name: "T-Mobile", type: "mobile" },
      portability: {},
    };
    const risk = { score: 85, level: "trusted", factors: [] };
    const vars = buildDynamicVars(data, risk);
    assert.ok(vars.greetingText.includes("Sarah"), "greeting should include first name");
    assert.ok(vars.callerContext.includes("Sarah Johnson"), "context should include full name");
  });

  it("buildDynamicVars returns verification for suspicious", () => {
    const data = {
      caller_identity: {},
      caller_name: {},
      carrier: { type: "voip" },
      portability: { ported_status: "ported" },
    };
    const risk = { score: 25, level: "suspicious", factors: [] };
    const vars = buildDynamicVars(data, risk);
    assert.ok(vars.behaviorInstructions.includes("MUST verify"), "should require verification");
  });

  it("buildIdentityCard returns structured data", () => {
    const data = {
      caller_identity: { name: "Test User", confidence_score: 75 },
      caller_name: { caller_name: "Test User" },
      carrier: { name: "AT&T", type: "mobile" },
      portability: { line_type: "mobile" },
    };
    const risk = { score: 75, level: "trusted", factors: [{ signal: "test", impact: "positive" }] };
    const card = buildIdentityCard("+15125551234", data, risk);
    assert.equal(card.phone, "+15125551234");
    assert.equal(card.name, "Test User");
    assert.equal(card.trustScore, 75);
    assert.equal(card.trustLevel, "trusted");
  });
});

/* ── server.js — syntax & imports ──────────────────────────────────── */

describe("server module", () => {
  it("can be checked with node --check (syntax valid)", async () => {
    const { execFileSync } = await import("node:child_process");
    const root = new URL("..", import.meta.url).pathname;
    // node --check validates syntax without executing
    execFileSync("node", ["--check", `${root}server.js`]);
  });
});
