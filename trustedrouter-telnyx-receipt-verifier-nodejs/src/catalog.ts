/**
 * Catalog access for the public TrustedRouter model list.
 *
 * Only models with a currently published Telnyx endpoint marked
 * provider_zero_data_retention: true are eligible for this application.
 * The full upstream catalog is fetched server-side and filtered; the entire
 * catalog is never proxied to the browser.
 */
import { DEFAULT_PREFERRED_MODELS } from "./config.js";

export interface CatalogModel {
  id: string;
  name: string;
  contextLength: number | null;
  promptPriceUsdPerMillion: number | null;
  completionPriceUsdPerMillion: number | null;
  usageTypes: string[];
  providerPolicyUrl: string | null;
  providerPolicySummary: string | null;
}

export interface CatalogResult {
  models: CatalogModel[];
  source: "live" | "cached" | "fallback";
  fetchedAt: string | null;
}

interface RawEndpoint {
  provider?: unknown;
  provider_zero_data_retention?: unknown;
  usage_type?: unknown;
  provider_policy_url?: unknown;
  provider_policy?: unknown;
}

interface RawModel {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown } | null;
  trustedrouter?: {
    endpoints?: RawEndpoint[];
  } | null;
}

const TELNYX_PROVIDER_SLUG = "telnyx";

const FALLBACK_POLICIES: Record<string, CatalogModel> = {
  "z-ai/glm-5.3-flash": {
    id: "z-ai/glm-5.3-flash",
    name: "GLM 5.3 Flash",
    contextLength: null,
    promptPriceUsdPerMillion: null,
    completionPriceUsdPerMillion: null,
    usageTypes: ["Credits"],
    providerPolicyUrl: "https://telnyx.com/privacy-policy",
    providerPolicySummary:
      "Fallback data: the live catalog was unavailable. This model has recently been served by Telnyx under a provider-level zero-data-retention policy.",
  },
  "qwen/qwen3-235b-a22b": {
    id: "qwen/qwen3-235b-a22b",
    name: "Qwen3 235B A22B",
    contextLength: null,
    promptPriceUsdPerMillion: null,
    completionPriceUsdPerMillion: null,
    usageTypes: ["Credits"],
    providerPolicyUrl: "https://telnyx.com/privacy-policy",
    providerPolicySummary:
      "Fallback data: the live catalog was unavailable. This model has recently been served by Telnyx under a provider-level zero-data-retention policy.",
  },
};

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function perMillion(value: unknown): number | null {
  const raw = asNumber(value);
  if (raw === null) return null;
  return Math.round(raw * 1_000_000 * 1e6) / 1e6;
}

export function filterEligibleModels(rawModels: unknown): CatalogModel[] {
  if (!Array.isArray(rawModels)) return [];
  const models: CatalogModel[] = [];
  for (const raw of rawModels as RawModel[]) {
    const id = asString(raw?.id);
    if (id === null) continue;
    const endpoints = Array.isArray(raw?.trustedrouter?.endpoints)
      ? raw.trustedrouter.endpoints
      : [];
    const telnyxZdr = endpoints.filter(
      (endpoint) =>
        asString(endpoint?.provider)?.toLowerCase() === TELNYX_PROVIDER_SLUG &&
        endpoint?.provider_zero_data_retention === true
    );
    if (telnyxZdr.length === 0) continue;
    const usageTypes = [
      ...new Set(
        telnyxZdr.map((endpoint) => asString(endpoint?.usage_type) ?? "").filter((t) => t !== "")
      ),
    ];
    const pricing = raw?.pricing ?? null;
    models.push({
      id,
      name: asString(raw?.name) ?? id,
      contextLength: asNumber(raw?.context_length),
      promptPriceUsdPerMillion: perMillion(pricing?.prompt),
      completionPriceUsdPerMillion: perMillion(pricing?.completion),
      usageTypes,
      providerPolicyUrl: asString(telnyxZdr[0]?.provider_policy_url),
      providerPolicySummary: asString(telnyxZdr[0]?.provider_policy),
    });
  }
  return models;
}

export function orderModels(models: CatalogModel[]): CatalogModel[] {
  const rank = new Map<string, number>();
  for (const [index, id] of DEFAULT_PREFERRED_MODELS.entries()) {
    rank.set(id, index);
  }
  return [...models].sort((a, b) => {
    const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return a.id.localeCompare(b.id);
  });
}

export interface CatalogServiceOptions {
  fetchImpl?: typeof fetch;
  ttlSeconds: number;
  catalogUrl?: string;
  now?: () => number;
}

export class CatalogService {
  private readonly fetchImpl: typeof fetch;
  private readonly catalogUrl: string;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private cache: CatalogResult | null = null;
  private cacheExpiresAt = 0;
  private inFlight: Promise<CatalogResult> | null = null;

  constructor(options: CatalogServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.catalogUrl = options.catalogUrl ?? "https://api.trustedrouter.com/v1/models";
    this.ttlMs = options.ttlSeconds * 1000;
    this.now = options.now ?? Date.now;
  }

  async getCatalog(): Promise<CatalogResult> {
    const cached = this.cache;
    if (cached !== null && this.now() < this.cacheExpiresAt) {
      return cached;
    }
    if (this.inFlight !== null) return this.inFlight;

    this.inFlight = this.fetchLive()
      .then((result) => {
        this.cache = result;
        this.cacheExpiresAt = this.now() + this.ttlMs;
        return result;
      })
      .catch(() => {
        if (this.cache !== null) {
          // Previously fetched live data is stale but was never hard-coded.
          return { ...this.cache, source: "cached" as const };
        }
        return this.fallbackResult();
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  async validateModel(
    model: string
  ): Promise<{ eligible: boolean; source: CatalogResult["source"] | null }> {
    const result = await this.getCatalog();
    const eligible = result.models.some((entry) => entry.id === model);
    return { eligible, source: eligible ? result.source : null };
  }

  private async fetchLive(): Promise<CatalogResult> {
    const response = await this.fetchImpl(this.catalogUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`catalog fetch failed with status ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { data?: unknown };
    const models = filterEligibleModels(parsed.data);
    if (models.length === 0) {
      throw new Error("catalog contained no eligible Telnyx ZDR models");
    }
    return {
      models: orderModels(models),
      source: "live",
      fetchedAt: new Date().toISOString(),
    };
  }

  private fallbackResult(): CatalogResult {
    return {
      models: DEFAULT_PREFERRED_MODELS.map(
        (id) => FALLBACK_POLICIES[id] as CatalogModel
      ),
      source: "fallback",
      fetchedAt: null,
    };
  }
}
