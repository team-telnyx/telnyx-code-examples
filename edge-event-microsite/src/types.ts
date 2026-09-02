// ── Env bindings (resolved from telnyx.toml at ship time) ───────────────────
export interface Env {
  // [telnyx] binding — pre-authenticated Telnyx SDK client (zero-credential).
  // Declaring the block also injects TELNYX_API_KEY into process.env.
  TELNYX: {
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
  };
  // [storage.kv.EVENTS] binding — the single source of truth.
  EVENTS: {
    get(key: string): Promise<string | null>;
    get<T>(key: string, options: { type: "json" }): Promise<T | null>;
    put(
      key: string,
      value: string,
      options?: { expirationTtl?: number },
    ): Promise<void>;
    delete(key: string): Promise<void>;
    list(options?: {
      prefix?: string;
      limit?: number;
      cursor?: string;
    }): Promise<{
      keys: Array<{ name: string; sizeBytes?: number; updatedAt?: number }>;
      list_complete: boolean;
      cursor?: string;
    }>;
  };
}

// ── Non-secret env vars ─────────────────────────────────────────────────────
export const envVars = {
  AI_MODEL: process.env.AI_MODEL ?? "meta-llama/Llama-3.3-70B-Instruct",
  TRANSCRIBE_MODEL:
    process.env.TRANSCRIBE_MODEL ?? "distil-whisper/distil-large-v2",
  TELNYX_SMS_FROM: process.env.TELNYX_SMS_FROM ?? "",
  TELNYX_WHATSAPP_FROM: process.env.TELNYX_WHATSAPP_FROM ?? "",
  TELNYX_SALES_REP_PHONE: process.env.TELNYX_SALES_REP_PHONE ?? "",
  EMAIL_FROM: process.env.EMAIL_FROM ?? "onboarding@mail.telnyx.com",
};

export function apiKey(): string {
  const key = process.env.TELNYX_API_KEY ?? "";
  if (!key) throw new Error("TELNYX_API_KEY not configured");
  return key;
}

// ── Domain types ────────────────────────────────────────────────────────────
export interface EventData {
  event: {
    name: string;
    date: string;
    location: string;
    description: string;
  };
  schedule: Array<{
    id: string;
    time: string;
    title: string;
    speaker: string;
    room: string;
  }>;
  speakers: Array<{
    id: string;
    name: string;
    title: string;
    bio: string;
    photo: string;
  }>;
  venue: {
    address: string;
    map_url: string;
    wifi: string;
    parking: string;
  };
  sponsors: Array<{
    id: string;
    name: string;
    tier: string;
    logo: string;
  }>;
}

export interface Lead {
  id: string;
  company: string;
  company_size: string;
  budget: string;
  timeline: string;
  phone_number: string;
  notes: string;
  is_hot: boolean;
  source: string;
  created_at: string;
}

export interface FeedbackItem {
  id: string;
  phone_number: string;
  transcript: string;
  summary: string;
  created_at: string;
}

export interface Attendee {
  phone_number: string;
  opted_in: boolean;
  source: string;
  created_at: string;
}

// ── Misc helpers ────────────────────────────────────────────────────────────
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

export function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
