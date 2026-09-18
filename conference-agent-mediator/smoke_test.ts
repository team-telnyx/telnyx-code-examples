// Smoke test — verifies the module graph, exports, and config wiring without
// touching the network. Run: npm test  (tsx smoke_test.ts)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e: unknown) {
    console.error(`FAIL  ${name}: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}

// 1. telnyx.toml declares the actors + secrets the code expects.
const toml = readFileSync(resolve(here, "telnyx.toml"), "utf8");
check("telnyx.toml: main entry is src/index.ts", () => {
  assert.match(toml, /main\s*=\s*"src\/index\.ts"/);
});
check("telnyx.toml: ConferenceAgent actor bound as CONFERENCE", () => {
  assert.match(toml, /binding\s*=\s*"CONFERENCE"[\s\S]*?type\s*=\s*"ConferenceAgent"/);
});
check("telnyx.toml: ConferenceRegistry actor bound as REGISTRY", () => {
  assert.match(toml, /binding\s*=\s*"REGISTRY"[\s\S]*?type\s*=\s*"ConferenceRegistry"/);
});
check("telnyx.toml: TELNYX_API_KEY declared as secret", () => {
  assert.match(toml, /name\s*=\s*"TELNYX_API_KEY"/);
});
check("telnyx.toml: demo mode defaults to true", () => {
  assert.match(toml, /DEMO_MODE\s*=\s*"true"/);
});

// 2. package.json uses the real SDK + tooling.
const pkg = JSON.parse(readFileSync(resolve(here, "package.json"), "utf8"));
check("package.json: depends on @telnyx/edge-runtime", () => {
  assert.ok(pkg.dependencies["@telnyx/edge-runtime"]);
});
check("package.json: deploy script is telnyx-edge ship", () => {
  assert.equal(pkg.scripts.deploy, "telnyx-edge ship");
});

// 3. .env.example exists with placeholder creds only.
const envExample = readFileSync(resolve(here, ".env.example"), "utf8");
check(".env.example: TELNYX_API_KEY placeholder present", () => {
  assert.match(envExample, /TELNYX_API_KEY=your_telnyx_api_key_here/);
});
check(".env.example: no real credentials", () => {
  assert.doesNotMatch(envExample, /TELNYX_API_KEY=(?!your_telnyx_api_key_here)\S/);
});

// 4. source modules parse and export the actor classes.
const conferenceAgentSrc = readFileSync(resolve(here, "src/conferenceAgent.ts"), "utf8");
const indexSrc = readFileSync(resolve(here, "src/index.ts"), "utf8");
check("src/conferenceAgent.ts: exports ConferenceAgent + ConferenceRegistry", () => {
  assert.match(conferenceAgentSrc, /export class ConferenceAgent extends Agent</);
  assert.match(conferenceAgentSrc, /export class ConferenceRegistry extends Agent</);
});
check("src/conferenceAgent.ts: arms durable mediation timer", () => {
  assert.match(conferenceAgentSrc, /this\.every\(/);
  assert.match(conferenceAgentSrc, /cancelSchedule\("mediate"\)/);
});
check("src/index.ts: routes voice webhook + demo simulator + health", () => {
  assert.match(indexSrc, /\/webhooks\/voice/);
  assert.match(indexSrc, /\/demo\/conference/);
  assert.match(indexSrc, /\/health\/liveness/);
});

console.log(`\n${passed} checks passed`);
