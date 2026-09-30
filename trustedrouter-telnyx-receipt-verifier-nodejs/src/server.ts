/**
 * HTTP server: static UI, health, model catalog, and the receipt-verified
 * inference endpoint.
 *
 * Security controls: same-origin enforcement, optional demo access token,
 * in-memory rate limiting (per instance), bounded request bodies, finite
 * upstream timeouts, strict security headers, and secret-free logging.
 * The TrustedRouter API key never leaves the server process.
 */
import http from "node:http";
import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "./config.js";
import { missingConfigProblems } from "./config.js";
import { AppError, appErrorFromStatus, type AppErrorCode } from "./errors.js";
import { createLogger, logRequest, type Logger } from "./logger.js";
import { generateReceiptNonce } from "./nonce.js";
import { buildChatRequest, TELNYX_ONLY_ROUTING } from "./requestBuilder.js";
import {
  fetchReceiptAttestation,
  verifyInferenceReceipt,
  type ReceiptCheckResult,
  type VerifyInferenceReceiptOptions,
} from "./receipts.js";
import { CatalogService, type CatalogResult } from "./catalog.js";

export interface ServerDeps {
  fetchImpl: typeof fetch;
  verifyReceiptImpl?: (options: VerifyInferenceReceiptOptions) => Promise<ReceiptCheckResult>;
  fetchAttestationImpl?: typeof fetchReceiptAttestation;
  logger?: Logger;
  now?: () => number;
}

const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const MAX_UPSTREAM_RESPONSE_BYTES = 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;

const STATIC_FILES: Record<string, { path: string; type: string }> = {
  "/": { path: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { path: "index.html", type: "text/html; charset=utf-8" },
  "/styles.css": { path: "styles.css", type: "text/css; charset=utf-8" },
  "/app.js": { path: "app.js", type: "text/javascript; charset=utf-8" },
};

const MODEL_ID_PATTERN = /^[A-Za-z0-9._/-]{1,160}$/;

/**
 * Resolve the public/ directory whether the server runs from TypeScript
 * source (src/) or from compiled output (dist/src/).
 */
function resolvePublicDir(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), "public"),
    join(moduleDir, "..", "public"),
    join(moduleDir, "..", "..", "public"),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "index.html"))) return normalize(candidate);
  }
  return normalize(candidates[0] as string);
}

interface NormalizedInferenceResponse {
  output: string | null;
  requestedModel: string;
  selectedModel: string | null;
  provider: string | null;
  durationMs: number;
  usage: {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
  } | null;
  verification: Record<string, unknown>;
  receipt: { compact: string; claims: Record<string, unknown> | null };
}

interface UpstreamFailure {
  type: string | null;
  message: string | null;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(payload.length),
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(payload);
}

function applySecurityHeaders(res: http.ServerResponse): void {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

function extractUpstreamFailure(bytes: Uint8Array): UpstreamFailure {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
      error?: { type?: unknown; code?: unknown; message?: unknown };
    };
    const err = parsed?.error;
    if (err === null || err === undefined) return { type: null, message: null };
    return {
      type: typeof err.type === "string" ? err.type : typeof err.code === "string" ? err.code : null,
      message: typeof err.message === "string" ? truncate(err.message, 200) : null,
    };
  } catch {
    return { type: null, message: null };
  }
}

function parseUpstreamJson(bytes: Uint8Array): Record<string, unknown> {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("response is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeUsage(raw: unknown): NormalizedInferenceResponse["usage"] {
  if (raw === null || typeof raw !== "object") return null;
  const usage = raw as Record<string, unknown>;
  const promptTokens = asNumber(usage.prompt_tokens);
  const completionTokens = asNumber(usage.completion_tokens);
  const totalTokens = asNumber(usage.total_tokens);
  if (promptTokens === null && completionTokens === null && totalTokens === null) return null;
  return { promptTokens, completionTokens, totalTokens };
}

function extractOutput(parsed: Record<string, unknown>): string | null {
  const choices = parsed.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (first === null || typeof first !== "object") return null;
  const message = (first as Record<string, unknown>).message;
  if (message === null || typeof message !== "object") return null;
  const content = (message as Record<string, unknown>).content;
  if (typeof content !== "string") return null;
  return content;
}

export class InMemoryRateLimiter {
  private readonly entries = new Map<string, { count: number; windowStart: number }>();
  constructor(
    private readonly windowMs: number = RATE_LIMIT_WINDOW_MS,
    private readonly maxRequests: number = RATE_LIMIT_MAX_REQUESTS,
    private readonly now: () => number = Date.now
  ) {}

  check(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const current = this.now();
    const entry = this.entries.get(key);
    if (entry === undefined || current - entry.windowStart >= this.windowMs) {
      this.entries.set(key, { count: 1, windowStart: current });
      if (this.entries.size > 10_000) {
        for (const [existingKey, existing] of this.entries) {
          if (current - existing.windowStart >= this.windowMs) this.entries.delete(existingKey);
        }
      }
      return { allowed: true, retryAfterSeconds: 0 };
    }
    entry.count += 1;
    if (entry.count > this.maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((entry.windowStart + this.windowMs - current) / 1000));
      return { allowed: false, retryAfterSeconds: retryAfter };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

function tokensEqual(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}

function clientKeyOf(req: http.IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }
  return req.socket.remoteAddress ?? "unknown";
}

function isSameOrigin(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || origin.length === 0) {
    // No Origin header: a non-browser client (e.g. curl) or a navigation.
    // Same-origin enforcement applies to cross-site browser submissions,
    // which always carry it.
    return true;
  }

  // Modern browsers always send Sec-Fetch-Site. When the browser itself
  // asserts same-origin, trust that; it carries no privilege escalation
  // because non-browser clients can simply omit these headers.
  const fetchSite = req.headers["sec-fetch-site"];
  if (typeof fetchSite === "string" && fetchSite.length > 0) {
    return fetchSite === "same-origin" || fetchSite === "none";
  }

  // Fallback comparison for clients that send Origin without Sec-Fetch-Site.
  // Behind the Edge ingress the Host header is the internal service name;
  // prefer the forwarded host/proto when the platform supplies them.
  const forwardedHost = req.headers["x-forwarded-host"];
  const host =
    (typeof forwardedHost === "string" && forwardedHost.length > 0
      ? forwardedHost.split(",")[0]?.trim()
      : undefined) ??
    (typeof req.headers.host === "string" ? req.headers.host : undefined);
  if (host === undefined || host.length === 0) return false;
  const isEncrypted = (req.socket as unknown as { encrypted?: boolean }).encrypted === true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto = isEncrypted
    ? "https"
    : typeof forwardedProto === "string" && forwardedProto.length > 0
      ? (forwardedProto.split(",")[0]?.trim() ?? "https")
      : "http";
  const expected = `${proto.toLowerCase()}://${host.toLowerCase()}`;
  return origin.toLowerCase() === expected.toLowerCase();
}
function authorizeDemoRequest(req: http.IncomingMessage, config: AppConfig): AppError | null {
  if (config.demoAccessToken === null) return null;
  const header = req.headers.authorization;
  let presented: string | null = null;
  if (typeof header === "string" && header.toLowerCase().startsWith("bearer ")) {
    presented = header.slice(7).trim();
  }
  if (presented === null) {
    const direct = req.headers["x-access-token"];
    if (typeof direct === "string" && direct.length > 0) {
      presented = direct.trim();
    }
  }
  if (presented === null || presented === "") {
    return new AppError("MISSING_TOKEN", 401, "This deployment requires a demo access token. Paste one into the form.");
  }
  if (!tokensEqual(presented, config.demoAccessToken)) {
    return new AppError("INVALID_TOKEN", 401, "The demo access token is not valid for this deployment.");
  }
  return null;
}

async function readJsonBody(req: http.IncomingMessage, maxBytes: number): Promise<Record<string, unknown> | AppError> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer);
    total += buffer.length;
    if (total > maxBytes) {
      return new AppError("PAYLOAD_TOO_LARGE", 413, "The request body is too large.");
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim() === "") {
    return new AppError("INVALID_INPUT", 400, "A JSON body is required.");
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return new AppError("INVALID_INPUT", 400, "The body must be a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch {
    return new AppError("INVALID_INPUT", 400, "The body must be valid JSON.");
  }
}

export interface InferenceOutcome {
  status: 200;
  body: NormalizedInferenceResponse;
  logFields: {
    model?: string;
    provider?: string;
    promptTokens?: number | null;
    completionTokens?: number | null;
    receiptVerified?: boolean | null;
    error?: string;
  };
}

export async function runInference(
  config: AppConfig,
  deps: ServerDeps,
  catalog: CatalogService,
  input: { model: string; prompt: string }
): Promise<InferenceOutcome> {
  const logger = deps.logger ?? createLogger();
  const requestId = randomUUID();

  const validation = await catalog.validateModel(input.model);
  if (!validation.eligible) {
    throw new AppError(
      "UNKNOWN_MODEL",
      400,
      "That model is not in the current Telnyx zero-data-retention catalog. Pick a model from the list."
    );
  }

  const built = buildChatRequest(input.model, input.prompt, config.maxCompletionTokens);
  const nonce = generateReceiptNonce();

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await deps.fetchImpl(config.inferenceUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.trustedRouterApiKey ?? ""}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-inference-receipt": nonce,
        "Idempotency-Key": requestId,
      },
      body: built.bodyBytes,
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
  } catch (error) {
    const isTimeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    if (isTimeout) {
      throw new AppError("TIMEOUT", 504, "TrustedRouter did not answer in time. Try again or shorten the prompt.");
    }
    throw new AppError("NETWORK_ERROR", 502, "The request to TrustedRouter could not be sent.");
  }

  const responseBytes = new Uint8Array(await response.arrayBuffer());
  const durationMs = Date.now() - startedAt;

  if (!response.ok) {
    const failure = extractUpstreamFailure(responseBytes);
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterSeconds = retryAfterHeader !== null && /^\d+$/.test(retryAfterHeader)
      ? Number.parseInt(retryAfterHeader, 10)
      : null;
    const appError = appErrorFromStatus(response.status, failure.type, failure.message, retryAfterSeconds);
    logRequest(logger, {
      event: "inference_upstream_error",
      requestId,
      route: "/api/inference",
      method: "POST",
      status: response.status,
      durationMs,
      error: appError.code,
    });
    throw appError;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseUpstreamJson(responseBytes);
  } catch {
    throw new AppError("UPSTREAM_ERROR", 502, "TrustedRouter returned a malformed response.");
  }

  const receiptHeader = response.headers.get("x-inference-receipt");

  let attestationBytes: Uint8Array | null = null;
  if (receiptHeader !== null) {
    attestationBytes = await (deps.fetchAttestationImpl ?? fetchReceiptAttestation)(receiptHeader, {
      apiKey: config.trustedRouterApiKey,
      keyLogUrl: config.keyLogUrl,
      gatewayAttestationUrl: config.gatewayAttestationUrl,
      fetchImpl: deps.fetchImpl,
    });
  }

  const verification = await (deps.verifyReceiptImpl ?? verifyInferenceReceipt)({
    receipt: receiptHeader,
    requestBytes: built.bodyBytes,
    responseBytes,
    expectedNonce: nonce,
    maxAgeSeconds: config.receiptMaxAgeSeconds,
    expectedIssuer: config.expectedIssuer,
    attestationBytes,
  });

  if (!verification.verified) {
    logRequest(logger, {
      event: "inference_verification_failed",
      requestId,
      route: "/api/inference",
      method: "POST",
      status: 200,
      durationMs,
      receiptVerified: false,
      error: verification.failureCode ?? "UNKNOWN",
    });
    const body = buildNormalizedResponse({
      output: extractOutput(parsed),
      requestedModel: input.model,
      selectedModel: null,
      provider: null,
      durationMs,
      usage: normalizeUsage(parsed.usage),
      verification,
      compactReceipt: receiptHeader,
    });
    return { status: 200, body, logFields: { receiptVerified: false, error: verification.failureCode ?? "UNKNOWN" } };
  }

  const claims = verification.claims;
  const provider = claims?.provider ?? null;
  const selectedModel = claims?.selectedModel ?? null;

  if (provider !== "telnyx") {
    throw new AppError(
      "PROVIDER_MISMATCH",
      502,
      `The verified receipt reports provider ${provider ?? "unknown"} instead of telnyx. This request is rejected.`,
      { cause: { verification } }
    );
  }
  if (selectedModel !== null && selectedModel !== input.model) {
    throw new AppError(
      "MODEL_MISMATCH",
      502,
      `The verified receipt reports model ${selectedModel} instead of the requested model. This request is rejected.`,
      { cause: { verification } }
    );
  }

  logRequest(logger, {
    event: "inference_ok",
    requestId,
    route: "/api/inference",
    method: "POST",
    status: 200,
    durationMs,
    model: selectedModel ?? input.model,
    provider,
    promptTokens: normalizeUsage(parsed.usage)?.promptTokens ?? null,
    completionTokens: normalizeUsage(parsed.usage)?.completionTokens ?? null,
    receiptVerified: true,
  });

  const body = buildNormalizedResponse({
    output: extractOutput(parsed),
    requestedModel: input.model,
    selectedModel,
    provider,
    durationMs,
    usage: normalizeUsage(parsed.usage),
    verification,
    compactReceipt: receiptHeader,
  });
  return {
    status: 200,
    body,
    logFields: {
      model: selectedModel ?? input.model,
      provider: provider ?? undefined,
      promptTokens: normalizeUsage(parsed.usage)?.promptTokens ?? null,
      completionTokens: normalizeUsage(parsed.usage)?.completionTokens ?? null,
      receiptVerified: true,
    },
  };
}

function buildNormalizedResponse(input: {
  output: string | null;
  requestedModel: string;
  selectedModel: string | null;
  provider: string | null;
  durationMs: number;
  usage: NormalizedInferenceResponse["usage"];
  verification: ReceiptCheckResult;
  compactReceipt: string | null;
}): NormalizedInferenceResponse {
  return {
    output: input.output,
    requestedModel: input.requestedModel,
    selectedModel: input.selectedModel,
    provider: input.provider,
    durationMs: input.durationMs,
    usage: input.usage,
    verification: {
      verified: input.verification.verified,
      nonceMatched: input.verification.nonceMatched,
      requestHashMatched: input.verification.requestHashMatched,
      responseHashMatched: input.verification.responseHashMatched,
      signatureValid: input.verification.signatureValid,
      fresh: input.verification.fresh,
      attestationValid: input.verification.attestationValid,
      issuedAt: input.verification.issuedAt,
      verifiedAt: input.verification.verifiedAt,
      failureCode: input.verification.failureCode,
      failureMessage: input.verification.failureMessage,
    },
    receipt: {
      compact: input.compactReceipt ?? "",
      claims: input.verification.claims as unknown as Record<string, unknown>,
    },
  };
}

export function createRequestHandler(config: AppConfig, deps: ServerDeps) {
  const logger = deps.logger ?? createLogger();
  const catalog = new CatalogService({
    fetchImpl: deps.fetchImpl,
    ttlSeconds: config.modelCacheTtlSeconds,
  });
  const limiter = new InMemoryRateLimiter();

  const serverProblems = missingConfigProblems(config);
  if (serverProblems.length > 0) {
    logger.error({ event: "startup_config_missing", missing: serverProblems });
  }

  return async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    applySecurityHeaders(res);
    res.setHeader("Cache-Control", "no-store");
    const requestId = randomUUID();
    res.setHeader("X-Request-Id", requestId);
    const startedAt = Date.now();
    const method = (req.method ?? "GET").toUpperCase();
    const url = new URL(req.url ?? "/", "http://internal.invalid");
    const route = url.pathname;

    const finish = (status: number): void => {
      logRequest(logger, {
        event: "request",
        requestId,
        route,
        method,
        status,
        durationMs: Date.now() - startedAt,
      });
    };

    try {
      // Platform liveness/readiness probes hit /health and paths under it.
      // Answer fast, before any other work; do not log the probe noise.
      if ((method === "GET" || method === "HEAD") && (route === "/health" || route.startsWith("/health/"))) {
        sendJson(res, 200, {
          status: "ok",
          service: config.serviceName,
          version: config.version,
        });
        return;
      }

      if (route.startsWith("/api/")) {
        const rate = limiter.check(clientKeyOf(req));
        if (!rate.allowed) {
          sendJson(
            res,
            429,
            { error: { code: "RATE_LIMITED", message: "Too many requests from this address. Slow down and retry." } },
            { "Retry-After": String(rate.retryAfterSeconds) }
          );
          finish(429);
          return;
        }

        if (method === "GET" && route === "/api/models") {
          const catalogResult: CatalogResult = await catalog.getCatalog();
          sendJson(res, 200, {
            models: catalogResult.models,
            source: catalogResult.source,
            fetchedAt: catalogResult.fetchedAt,
            routingControls: {
              providerOnly: TELNYX_ONLY_ROUTING.only,
              minPrivacy: TELNYX_ONLY_ROUTING.min_privacy,
              allowFallbacks: TELNYX_ONLY_ROUTING.allow_fallbacks,
            },
            inferenceAuthRequired: config.demoAccessToken !== null,
          });
          finish(200);
          return;
        }

        if (method === "POST" && route === "/api/inference") {
          if (!isSameOrigin(req)) {
            sendJson(res, 403, {
              error: { code: "FORBIDDEN_ORIGIN", message: "Cross-origin requests are not accepted." },
            });
            finish(403);
            return;
          }
          const authError = authorizeDemoRequest(req, config);
          if (authError !== null) {
            sendJson(res, authError.status, {
              error: { code: authError.code, message: authError.message },
            });
            finish(authError.status);
            return;
          }
          if (config.trustedRouterApiKey === null) {
            sendJson(res, 500, {
              error: {
                code: "MISSING_SERVER_KEY",
                message: "The server is not configured with a TrustedRouter API key. Set TRUSTEDROUTER_API_KEY and restart.",
              },
            });
            finish(500);
            return;
          }

          const bodyOrError = await readJsonBody(req, MAX_REQUEST_BODY_BYTES);
          if (bodyOrError instanceof AppError) {
            sendJson(res, bodyOrError.status, { error: { code: bodyOrError.code, message: bodyOrError.message } });
            finish(bodyOrError.status);
            return;
          }
          const model = bodyOrError.model;
          const prompt = bodyOrError.prompt;
          if (typeof model !== "string" || model.length === 0 || !MODEL_ID_PATTERN.test(model)) {
            sendJson(res, 400, {
              error: { code: "INVALID_INPUT", message: "model must be a TrustedRouter model id string." },
            });
            finish(400);
            return;
          }
          if (typeof prompt !== "string" || prompt.length === 0) {
            sendJson(res, 400, { error: { code: "INVALID_INPUT", message: "prompt must be a non-empty string." } });
            finish(400);
            return;
          }
          if (prompt.length > config.promptMaxChars) {
            sendJson(res, 400, {
              error: { code: "INVALID_INPUT", message: `prompt must be at most ${config.promptMaxChars} characters.` },
            });
            finish(400);
            return;
          }

          const outcome = await runInference(config, deps, catalog, { model, prompt });
          sendJson(res, 200, outcome.body);
          finish(200);
          return;
        }

        sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Unknown API route." } });
        finish(404);
        return;
      }

      if (method === "GET" || method === "HEAD") {
        const staticEntry = STATIC_FILES[route];
        if (staticEntry === undefined) {
          sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Not found." } });
          finish(404);
          return;
        }
        const publicDir = resolvePublicDir();
        const filePath = normalize(join(publicDir, staticEntry.path));
        if (!filePath.startsWith(normalize(publicDir))) {
          sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Not found." } });
          finish(404);
          return;
        }
        let content: Buffer;
        try {
          content = await readFile(filePath);
        } catch {
          sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Static asset missing." } });
          finish(404);
          return;
        }
        res.writeHead(200, {
          "Content-Type": staticEntry.type,
          "Content-Length": String(content.length),
          "Cache-Control": "no-store",
        });
        res.end(method === "HEAD" ? undefined : content);
        finish(200);
        return;
      }

      sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } });
      finish(405);
    } catch (error) {
      if (error instanceof AppError) {
        const payload: Record<string, unknown> = {
          error: { code: error.code, message: error.message },
        };
        const cause = (error as { cause?: unknown }).cause;
        if (cause !== null && cause !== undefined && typeof cause === "object" && "verification" in (cause as Record<string, unknown>)) {
          payload.verification = (cause as Record<string, unknown>).verification;
        }
        if (error.retryAfterSeconds !== null) {
          sendJson(res, error.status, payload, { "Retry-After": String(error.retryAfterSeconds) });
        } else {
          sendJson(res, error.status, payload);
        }
        finish(error.status);
        return;
      }
      logger.error({ event: "unhandled_error", requestId, route, method, errorName: error instanceof Error ? error.name : "Unknown" });
      sendJson(res, 500, { error: { code: "INTERNAL", message: "An internal error occurred. The details were logged without request content." } });
      finish(500);
    }
  };
}

export function startServer(config: AppConfig, deps: ServerDeps = { fetchImpl: fetch }): http.Server {
  const handler = createRequestHandler(config, deps);
  const server = http.createServer((req, res) => {
    void handler(req, res);
  });
  server.listen(config.port, () => {
    const logger = deps.logger ?? createLogger();
    logger.info({ event: "server_started", port: config.port, service: config.serviceName, version: config.version });
  });
  return server;
}
