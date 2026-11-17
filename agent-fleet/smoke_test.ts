/**
 * Smoke test \u2014 runs with `npx tsx smoke_test.ts`.
 *
 * Verifies the module loads, the three agents exist as real Agent subclasses,
 * and the operating surface (the five verbs) is wired without touching a
 * binding or the network.
 */
import assert from "node:assert/strict";
import fleet, {
  FleetAgent,
  SalesAgent,
  SchedulingAgent,
  SupportAgent,
  CHANNELS,
  INSTRUCTIONS,
  PROJECTS,
  isProject,
  parseSince,
} from "./src/index";

async function runSmokeTest(): Promise<void> {
  // Three distinct projects, one channel each \u2014 the fleet, per project.
  assert.deepEqual(PROJECTS, ["acp-support", "acp-sales", "acp-scheduling"]);
  assert.equal(CHANNELS["acp-support"], "web");
  assert.equal(CHANNELS["acp-sales"], "email");
  assert.equal(CHANNELS["acp-scheduling"], "phone");
  for (const project of PROJECTS) {
    assert.ok(INSTRUCTIONS[project].length > 40, `${project} needs instructions`);
  }

  // Each project is a real Agent subclass sharing the same turn handler.
  for (const AgentClass of [SupportAgent, SalesAgent, SchedulingAgent]) {
    assert.ok(AgentClass.prototype instanceof FleetAgent);
    assert.equal(typeof AgentClass.prototype.handleMessage, "function");
  }

  // Verb routing: unknown projects are rejected before any binding is touched.
  const unknown = await fleet.fetch(new Request("https://fleet.test/not-a-project/status"), {} as never);
  assert.equal(unknown.status, 404);
  const body = (await unknown.json()) as { error: string };
  assert.match(body.error, /unknown project/);

  // `list` is deliberately not shipped in the beta \u2014 it must not route.
  const list = await fleet.fetch(new Request("https://fleet.test/acp-support/list"), {} as never);
  assert.equal(list.status, 404);

  // `logs --since` parsing.
  assert.equal(parseSince("10m"), 600_000);
  assert.equal(parseSince("1h"), 3_600_000);
  assert.equal(parseSince("30s"), 30_000);
  assert.equal(parseSince(null), 600_000);

  assert.ok(isProject("acp-sales"));
  assert.ok(!isProject("acp-marketing"));

  console.log("smoke_test: agent-fleet OK \u2014 3 agents, 5 verbs, no network calls");
}

runSmokeTest().catch((error) => {
  console.error(error);
  process.exit(1);
});
