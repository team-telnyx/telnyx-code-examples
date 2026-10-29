import { join } from "node:path";
import type { LedgerRow } from "./src/index.js";
import {
  BOLD,
  CYAN,
  DIM,
  GREEN,
  RED,
  RESET,
  YELLOW,
  maskPhone,
  note,
  parseEnvFile,
  section,
  shortTs,
  truncate,
} from "./demo-utils.js";

const env = parseEnvFile(join(process.cwd(), ".env"));
const base = (process.env.DEMO_URL ?? env["WEBHOOK_URL"] ?? "").replace(/\/webhooks$/, "");

if (!base || base.includes("replace-after-ship")) {
  console.log("demo:live needs the deployed Edge function URL.");
  console.log("Deploy first (see README — Deploy to Edge Compute), then set WEBHOOK_URL in .env to <function-url>/webhooks.");
  process.exit(1);
}

interface DemoResponse {
  opened?: { dialPayload?: Record<string, unknown> };
  note?: string;
}
interface StatusResponse {
  status?: string;
  ledger?: LedgerRow[];
}

const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms));
const demoAccount = process.env.DEMO_ACCOUNT_ID ?? `acct_demo_${Date.now()}`;

function printRow(row: LedgerRow): void {
  const color =
    row.outcome === "proceed"
      ? GREEN
      : row.outcome === "step_up_flashcall"
        ? YELLOW
        : row.outcome === "manual_review"
          ? RED
          : DIM;
  console.log(`${DIM}${shortTs(row.ts)}${RESET}  ${BOLD}${color}${row.outcome}${RESET} — ${truncate(row.note, 64)}`);
}

console.log(`\n${BOLD}VOICE FRAUD STEP-UP AGENT — LIVE ON EDGE${RESET}`);
note(`function: ${base}`);
note("no tunnels, no local server — the Edge function receives every webhook directly");

section("1", "function health");
const health = await fetch(`${base}/healthz`);
if (!health.ok) {
  note(`function not reachable: HTTP ${health.status}`, RED);
  process.exit(1);
}
note("deployed function is live", GREEN);

section("2", "personal key");
note("credentials remain in the deployed Edge function and are never read or printed by this local monitor", DIM);

section("3", "triggering the gate on Edge");
const demoRes = await fetch(`${base}/demo?account=${encodeURIComponent(demoAccount)}`);
if (!demoRes.ok) {
  note(`/demo failed: HTTP ${demoRes.status}`, RED);
  process.exit(1);
}
const demoBody = (await demoRes.json()) as DemoResponse;
const dial = demoBody.opened?.dialPayload;
let accountId = "acct_demo";
if (dial) {
  try {
    accountId = JSON.parse(atob(String(dial["client_state"] ?? "")))["accountId"] ?? accountId;
  } catch {
    accountId = "acct_demo";
  }
  console.log(`${DIM}POST /v2/calls (Call Control Dial)${RESET}`);
  console.log(JSON.stringify({ ...dial, to: maskPhone(String(dial["to"] ?? "")) }, null, 2));
}
note(`phone ringing now — answer on the handset and answer the verification prompt (gate actor: ${accountId})`, YELLOW);
const statusUrl = `${base}/demo/status?account=${encodeURIComponent(accountId)}`;

section("4", "watching the ledger on Edge");
let seenRows = 0;
const startedAt = Date.now();
const MAX_MS = 4 * 60_000;
let verdictPrinted = false;
let settledMs: number | null = null;

while (Date.now() - startedAt < MAX_MS) {
  await sleep(2000);
  let body: StatusResponse;
  try {
    const res = await fetch(statusUrl);
    if (!res.ok) continue;
    body = (await res.json()) as StatusResponse;
  } catch {
    continue;
  }
  const rows = body.ledger ?? [];
  for (const row of rows.slice(seenRows)) {
    printRow(row);
    if (row.outcome === "proceed" && !verdictPrinted) {
      verdictPrinted = true;
      note("verdict: HUMAN-SOUNDING VOICE — the demo policy allows this request; identity still requires independent verification.", GREEN);
    } else if (row.outcome === "step_up_flashcall" && !verdictPrinted) {
      verdictPrinted = true;
      note("verdict: SYNTHETIC VOICE — flashcall step-up. Call Control is speaking the step-up message on your call.", YELLOW);
    } else if (row.outcome === "manual_review" && !verdictPrinted) {
      verdictPrinted = true;
      note("verdict: UNVERIFIABLE — fail closed to human review.", RED);
    }
  }
  if (rows.length !== seenRows) {
    seenRows = rows.length;
    settledMs = null;
  } else if (verdictPrinted) {
    settledMs = settledMs ?? Date.now();
  }
  if (verdictPrinted && settledMs !== null && Date.now() - settledMs > 12_000) {
    break;
  }
}

section("done", "final audit ledger (from the Edge actor's SQL)", GREEN);
try {
  const res = await fetch(statusUrl);
  const body = (await res.json()) as StatusResponse;
  for (const row of body.ledger ?? []) printRow(row);
} catch (err) {
  note(`final status fetch failed: ${err instanceof Error ? err.message : String(err)}`, RED);
}
console.log("");
