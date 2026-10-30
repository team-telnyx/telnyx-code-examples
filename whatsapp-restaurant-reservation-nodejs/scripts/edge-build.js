// Assembles the Telnyx Edge package in ./edge (edge/func.toml is kept):
//   npm run edge:build   → then: telnyx-edge ship --from-dir=edge --timeout 25m
// Only the server code and public/ are copied — never .env or data/. Settings
// come from account secrets named DINENYX_* (see README → Deploy on Telnyx Edge).
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const edge = new URL("../edge/", import.meta.url).pathname;
if (!existsSync(`${edge}func.toml`)) {
  throw new Error(
    "edge/func.toml missing: copy edge/func.toml.example and set your function id (README → Deploy on Telnyx Edge)"
  );
}

const FILES = ["server.js", "db.js", "settings.js", "ai.js", "whatsapp.js", "restaurants.js"];
for (const f of [...FILES, "public", "build.json"]) rmSync(`${edge}${f}`, { recursive: true, force: true });
for (const f of FILES) cpSync(`${root}${f}`, `${edge}${f}`);
cpSync(`${root}public`, `${edge}public`, { recursive: true });

const pkg = JSON.parse(readFileSync(`${root}package.json`, "utf8"));
let branch = process.env.GIT_BRANCH;
try {
  branch ||= execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root }).toString().trim();
} catch { /* no git */ }
writeFileSync(
  `${edge}build.json`,
  `${JSON.stringify({ branch: branch || "unknown", builtAt: new Date().toISOString() })}\n`
);
writeFileSync(
  `${edge}package.json`,
  JSON.stringify(
    {
      name: "dinenyx",
      version: pkg.version,
      private: true,
      type: "module",
      main: "server.js",
      scripts: { start: "node server.js" },
      engines: { node: ">=22.0" },
      dependencies: { ...pkg.dependencies, "@telnyx/edge-runtime": "^0.16.0" },
    },
    null,
    2
  ) + "\n"
);
// Edge requires a lockfile; node_modules are installed by the platform, not shipped.
rmSync(`${edge}node_modules`, { recursive: true, force: true });
execFileSync("npm", ["install", "--package-lock-only", "--no-audit", "--no-fund"], {
  cwd: edge,
  stdio: "inherit",
});
console.log("edge/ ready → telnyx-edge ship --from-dir=edge --timeout 25m");
