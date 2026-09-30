import assert from "node:assert/strict";
import test from "node:test";
import { createLogger, redactValue, logRequest } from "../src/logger.js";

test("redactValue removes prompt, completion, authorization, receipt, and token fields", () => {
  const input = {
    prompt: "secret prompt text",
    completion: "secret output",
    authorization: "Bearer sk-tr-v1-abc",
    receipt: "eyJ...",
    "api-key": "sk-tr-v1-abc",
    demoAccessToken: "token-value",
    body: { prompt: "nested secret" },
    safe: "operational value",
    count: 42,
  };
  const output = redactValue(input) as Record<string, unknown>;
  assert.equal(output.prompt, "[redacted]");
  assert.equal(output.completion, "[redacted]");
  assert.equal(output.authorization, "[redacted]");
  assert.equal(output.receipt, "[redacted]");
  assert.equal(output["api-key"], "[redacted]");
  const body = output.body as Record<string, unknown>;
  assert.equal(body.prompt, "[redacted]");
  assert.equal(output.safe, "operational value");
  assert.equal(output.count, 42);
});

test("whitelisted token-count and verification keys are not redacted", () => {
  const output = redactValue({
    promptTokens: 18,
    completionTokens: 14,
    receiptVerified: true,
  }) as Record<string, unknown>;
  assert.equal(output.promptTokens, 18);
  assert.equal(output.completionTokens, 14);
  assert.equal(output.receiptVerified, true);
});

test("redactValue catches bearer-shaped values regardless of key name", () => {
  const output = redactValue({ note: "sk-tr-v1-very-secret" }) as Record<string, string>;
  assert.equal(output.note, "[redacted]");
});

test("logger never writes prohibited fields", () => {
  const lines: string[] = [];
  const logger = createLogger((line) => lines.push(line));
  logger.info({
    event: "request",
    authorization: "Bearer sk-tr-v1-abc",
    prompt: "user prompt",
    receipt: "jws",
    requestId: "abc",
    route: "/api/inference",
    status: 200,
  });
  const line = lines[0] ?? "";
  assert.ok(!line.includes("sk-tr-v1-abc"));
  assert.ok(!line.includes("user prompt"));
  assert.ok(!line.includes("jws"));
});

test("logRequest drops every field outside the whitelist", () => {
  const lines: string[] = [];
  const logger = createLogger((line) => lines.push(line));
  logRequest(logger, {
    event: "inference_ok",
    requestId: "req-1",
    route: "/api/inference",
    method: "POST",
    status: 200,
    durationMs: 12,
    model: "z-ai/glm-5.3-flash",
    provider: "telnyx",
  });
  const parsed = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(parsed).sort(),
    ["event", "level", "method", "model", "provider", "requestId", "route", "status", "time", "durationMs"].sort()
  );
  assert.ok(!JSON.stringify(parsed).includes("prompt"));
});
