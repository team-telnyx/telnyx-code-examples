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
check("telnyx.toml: AssistRelay bound as RELAY (event-stream sink)", () => {
  assert.match(toml, /binding\s*=\s*"RELAY"[\s\S]*?type\s*=\s*"AssistRelay"/);
});
check("telnyx.toml: CoachRoom actor bound as COACHROOMS", () => {
  assert.match(toml, /binding\s*=\s*"COACHROOMS"[\s\S]*?type\s*=\s*"CoachRoom"/);
});
check("telnyx.toml: CoachRegistry bound as REGISTRY", () => {
  assert.match(toml, /binding\s*=\s*"REGISTRY"[\s\S]*?type\s*=\s*"CoachRegistry"/);
});
check("telnyx.toml: escalation secrets declared", () => {
  assert.match(toml, /name\s*=\s*"CALL_CONTROL_CONNECTION_ID"/);
  assert.match(toml, /name\s*=\s*"TELNYX_NUMBER"/);
  assert.match(toml, /name\s*=\s*"SUPERVISOR_DEVICE"/);
});
check("telnyx.toml: COACH_AUTH secret declared (event-stream auth_ref)", () => {
  assert.match(toml, /name\s*=\s*"COACH_AUTH"/);
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
check(".env.example: no markdown fences", () => {
  assert.doesNotMatch(envExample, /```/);
});

// 4. Structured files are raw file content, not markdown blocks.
for (const f of ["package.json", "tsconfig.json", "telnyx.toml"]) {
  check(`${f}: no markdown fences`, () => {
    assert.doesNotMatch(readFileSync(resolve(here, f), "utf8"), /```/);
  });
}

// 5. Source modules parse and export the actor classes.
const roomSrc = readFileSync(resolve(here, "src/coachRoom.ts"), "utf8");
const relaySrc = readFileSync(resolve(here, "src/relay.ts"), "utf8");
const indexSrc = readFileSync(resolve(here, "src/index.ts"), "utf8");

check("src/coachRoom.ts: exports CoachRoom extends Agent", () => {
  assert.match(roomSrc, /export class CoachRoom extends Agent</);
});
check("src/coachRoom.ts: exports CoachRegistry extends Agent", () => {
  assert.match(roomSrc, /export class CoachRegistry extends Agent</);
});
check("src/coachRoom.ts: exports NudgePolicy with frame caps", () => {
  assert.match(roomSrc, /export class NudgePolicy/);
  assert.match(roomSrc, /MAX_FRAME_BYTES = 1024 \* 1024/);
});
check("src/coachRoom.ts: supervisor desk pushes snapshot + patches", () => {
  assert.match(roomSrc, /new AgentSocketServer<CoachState>\(this/);
  assert.match(roomSrc, /broadcastPatch/);
});
check("src/coachRoom.ts: joinCall is an @rpc escalation", () => {
  assert.match(roomSrc, /@rpc/);
  assert.match(roomSrc, /async joinCall/);
  assert.match(roomSrc, /ai_assistant_join/);
});
check("src/coachRoom.ts: dial via zero-credential TELNYX binding", () => {
  assert.match(roomSrc, /TELNYX\.calls\.dial/);
});
check("src/coachRoom.ts: coach_log row + room teardown on session end", () => {
  assert.match(roomSrc, /INSERT INTO coach_log/);
  assert.match(roomSrc, /replaceState\(this\.initialState\(\)\)/);
});
check("src/coachRoom.ts: silence watcher cancelled on end", () => {
  assert.match(roomSrc, /cancelSchedule\("silence"\)/);
});

check("src/relay.ts: verifies Bearer auth on the stream upgrade", () => {
  assert.match(relaySrc, /authorization/i);
  assert.match(relaySrc, /COACH_AUTH/);
});
check("src/relay.ts: routes per conversation via idFromName", () => {
  assert.match(relaySrc, /idFromName\(daprSafeName\(conversationId\)\)/);
});
check("inject frames use conversation.item.create", () => {
  assert.match(roomSrc, /conversation\.item\.create/);
  assert.match(relaySrc, /ws\.send\(JSON\.stringify\(frame\)\)/);
});
check("src/relay.ts: socket close is side-channel only", () => {
  assert.match(relaySrc, /onStreamDropped/);
  assert.doesNotMatch(relaySrc, /endSession\(null,\s*"socket"/);
});

check("src/index.ts: mounts assist + coach-room surfaces", () => {
  assert.match(indexSrc, /assist:\s*env\.RELAY/);
  assert.match(indexSrc, /"coach-room":\s*env\.COACHROOMS/);
});
check("src/index.ts: rooms + join + demo simulator routes", () => {
  assert.match(indexSrc, /\/rooms/);
  assert.match(indexSrc, /\/join/);
  assert.match(indexSrc, /\/demo\/start/);
  assert.match(indexSrc, /\/health\/liveness/);
});
check("src/index.ts: dashboard reconnects with exponential backoff", () => {
  assert.match(indexSrc, /backoffMs \* 2, 30000/);
});
check("src/index.ts: dashboard ships WebRTC softphone", () => {
  assert.match(indexSrc, /TelnyxRTC/);
  assert.match(indexSrc, /muteAudio/);
});

console.log(`\n${passed} checks passed`);
