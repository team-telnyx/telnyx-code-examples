import { z } from "zod";
import type { DemoMode } from "@/domain/types";

// Environment parsing for the Edge runtime. Plain env vars come from the
// telnyx.toml [env_vars] (surfaced via process.env in the Node container);
// secrets are read at runtime from the SECRETS binding, not process.env.

const e164 = z.string().regex(/^\+[1-9]\d{7,14}$/, "must be E.164 (e.g. +15555550123)");

// Live wiring: REQUIRED vars come from telnyx.toml [env_vars] (public, non-secret).
// DEMO_TARGET_PHONE and STAFF_PHONE are personal/mobile numbers — they live as
// Edge SECRETS, resolved async by the DemoAgent at dial time. The dial target is
// normally the patient's on-file number from intake, so DEMO_TARGET_PHONE is an
// optional fallback only.
export const LIVE_REQUIRED_VARS = [
  "TELNYX_CONNECTION_ID",
  "TELNYX_ASSISTANT_ID",
  "FROM_NUMBER",
  "STAFF_PHONE",
  "PUBLIC_BASE_URL",
] as const;

export const LIVE_OPTIONAL_VARS = ["DEMO_TARGET_PHONE"] as const;

export const LIVE_ENV_VARS = [...LIVE_REQUIRED_VARS, ...LIVE_OPTIONAL_VARS] as const;

export const LIVE_REQUIRED_VAR_LIST = LIVE_REQUIRED_VARS.join(", ");

const SECRET_KEYS = [
  "DEMO_MODE",
  "TELNYX_CONNECTION_ID",
  "TELNYX_ASSISTANT_ID",
  "FROM_NUMBER",
  "STAFF_PHONE",
  "TELNYX_API_KEY",
  "TELNYX_PUBLIC_KEY",
] as const;
export type SecretsKey = (typeof SECRET_KEYS)[number];
export type SecretsReader = { get(binding: SecretsKey): Promise<string> };

const liveVarsSchema = z.object({
  TELNYX_CONNECTION_ID: z.string().min(1),
  TELNYX_ASSISTANT_ID: z.string().min(1),
  FROM_NUMBER: e164,
  DEMO_TARGET_PHONE: e164.optional().or(z.literal("")),
  STAFF_PHONE: e164,
  PUBLIC_BASE_URL: z.string().url(),
});

export type LiveEnvVars = {
  TELNYX_CONNECTION_ID: string;
  TELNYX_ASSISTANT_ID: string;
  FROM_NUMBER: string;
  STAFF_PHONE: string;
  PUBLIC_BASE_URL: string;
  DEMO_TARGET_PHONE?: string;
};

/** Sync-only contexts (actor boot) keep the plain process.env read; async paths use resolveDemoMode. */
export function parseMode(): DemoMode {
  return process.env.DEMO_MODE === "live" ? "live" : "mock";
}

/**
 * Live if EITHER source says so: process.env (local dev, .env.live) or the
 * registered DEMO_MODE Edge secret (deployed flip). Reads happen per call,
 * so on the deployed runtime the live/mock toggle is the DEMO_MODE secret —
 * flips take effect without a reship.
 */
export async function resolveDemoMode(secrets?: SecretsReader): Promise<DemoMode> {
  if (process.env.DEMO_MODE === "live") return "live";
  if (secrets) {
    try {
      if ((await secrets.get("DEMO_MODE")) === "live") return "live";
    } catch (error) {
      console.warn(`[demo] DEMO_MODE secret read failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return "mock";
}

export async function parseLiveEnvVars(secrets?: SecretsReader): Promise<LiveEnvVars> {
  const fromEnv = (key: string): string => (process.env[key] ?? "").trim();
  const fromSecret = async (key: SecretsKey): Promise<string> => {
    if (!secrets) return "";
    try {
      return ((await secrets.get(key)) ?? "").trim();
    } catch (error) {
      console.warn(`[demo] ${key} secret read failed: ${error instanceof Error ? error.message : String(error)}`);
      return "";
    }
  };
  const secretOrEnv = async (key: SecretsKey): Promise<string> => {
    const plain = fromEnv(key);
    if (plain.length > 0) return plain;
    return fromSecret(key);
  };
  const raw = {
    TELNYX_CONNECTION_ID: await secretOrEnv("TELNYX_CONNECTION_ID"),
    TELNYX_ASSISTANT_ID: await secretOrEnv("TELNYX_ASSISTANT_ID"),
    FROM_NUMBER: await secretOrEnv("FROM_NUMBER"),
    STAFF_PHONE: await secretOrEnv("STAFF_PHONE"),
    PUBLIC_BASE_URL: fromEnv("PUBLIC_BASE_URL"),
    DEMO_TARGET_PHONE: fromEnv("DEMO_TARGET_PHONE"),
  };
  const parsed = liveVarsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const missing = LIVE_REQUIRED_VARS.filter((key) => raw[key].length === 0);
  if (missing.length > 0) {
    throw new Error(
      `live mode requires ${LIVE_REQUIRED_VAR_LIST} — missing or empty: ${missing.join(", ")} (set them in telnyx.toml [env_vars] or via \`telnyx-edge secrets add <NAME> <value>\`)`,
    );
  }
  throw new Error(
    `live env vars failed validation (${LIVE_REQUIRED_VAR_LIST} are required; the personal-phone vars must be E.164 or unset)`,
  );
}
