/* ------------------------------------------------------------------ *
 *  edge-build.js — Assemble the edge/ directory for deployment         *
 *  Copies app files, generates package.json with @telnyx/edge-runtime, *
 *  captures build metadata, and locks dependencies.                   *
 * ------------------------------------------------------------------ */

import { execFileSync } from "node:child_process";
import { cpSync, writeFileSync, readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const edge = new URL("../edge/", import.meta.url).pathname;

// 1. Copy application files to edge/
const FILES = ["server.js", "settings.js", "lookup.js"];
for (const f of FILES) cpSync(`${root}${f}`, `${edge}${f}`);
cpSync(`${root}public`, `${edge}public`, { recursive: true });

// 2. Generate edge package.json with Edge runtime dependency
const pkg = JSON.parse(readFileSync(`${root}package.json`, "utf8"));
writeFileSync(
  `${edge}package.json`,
  JSON.stringify(
    {
      name: "phone-identity-voice-agent",
      version: pkg.version,
      private: true,
      type: "module",
      main: "server.js",
      scripts: { start: "node server.js" },
      engines: { node: ">=22.0" },
      dependencies: {
        ...pkg.dependencies,
        "@telnyx/edge-runtime": "^0.16.0",
      },
    },
    null,
    2
  )
);

// 3. Capture build metadata
let branch = "unknown";
try {
  branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"]).toString().trim();
} catch { /* not a git repo */ }

writeFileSync(
  `${edge}build.json`,
  JSON.stringify({
    branch,
    builtAt: new Date().toISOString(),
  })
);

// 4. Lock dependencies (no install — just lock file)
execFileSync("npm", ["install", "--package-lock-only"], {
  cwd: edge,
  stdio: "inherit",
});

console.log("edge/ ready \u2192 telnyx-edge ship --from-dir=edge --timeout 25m");
