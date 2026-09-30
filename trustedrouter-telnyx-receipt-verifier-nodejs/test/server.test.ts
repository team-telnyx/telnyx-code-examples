import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { loadConfig, type AppConfig } from "../src/config.js";
import { createRequestHandler, type ServerDeps } from "../src/server.js";
import type { ReceiptCheckResult } from "../src/receipts.js";

const CATALOG_URL = "https://api.trustedrouter.com/v1/models";
const INFERENCE_URL = "https://api.trustedrouter.com/v1/chat/completions";

function zdrModel(id: string, provider = "telnyx"): Record<string, unknown> {
  return {
    id,
    name: id,
    context_length: 32768,
    pricing: { prompt: "0.000000211", completion: "0.000000633" },
    trustedrouter: {
      endpoints: [
        { provider, provider_zero_data_retention: true, usage_type: "Credits" },
      ],
    },
  };
}

function catalogResponse(): Response {
  return new Response(
    JSON.stringify({
      data: [
        zdrModel("z-ai/glm-5.3-flash"),
        zdrModel("qwen/qwen3-235b-a22b"),
        zdrModel("openai/gpt-x", "openai"),
        zdrModel("z-ai/glm-5.2-nozdr"),
      ].map((m) =>
        m.id === "z-ai/glm-5.2-nozdr"
          ? { ...m, trustedrouter: { endpoints: [{ provider: "telnyx", provider_zero_data_retention: false }] } }
          : m
      ),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

const SUCCESS_BODY_TEXT = JSON.stringify({
  id: "chatcmpl-test",
  object: "chat.completion",
  model: "z-ai/glm-5.3-flash",
  choices: [
    { index: 0, message: { role: "assistant", content: "Edge inference runs the model near the user." }, finish_reason: "stop" },
  ],
  usage: { prompt_tokens: 18, completion_tokens: 14, total_tokens: 32 },
  trustedrouter: {
    routing: { selected_provider: "telnyx", selected_model: "z-ai/glm-5.3-flash", selected_endpoint: "z-ai/glm-5.3-flash@telnyx/prepaid" },
  },
});

function upstreamSuccess(options: { withReceipt?: boolean } = {}): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.withReceipt !== false) headers["x-inference-receipt"] = "eyJhbGciOiJFZERTQSJ9.eyJydmiZj6.xsig";
  return new Response(SUCCESS_BODY_TEXT, { status: 200, headers });
}

function verifiedResult(overrides: Partial<ReceiptCheckResult> = {}): ReceiptCheckResult {
  return {
    verified: true,
    nonceMatched: true,
    requestHashMatched: true,
    responseHashMatched: true,
    signatureValid: true,
    fresh: true,
    attestationValid: true,
    issuedAt: "2026-09-29T18:00:00.000Z",
    verifiedAt: "2026-09-29T18:00:01.000Z",
    failureCode: null,
    failureMessage: null,
    claims: {
      rv: 1,
      issuer: "https://api.trustedrouter.com",
      route: "chat.completions",
      requestedModel: "z-ai/glm-5.3-flash",
      selectedModel: "z-ai/glm-5.3-flash",
      provider: "telnyx",
      endpoint: "z-ai/glm-5.3-flash@telnyx/prepaid",
      upstreamTier: "tls-webpki",
      upstreamPolicy: null,
      attestationStatus: "verified",
      attSha256: "abc",
      nonceEchoed: "nonce",
      responseId: "chatcmpl-test",
      generationId: "gen-x",
      requestHash: "reqhash",
      responseHash: "resphash",
    },
    ...overrides,
  };
}

interface Harness {
  config: AppConfig;
  deps: ServerDeps;
  upstreamCalls: Array<{ url: string; init: RequestInit | undefined }>;
  upstreamResponder: (url: string, init?: RequestInit) => Response | Promise<Response>;
  verifier: (options: unknown) => Promise<ReceiptCheckResult>;
  verifierCalls: Array<Record<string, unknown>>;
  fetchAttestation: (receipt: string, options: unknown) => Promise<Uint8Array | null>;
  attestationCalls: number;
}

function makeHarness(overrides: Partial<AppConfig> = {}): Harness {
  const harness: Harness = {
    config: { ...loadConfig({ TRUSTEDROUTER_API_KEY: "sk-tr-v1-test-key" }), ...overrides },
    deps: { fetchImpl: async () => new Response("", { status: 500 }) },
    upstreamCalls: [],
    upstreamResponder: () => upstreamSuccess(),
    verifier: async (options) => {
      const typed = options as { receipt?: string | null };
      if (typed.receipt === null || typed.receipt === undefined || typed.receipt.trim() === "") {
        return {
          verified: false,
          nonceMatched: null,
          requestHashMatched: null,
          responseHashMatched: null,
          signatureValid: null,
          fresh: null,
          attestationValid: null,
          issuedAt: null,
          verifiedAt: new Date().toISOString(),
          failureCode: "MISSING_RECEIPT",
          failureMessage: "The upstream response carried no signed receipt header.",
          claims: null,
        };
      }
      return verifiedResult();
    },
    verifierCalls: [],
    fetchAttestation: async () => null,
    attestationCalls: 0,
  };
  harness.deps = {
    fetchImpl: async (url, init) => {
      const target = String(url);
      if (target === CATALOG_URL) return catalogResponse();
      harness.upstreamCalls.push({ url: target, init });
      return harness.upstreamResponder(target, init);
    },
    verifyReceiptImpl: async (options) => {
      harness.verifierCalls.push(options as unknown as Record<string, unknown>);
      return harness.verifier(options);
    },
    fetchAttestationImpl: async (receipt, options) => {
      harness.attestationCalls += 1;
      return harness.fetchAttestation(receipt, options);
    },
  };
  return harness;
}

function startServer(harness: Harness): Promise<{ server: http.Server; port: number }> {
  const handler = createRequestHandler(harness.config, harness.deps);
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      void handler(req, res);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({ server, port });
    });
  });
}

function post(port: number, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("server", () => {
  let instance: { server: http.Server; port: number } | null = null;

  before(async () => {
    instance = await startServer(makeHarness());
  });

  after(() => {
    instance?.server.close();
  });

  it("GET /health returns the service identity", async () => {
    const response = await fetch(`http://127.0.0.1:${instance?.port}/health`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.status, "ok");
    assert.equal(body.service, "trustedrouter-telnyx-receipt-explorer");
    assert.equal(body.version, "1.0.0");
  });

  it("GET /api/models filters to Telnyx ZDR models only", async () => {
    const response = await fetch(`http://127.0.0.1:${instance?.port}/api/models`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { models: Array<{ id: string }>; source: string; routingControls: Record<string, unknown>; inferenceAuthRequired: boolean };
    assert.deepEqual(
      body.models.map((m) => m.id),
      ["z-ai/glm-5.3-flash", "qwen/qwen3-235b-a22b"]
    );
    assert.equal(body.source, "live");
    assert.deepEqual(body.routingControls, { providerOnly: ["telnyx"], minPrivacy: "zdr", allowFallbacks: false });
    assert.equal(body.inferenceAuthRequired, false);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  it("successful inference returns the normalized application contract", async () => {
    const harness = makeHarness();
    const running = await startServer(harness);
    try {
      const response = await post(running.port, "/api/inference", { model: "z-ai/glm-5.3-flash", prompt: "Explain edge inference in one sentence." });
      assert.equal(response.status, 200);
      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(body.output, "Edge inference runs the model near the user.");
      assert.equal(body.requestedModel, "z-ai/glm-5.3-flash");
      assert.equal(body.selectedModel, "z-ai/glm-5.3-flash");
      assert.equal(body.provider, "telnyx");
      assert.ok(typeof body.durationMs === "number");
      assert.deepEqual(body.usage, { promptTokens: 18, completionTokens: 14, totalTokens: 32 });
      const verification = body.verification as Record<string, unknown>;
      assert.equal(verification.verified, true);
      assert.equal(verification.nonceMatched, true);
      assert.equal(verification.attestationValid, true);
      const receipt = body.receipt as { compact: string; claims: Record<string, unknown> };
      assert.ok(receipt.compact.length > 0);
      assert.ok(receipt.claims !== null);

      const call = harness.upstreamCalls[0];
      assert.equal(call?.url, INFERENCE_URL);
      const headers = (call?.init?.headers ?? {}) as Record<string, string>;
      assert.equal(headers["Authorization"], "Bearer sk-tr-v1-test-key");
      assert.ok((headers["x-inference-receipt"] ?? "").length > 0);
      const sentBody = JSON.parse(String(call?.init?.body)) as { provider: Record<string, unknown> };
      assert.deepEqual(sentBody.provider, { only: ["telnyx"], min_privacy: "zdr", allow_fallbacks: false });

      const verifierOptions = harness.verifierCalls[0] as Record<string, unknown>;
      assert.equal(verifierOptions.receipt, "eyJhbGciOiJFZERTQSJ9.eyJydmiZj6.xsig");
      assert.equal(verifierOptions.expectedIssuer, "https://api.trustedrouter.com");
      assert.equal(verifierOptions.maxAgeSeconds, 300);
      const requestBytes = verifierOptions.requestBytes as Uint8Array;
      const expectedBytes = Buffer.from(String(call?.init?.body), "utf8");
      assert.deepEqual(Buffer.from(requestBytes), expectedBytes);
    } finally {
      running.server.close();
    }
  });

  it("missing receipt is rejected as a verification failure, not a success", async () => {
    const harness = makeHarness();
    harness.upstreamResponder = () => upstreamSuccess({ withReceipt: false });
    const running = await startServer(harness);
    try {
      const response = await post(running.port, "/api/inference", { model: "z-ai/glm-5.3-flash", prompt: "hi" });
      assert.equal(response.status, 200);
      const body = (await response.json()) as Record<string, unknown>;
      const verification = body.verification as Record<string, unknown>;
      assert.equal(verification.verified, false);
      assert.equal(verification.failureCode, "MISSING_RECEIPT");
      assert.equal(body.selectedModel, null);
      assert.equal(body.provider, null);
      assert.equal(body.output, "Edge inference runs the model near the user.");
    } finally {
      running.server.close();
    }
  });

  it("a non-Telnyx verified route is rejected even though the response succeeded", async () => {
    const harness = makeHarness();
    harness.verifier = async () => verifiedResult({ claims: { ...(verifiedResult().claims as NonNullable<ReceiptCheckResult["claims"]>), provider: "someother" } });
    const running = await startServer(harness);
    try {
      const response = await post(running.port, "/api/inference", { model: "z-ai/glm-5.3-flash", prompt: "hi" });
      assert.equal(response.status, 502);
      const body = (await response.json()) as Record<string, unknown>;
      const error = body.error as { code: string };
      assert.equal(error.code, "PROVIDER_MISMATCH");
      assert.ok(body.verification);
    } finally {
      running.server.close();
    }
  });

  it("a different selected model is rejected as MODEL_MISMATCH", async () => {
    const harness = makeHarness();
    harness.verifier = async () => verifiedResult({ claims: { ...(verifiedResult().claims as NonNullable<ReceiptCheckResult["claims"]>), selectedModel: "qwen/qwen3-235b-a22b" } });
    const running = await startServer(harness);
    try {
      const response = await post(running.port, "/api/inference", { model: "z-ai/glm-5.3-flash", prompt: "hi" });
      assert.equal(response.status, 502);
      const body = (await response.json()) as { error: { code: string } };
      assert.equal(body.error.code, "MODEL_MISMATCH");
    } finally {
      running.server.close();
    }
  });

  it("client input cannot weaken the routing object", async () => {
    const harness = makeHarness();
    const running = await startServer(harness);
    try {
      await post(running.port, "/api/inference", {
        model: "z-ai/glm-5.3-flash",
        prompt: "hi",
        provider: { only: ["openai"], min_privacy: "none", allow_fallbacks: true },
      });
      const sent = JSON.parse(String(harness.upstreamCalls[0]?.init?.body)) as { provider: Record<string, unknown> };
      assert.deepEqual(sent.provider, { only: ["telnyx"], min_privacy: "zdr", allow_fallbacks: false });
    } finally {
      running.server.close();
    }
  });

  it("exact serialized request bytes reach the verifier", async () => {
    const harness = makeHarness();
    const running = await startServer(harness);
    try {
      await post(running.port, "/api/inference", { model: "z-ai/glm-5.3-flash", prompt: "exact bytes" });
      const sent = String(harness.upstreamCalls[0]?.init?.body);
      const verifierOptions = harness.verifierCalls[0] as Record<string, unknown>;
      assert.deepEqual(Buffer.from(verifierOptions.requestBytes as Uint8Array), Buffer.from(sent, "utf8"));
    } finally {
      running.server.close();
    }
  });

  it("exact raw response bytes reach the verifier", async () => {
    const harness = makeHarness();
    const running = await startServer(harness);
    try {
      await post(running.port, "/api/inference", { model: "z-ai/glm-5.3-flash", prompt: "exact bytes" });
      const verifierOptions = harness.verifierCalls[0] as Record<string, unknown>;
      assert.deepEqual(Buffer.from(verifierOptions.responseBytes as Uint8Array), Buffer.from(SUCCESS_BODY_TEXT, "utf8"));
    } finally {
      running.server.close();
    }
  });

  it("upstream 400 maps to NO_TELNYX_ROUTE", async () => {
    const harness = makeHarness();
    harness.upstreamResponder = () => new Response(JSON.stringify({ error: { type: "invalid_request_error", message: "no endpoints matched provider filters" } }), { status: 400 });
    const running = await startServer(harness);
    try {
      const response = await post(running.port, "/api/inference", { model: "z-ai/glm-5.3-flash", prompt: "hi" });
      assert.equal(response.status, 502);
      const body = (await response.json()) as { error: { code: string; message: string } };
      assert.equal(body.error.code, "NO_TELNYX_ROUTE");
      assert.match(body.error.message, /Telnyx route|provider filters/i);
      assert.ok(!JSON.stringify(body).includes("sk-tr-v1-test-key"));
    } finally {
      running.server.close();
    }
  });

  it("upstream 401 maps to AUTH_FAILED; 402 to INSUFFICIENT_CREDITS; 429 to UPSTREAM_RATE_LIMITED", async () => {
    for (const [status, code] of [[401, "AUTH_FAILED"], [402, "INSUFFICIENT_CREDITS"], [429, "UPSTREAM_RATE_LIMITED"]] as const) {
      const harness = makeHarness();
      harness.upstreamResponder = () => new Response(JSON.stringify({ error: { type: "x" } }), { status, headers: status === 429 ? { "Retry-After": "7" } : {} });
      const running = await startServer(harness);
      try {
        const response = await post(running.port, "/api/inference", { model: "z-ai/glm-5.3-flash", prompt: "hi" });
        assert.equal(response.status, 502);
        const body = (await response.json()) as { error: { code: string } };
        assert.equal(body.error.code, code, `status ${status}`);
      } finally {
        running.server.close();
      }
    }
  });

  it("upstream timeout maps to TIMEOUT and network failure to NETWORK_ERROR", async () => {
    const timeoutHarness = makeHarness();
    timeoutHarness.upstreamResponder = () => {
      const error = new Error("aborted");
      error.name = "TimeoutError";
      throw error;
    };
    const timeoutServer = await startServer(timeoutHarness);
    try {
      const response = await post(timeoutServer.port, "/api/inference", { model: "z-ai/glm-5.3-flash", prompt: "hi" });
      assert.equal(response.status, 504);
      const body = (await response.json()) as { error: { code: string } };
      assert.equal(body.error.code, "TIMEOUT");
    } finally {
      timeoutServer.server.close();
    }

    const networkHarness = makeHarness();
    networkHarness.upstreamResponder = () => {
      throw new Error("ECONNREFUSED");
    };
    const networkServer = await startServer(networkHarness);
    try {
      const response = await post(networkServer.port, "/api/inference", { model: "z-ai/glm-5.3-flash", prompt: "hi" });
      assert.equal(response.status, 502);
      const body = (await response.json()) as { error: { code: string } };
      assert.equal(body.error.code, "NETWORK_ERROR");
    } finally {
      networkServer.server.close();
    }
  });

  it("malformed upstream JSON maps to UPSTREAM_ERROR without leaking the body", async () => {
    const harness = makeHarness();
    harness.upstreamResponder = () => new Response("}{ not json", { status: 200, headers: { "x-inference-receipt": "r" } });
    const running = await startServer(harness);
    try {
      const response = await post(running.port, "/api/inference", { model: "z-ai/glm-5.3-flash", prompt: "hi" });
      assert.equal(response.status, 502);
      const body = (await response.json()) as { error: { code: string } };
      assert.equal(body.error.code, "UPSTREAM_ERROR");
      assert.ok(!JSON.stringify(body).includes("not json"));
    } finally {
      running.server.close();
    }
  });

  it("invalid input returns a bounded 400", async () => {
    const running = await startServer(makeHarness());
    try {
      const missing = await post(running.port, "/api/inference", {});
      assert.equal(missing.status, 400);
      const emptyPrompt = await post(running.port, "/api/inference", { model: "z-ai/glm-5.3-flash", prompt: "" });
      assert.equal(emptyPrompt.status, 400);
      const longPrompt = await post(running.port, "/api/inference", { model: "z-ai/glm-5.3-flash", prompt: "x".repeat(5000) });
      assert.equal(longPrompt.status, 400);
      const badModel = await post(running.port, "/api/inference", { model: "bad model id", prompt: "hi" });
      assert.equal(badModel.status, 400);
      const unknownModel = await post(running.port, "/api/inference", { model: "openai/gpt-x", prompt: "hi" });
      assert.equal(unknownModel.status, 400);
      const body = (await unknownModel.json()) as { error: { code: string } };
      assert.equal(body.error.code, "UNKNOWN_MODEL");
      const hugeBody = await post(running.port, "/api/inference", JSON.stringify({ model: "z-ai/glm-5.3-flash", prompt: "x".repeat(70_000) }));
      assert.equal(hugeBody.status, 413);
    } finally {
      running.server.close();
    }
  });

  it("missing server configuration fails clearly", async () => {
    const harness = makeHarness();
    harness.config = { ...harness.config, trustedRouterApiKey: null };
    const running = await startServer(harness);
    try {
      const response = await post(running.port, "/api/inference", { model: "z-ai/glm-5.3-flash", prompt: "hi" });
      assert.equal(response.status, 500);
      const body = (await response.json()) as { error: { code: string; message: string } };
      assert.equal(body.error.code, "MISSING_SERVER_KEY");
      assert.ok(!body.error.message.includes("sk-tr"));
    } finally {
      running.server.close();
    }
  });

  it("demo access token is enforced when configured", async () => {
    const harness = makeHarness({ demoAccessToken: "secret-demo-token" });
    const running = await startServer(harness);
    try {
      const missing = await post(running.port, "/api/inference", { model: "z-ai/glm-5.3-flash", prompt: "hi" });
      assert.equal(missing.status, 401);
      const missingBody = (await missing.json()) as { error: { code: string } };
      assert.equal(missingBody.error.code, "MISSING_TOKEN");

      const wrong = await post(running.port, "/api/inference", { model: "z-ai/glm-5.3-flash", prompt: "hi" }, { Authorization: "Bearer wrong" });
      assert.equal(wrong.status, 401);
      const wrongBody = (await wrong.json()) as { error: { code: string } };
      assert.equal(wrongBody.error.code, "INVALID_TOKEN");

      const ok = await post(running.port, "/api/inference", { model: "z-ai/glm-5.3-flash", prompt: "hi" }, { Authorization: "Bearer secret-demo-token" });
      assert.equal(ok.status, 200);
    } finally {
      running.server.close();
    }
  });

  it("cross-origin requests are rejected", async () => {
    const running = await startServer(makeHarness());
    try {
      const response = await post(running.port, "/api/inference", { model: "z-ai/glm-5.3-flash", prompt: "hi" }, { Origin: "https://evil.example" });
      assert.equal(response.status, 403);
      const body = (await response.json()) as { error: { code: string } };
      assert.equal(body.error.code, "FORBIDDEN_ORIGIN");
    } finally {
      running.server.close();
    }
  });

  it("rate limiter returns 429 after the per-window cap", async () => {
    const harness = makeHarness();
    harness.config = { ...harness.config, trustedRouterApiKey: null };
    const running = await startServer(harness);
    try {
      let sawLimit = false;
      for (let i = 0; i < 40; i += 1) {
        const response = await post(running.port, "/api/inference", { model: "z-ai/glm-5.3-flash", prompt: "hi" });
        if (response.status === 429) {
          sawLimit = true;
          assert.ok(response.headers.get("retry-after") !== null);
          break;
        }
      }
      assert.equal(sawLimit, true);
    } finally {
      running.server.close();
    }
  });

  it("static assets are served and unknown paths 404", async () => {
    const running = await startServer(makeHarness());
    try {
      const page = await fetch(`http://127.0.0.1:${running.port}/`);
      assert.equal(page.status, 200);
      assert.match(page.headers.get("content-type") ?? "", /text\/html/);
      assert.match(await page.text(), /TrustedRouter/);
      const script = await fetch(`http://127.0.0.1:${running.port}/app.js`);
      assert.equal(script.status, 200);
      assert.match(script.headers.get("content-type") ?? "", /javascript/);
      const missing = await fetch(`http://127.0.0.1:${running.port}/../etc/passwd`);
      assert.equal(missing.status, 404);
      const missingFile = await fetch(`http://127.0.0.1:${running.port}/nope.txt`);
      assert.equal(missingFile.status, 404);
    } finally {
      running.server.close();
    }
  });

  it("security headers are present on responses", async () => {
    const running = await startServer(makeHarness());
    try {
      const response = await fetch(`http://127.0.0.1:${running.port}/health`);
      assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'none'/);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("x-frame-options"), "DENY");
      assert.equal(response.headers.get("referrer-policy"), "no-referrer");
      assert.equal(response.headers.get("cache-control"), "no-store");
    } finally {
      running.server.close();
    }
  });
});
