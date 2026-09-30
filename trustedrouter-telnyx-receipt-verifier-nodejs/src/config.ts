/**
 * Central configuration. Every value comes from the environment or a safe
 * default. Secrets are never logged or echoed back.
 */
export interface AppConfig {
  readonly port: number;
  readonly trustedRouterApiKey: string | null;
  readonly demoAccessToken: string | null;
  readonly promptMaxChars: number;
  readonly modelCacheTtlSeconds: number;
  readonly requestTimeoutMs: number;
  readonly maxCompletionTokens: number;
  readonly receiptMaxAgeSeconds: number;
  readonly expectedIssuer: string;
  readonly catalogUrl: string;
  readonly inferenceUrl: string;
  readonly keyLogUrl: string;
  readonly gatewayAttestationUrl: string;
  readonly preferredModels: readonly string[];
  readonly version: string;
  readonly serviceName: string;
}

export const DEFAULT_PREFERRED_MODELS = [
  "z-ai/glm-5.3-flash",
  "qwen/qwen3-235b-a22b",
] as const;

export const TELNYX_PROVIDER_SLUG = "telnyx";

const intEnv = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const apiKey = env.TRUSTEDROUTER_API_KEY?.trim() ?? "";
  const demoToken = env.DEMO_ACCESS_TOKEN?.trim() ?? "";

  return {
    port: intEnv(env.PORT, 8080),
    trustedRouterApiKey: apiKey === "" ? null : apiKey,
    demoAccessToken: demoToken === "" ? null : demoToken,
    promptMaxChars: intEnv(env.PROMPT_MAX_CHARS, 4000),
    modelCacheTtlSeconds: intEnv(env.MODEL_CACHE_TTL_SECONDS, 300),
    requestTimeoutMs: intEnv(env.REQUEST_TIMEOUT_MS, 90_000),
    maxCompletionTokens: 512,
    receiptMaxAgeSeconds: 300,
    expectedIssuer: "https://api.trustedrouter.com",
    catalogUrl: "https://api.trustedrouter.com/v1/models",
    inferenceUrl: "https://api.trustedrouter.com/v1/chat/completions",
    keyLogUrl: "https://trustedrouter.com/.well-known/inference-receipt-keys",
    gatewayAttestationUrl: "https://api.trustedrouter.com/receipt-attestation",
    preferredModels: DEFAULT_PREFERRED_MODELS,
    version: "1.0.0",
    serviceName: "trustedrouter-telnyx-receipt-explorer",
  };
}

export function missingConfigProblems(config: AppConfig): string[] {
  const problems: string[] = [];
  if (config.trustedRouterApiKey === null) {
    problems.push("TRUSTEDROUTER_API_KEY");
  }
  return problems;
}
