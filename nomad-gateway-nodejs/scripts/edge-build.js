// Assemble the edge/ directory for Telnyx Edge Compute deployment.
import { execFileSync } from "node:child_process";
import { cpSync, writeFileSync, readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const edge = new URL("../edge/", import.meta.url).pathname;

// Copy application files
const FILES = ["server.js", "db.js", "settings.js", "ai.js", "messaging.js", "knowledge.js", "voice.js"];
for (const f of FILES) cpSync(`${root}${f}`, `${edge}${f}`);
cpSync(`${root}public`, `${edge}public`, { recursive: true });

// Generate package.json for Edge
const pkg = JSON.parse(readFileSync(`${root}package.json`, "utf8"));
writeFileSync(`${edge}package.json`, JSON.stringify({
  name: "nomad-gateway",
  version: pkg.version,
  type: "module",
  main: "server.js",
  dependencies: { ...pkg.dependencies, "@telnyx/edge-runtime": "^0.16.0" },
}, null, 2));

// Build metadata
let branch = "unknown";
try { branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"]).toString().trim(); } catch { /* not a git repo */ }
writeFileSync(`${edge}build.json`, JSON.stringify({
  branch,
  builtAt: new Date().toISOString(),
}));

// Install lockfile only
execFileSync("npm", ["install", "--package-lock-only"], { cwd: edge, stdio: "inherit" });

console.log("edge/ ready → telnyx-edge ship --from-dir=edge --timeout 25m");
