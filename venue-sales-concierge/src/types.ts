import type {
  ActorNamespace,
  ActorStub,
  IdFromNameOptions,
  KvNamespace,
  SqlDatabase,
} from "@telnyx/edge-runtime";
import type { ConciergeAgent } from "./agent";

// ── Env bindings (resolved from telnyx.toml at ship time) ───────────────────
export interface Env {
  // [[actors]] binding — one durable ConciergeAgent per planner phone number.
  CONCIERGE: ConciergeNamespace;
  // [storage.kv.VENUE_KV] — venue content (galleries, spaces, menus, AV,
  // pricing, FAQs) + assistant id + webhook dedupe locks.
  VENUE_KV: KvNamespace;
  // [storage.sqldb.AVAILABILITY_DB] — shared venue database: live date
  // availability, inquiries, qualified leads, site-visit conversions.
  AVAILABILITY_DB: SqlDatabase;
  // [telnyx] binding — pre-authenticated Telnyx SDK client (zero-credential).
  // Declaring the block also injects TELNYX_API_KEY into process.env.
  TELNYX: TelnyxBinding;
}

export type ConciergeStub = ActorStub &
  Pick<ConciergeAgent, "receive" | "voiceEvent" | "followUpCall" | "getDebugState">;

export interface ConciergeNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): ConciergeStub;
}

// Hand-typed slice of the [telnyx] binding — `telnyx-edge types` generates the
// full surface. Messages + Call Control (dial) + AI Inference are used here.
export interface TelnyxBinding {
  messages: {
    send(
      m: { from: string; to: string; text: string },
      opts?: { maxRetries?: number; timeout?: number },
    ): Promise<unknown>;
  };
  calls: {
    dial(
      m: {
        connection_id: string;
        from: string;
        to: string;
        command_id?: string;
        webhook_url?: string;
      },
      opts?: { maxRetries?: number; timeout?: number },
    ): Promise<{ data?: { call_control_id?: string } }>;
  };
  ai: {
    openai: {
      chat: {
        createCompletion(req: {
          model: string;
          messages: Array<{ role: string; content: string }>;
          max_tokens?: number;
          temperature?: number;
        }): Promise<{ choices: Array<{ message: { content: string } }> }>;
      };
    };
  };
}

// ── Non-secret env vars ─────────────────────────────────────────────────────
export interface AppConfig {
  AI_MODEL: string;
  AI_MODEL_FALLBACKS: string[];
  ASSISTANT_MODEL: string;
  TELNYX_SMS_FROM: string;
  EMAIL_FROM: string;
  EMAIL_TO: string;
  DEMO_MODE: string;
  PUBLIC_ORIGIN: string;
  INGEST_TOKEN: string;
  TELNYX_API_KEY: string;
  TELNYX_CONNECTION_ID: string;
}

/**
 * Resolve config from the bindings env (works in BOTH function and actor
 * scope — [env_vars] land in the env object) with process.env fallback.
 * Never read process.env directly inside actors.
 */
export function cfg(env: unknown): AppConfig {
  const e = (env ?? {}) as Record<string, unknown>;
  const get = (key: string, dflt: string): string => {
    const v = e[key] ?? process.env[key];
    return typeof v === "string" && v.length > 0 ? v : dflt;
  };
  return {
    AI_MODEL: get("AI_MODEL", "moonshotai/Kimi-K2.6"),
    AI_MODEL_FALLBACKS: get(
      "AI_MODEL_FALLBACKS",
      "zai-org/GLM-5.3-Flash,zai-org/GLM-5.2,meta-llama/Llama-3.3-70B-Instruct",
    )
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean),
    ASSISTANT_MODEL: get("ASSISTANT_MODEL", "moonshotai/Kimi-K2.6"),
    TELNYX_SMS_FROM: get("TELNYX_SMS_FROM", ""),
    EMAIL_FROM: get("EMAIL_FROM", "onboarding@mail.telnyx.com"),
    EMAIL_TO: get("EMAIL_TO", ""),
    // "true" (default) simulates outbound SMS/emails/calls — safe for demos.
    // Inference, KV, and SQLDB always run for real.
    DEMO_MODE: get("DEMO_MODE", "true"),
    PUBLIC_ORIGIN: get("PUBLIC_ORIGIN", ""),
    INGEST_TOKEN: get("INGEST_TOKEN", ""),
    TELNYX_API_KEY: get("TELNYX_API_KEY", ""),
    TELNYX_CONNECTION_ID: get("TELNYX_CONNECTION_ID", ""),
  };
}

/** Legacy snapshot for function-scope-only code paths (process.env first). */
export function envVarsSnapshot() {
  return {
    get AI_MODEL(): string {
      return process.env.AI_MODEL ?? "moonshotai/Kimi-K2.6";
    },
    get ASSISTANT_MODEL(): string {
      return process.env.ASSISTANT_MODEL ?? "moonshotai/Kimi-K2.6";
    },
    get TELNYX_SMS_FROM(): string {
      return process.env.TELNYX_SMS_FROM ?? "";
    },
    get EMAIL_FROM(): string {
      return process.env.EMAIL_FROM ?? "onboarding@mail.telnyx.com";
    },
    get EMAIL_TO(): string {
      return process.env.EMAIL_TO ?? "";
    },
    get DEMO_MODE(): string {
      return process.env.DEMO_MODE ?? "true";
    },
  };
}

export function apiKey(): string {
  const key = process.env.TELNYX_API_KEY ?? "";
  if (!key) throw new Error("TELNYX_API_KEY not configured");
  return key;
}

// ── Domain types ────────────────────────────────────────────────────────────
export interface GalleryItem {
  url: string;
  caption: string;
}

export interface VenueSpace {
  name: string;
  seated: number;
  cocktail: number;
  sqft: number;
  features: string[];
}

export interface Menu {
  name: string;
  price_per_person: number;
  description: string;
  items: string[];
}

export interface FaqEntry {
  question: string;
  answer: string;
  keywords: string[];
}

export interface Pricing {
  rental: Record<string, string>;
  catering_from: number;
  note: string;
}

export interface VenueData {
  venue: {
    name: string;
    tagline: string;
    location: string;
    description: string;
  };
  gallery: GalleryItem[];
  spaces: VenueSpace[];
  menus: Menu[];
  av: string[];
  pricing: Pricing;
  faqs: FaqEntry[];
}

export interface PlannerState extends Record<string, unknown> {
  phone: string;
  channel?: string;
  name?: string;
  email?: string;
  eventType?: string;
  guests?: number;
  budget?: string;
  dateStart?: string;
  dateEnd?: string;
  qualified: boolean;
  siteVisitBooked: boolean;
  inquiryCount: number;
  lastActive: number;
  lastError?: string;
  lastReport?: string;
  // Function-scope enrichment passed in with each touchpoint.
  venue?: VenueData;
  availability?: string;
  // Runtime config the actor can't see (env vars don't reach actor scope):
  // the function passes these with every dispatch.
  reportOrigin?: string;
  demoMode?: string;
  smsFrom?: string;
  activeCallId?: string;
  followupCallActive?: boolean;
}

export interface Inquiry {
  id: string;
  phone: string;
  name: string;
  email: string;
  event_type: string;
  guests: number | null;
  budget: string;
  dates: string;
  message: string;
  channel: string;
  qualified: number;
  created_at: number;
}

export interface SiteVisit {
  id: string;
  phone: string;
  name: string;
  email: string;
  visit_date: string | null;
  status: string;
  source: string;
  created_at: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function maskPhone(phone: string): string {
  if (!phone || phone.length < 4) return "***";
  return `***-***-${phone.slice(-4)}`;
}

/**
 * One StatefulActor per planner. Actor names are Dapr-safe: only
 * [0-9a-zA-Z.-] — "+" in E.164 numbers is stripped.
 */
export function actorNameForPhone(phone: string): string {
  return phone.replace(/[^0-9a-zA-Z.-]/g, "");
}

export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("+") ? trimmed : `+${trimmed.replace(/[^0-9]/g, "")}`;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysISO(days: number, from = new Date()): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
