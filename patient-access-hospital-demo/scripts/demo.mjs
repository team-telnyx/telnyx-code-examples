#!/usr/bin/env node
// Mock-mode demo runner: builds if needed, starts the production server,
// waits for /api/state, kicks off the scripted demo, then stays alive so the
// UI can be watched. Refuses to run when Telnyx credentials are present.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

if (process.env.TELNYX_API_KEY) {
  console.error("Refusing to run: TELNYX_API_KEY is set in the environment.");
  console.error(
    "scripts/demo.mjs is the mock-mode runner. Unset TELNYX_API_KEY, or run the server yourself with DEMO_MODE=live and the full Telnyx config.",
  );
  process.exit(1);
}

const PORT = process.env.PORT || "3100";
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PACE_MS = Number(process.env.DEMO_PACE_MS ?? 9000);

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve(undefined) : reject(new Error(`${cmd} exited with code ${code}`))));
  });

if (!existsSync(".next/BUILD_ID")) {
  console.log("No production build found — running `next build` first…");
  await run("npx", ["next", "build"]);
}

const server = spawn("npx", ["next", "start", "-p", PORT], { stdio: "inherit" });
server.on("exit", (code) => process.exit(code ?? 0));

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/state`);
      if (res.ok) return;
    } catch {
      // server not accepting connections yet; keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`server did not become ready at ${BASE_URL} within 60s`);
}

process.on("SIGINT", () => {
  server.kill("SIGINT");
  process.exit(0);
});

try {
  await waitForServer();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  server.kill("SIGINT");
  process.exit(1);
}

console.log(`Server ready at ${BASE_URL} — starting scripted demo (paceMs=${PACE_MS}).`);
const start = await fetch(`${BASE_URL}/api/demo/start`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ reset: true, paceMs: PACE_MS }),
});
if (!start.ok) {
  console.error(`demo start failed: HTTP ${start.status} — ${await start.text()}`);
  server.kill("SIGINT");
  process.exit(1);
}
console.log(`Demo running — open ${BASE_URL} to watch. Ctrl+C to stop.`);
