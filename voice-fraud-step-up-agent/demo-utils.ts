import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BOLD = "\x1b[1m";
export { BOLD };

export const DIM = "\x1b[2m";
export const CYAN = "\x1b[36m";
export const GREEN = "\x1b[32m";
export const YELLOW = "\x1b[33m";
export const RED = "\x1b[31m";
export const RESET = "\x1b[0m";

export function section(step: string, title: string, color = CYAN): void {
  const rule = "─".repeat(Math.max(4, 70 - step.length - title.length));
  console.log(`\n${BOLD}${color}STEP ${step} · ${title} ${rule}${RESET}`);
}

export function show(label: string, value: unknown): void {
  console.log(`${DIM}${label}${RESET}`);
  console.log(JSON.stringify(value, null, 2));
}

export function note(text: string, color = DIM): void {
  console.log(`${color}${text}${RESET}`);
}

export function verdict(label: string, outcome: string, reason: string): void {
  const color = outcome === "proceed" ? GREEN : outcome === "step_up_flashcall" ? YELLOW : RED;
  console.log(`${BOLD}${color}${label} → ${outcome}${RESET} — ${reason}`);
}

export function shortTs(ts: string): string {
  return ts.replace("T", " ").replace(/\.\d{3}Z$/, "Z");
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function maskPhone(phone: string): string {
  return `•••${phone.slice(-4)}`;
}

export function ledgerTable(rows: ReadonlyArray<{
  ts: string;
  callSid: string;
  deepfakeResult: string;
  action: string;
  outcome: string;
  source: string;
  note: string;
}>): void {
  const header = ["ts", "callSid", "deepfake", "action", "outcome", "source", "note"];
  const cells = rows.map((r) => [
    shortTs(r.ts),
    r.callSid,
    r.deepfakeResult,
    r.action,
    r.outcome,
    r.source,
    truncate(r.note, 28),
  ]);
  const widths = header.map((name, i) => Math.max(name.length, ...cells.map((c) => c[i].length)));
  const line = (parts: string[]): string => parts.map((p, i) => p.padEnd(widths[i])).join(" ");
  console.log(`${DIM}${line(header)}${RESET}`);
  for (const cell of cells) console.log(line(cell));
}

export interface ApiKeySource {
  key: string;
  source: "telnyx-edge CLI config" | "TELNYX_API_KEY env";
}

// security-relevant: the personal key is read at runtime only — never printed in full, never persisted
export function loadApiKey(): ApiKeySource | null {
  const configPath = join(homedir(), ".telnyx-edge", "config.toml");
  if (existsSync(configPath)) {
    const match = /api_key\s*=\s*"([^"]+)"/.exec(readFileSync(configPath, "utf8"));
    if (match?.[1]) return { key: match[1], source: "telnyx-edge CLI config" };
  }
  const fromEnv = process.env.TELNYX_API_KEY?.trim();
  return fromEnv ? { key: fromEnv, source: "TELNYX_API_KEY env" } : null;
}

export async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, "");
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    out[key] = value;
  }
  return out;
}

interface AssistantListItem {
  id: string;
  name?: string;
}
interface AssistantListResponse {
  data?: AssistantListItem[];
}
interface AssistantIdResponse {
  data?: { id?: string };
  id?: string;
}

export interface AssistantEnsureResult {
  id: string;
  created: boolean;
}

export async function ensureAssistant(payload: object & { name?: unknown }, apiKey: string): Promise<AssistantEnsureResult> {
  const auth = { Authorization: `Bearer ${apiKey}` };
  const name = String(payload["name"]);
  const listRes = await fetchWithTimeout("https://api.telnyx.com/v2/ai/assistants", { headers: auth });
  if (!listRes.ok) throw new Error(`list assistants returned HTTP ${listRes.status}`);
  const list = (await listRes.json()) as AssistantListResponse;
  const existing = (list.data ?? []).find((a) => a.name === name);
  if (existing) {
    const updateRes = await fetchWithTimeout(`https://api.telnyx.com/v2/ai/assistants/${existing.id}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!updateRes.ok) {
      throw new Error(`update assistant returned HTTP ${updateRes.status}: ${truncate(await updateRes.text(), 240)}`);
    }
    return { id: existing.id, created: false };
  }
  const createRes = await fetchWithTimeout("https://api.telnyx.com/v2/ai/assistants", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!createRes.ok) {
    throw new Error(`create assistant returned HTTP ${createRes.status}: ${truncate(await createRes.text(), 240)}`);
  }
  const created = (await createRes.json()) as AssistantIdResponse;
  return { id: created.data?.id ?? created.id ?? "unknown-id", created: true };
}

export async function fetchTelnyxPublicKeyB64(apiKey: string): Promise<string | null> {
  const res = await fetchWithTimeout("https://api.telnyx.com/v2/public_key", { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: { public?: string } };
  return body.data?.public ?? null;
}
