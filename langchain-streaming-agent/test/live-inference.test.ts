/**
 * Live end-to-end test against real Telnyx Inference.
 *
 * Opt-in so the default suite stays hermetic:
 *   TELNYX_API_KEY=... RUN_LIVE_INFERENCE=1 npx vitest run test/live-inference.test.ts
 */
import { describe, expect, it } from "vitest";
import Telnyx from "telnyx";
import { createAgentWithEnv, waitFor, type AgentFixture } from "./helpers.js";
import type { TelnyxInferenceClient } from "../src/telnyx-client.js";
import type { Env } from "../src/types.js";

const apiKey = process.env.TELNYX_API_KEY ?? "";
const MODEL = process.env.AI_MODEL ?? "zai-org/GLM-5.2";
const d = describe.skipIf(!apiKey || process.env.RUN_LIVE_INFERENCE !== "1");

function makeLiveAgent(): AgentFixture {
  const env = {
    AGENTS: {},
    TELNYX: new Telnyx({ apiKey }) as unknown as TelnyxInferenceClient,
    AI_MODEL: MODEL,
  };
  return createAgentWithEnv(env as unknown as Env);
}

async function runToIdle(fixture: AgentFixture, text: string, ms: number): Promise<void> {
  await fixture.agent.send(text);
  await waitFor(async () => {
    const state = await fixture.state();
    return state.status === "idle" && (state.answeredThrough ?? 0) >= state.turn;
  }, ms);
}

d("live inference (real TELNYX_API_KEY)", () => {
  it(
    "streams a real answer over the full agent loop",
    async () => {
      const fixture = makeLiveAgent();
      await runToIdle(
        fixture,
        "In one short sentence, say hello and name the shipping company you work for.",
        30_000,
      );

      const transcript = await fixture.agent.transcript();
      const answer = transcript.messages.at(-1);
      expect(answer?.role).toBe("assistant");
      expect((answer?.content ?? "").length).toBeGreaterThan(3);

      const events = await fixture.events();
      expect(events.filter((e) => e.type === "token").length).toBeGreaterThan(2);
    },
    60_000,
  );

  it(
    "calls lookup_order for an order question",
    async () => {
      const fixture = makeLiveAgent();
      await runToIdle(fixture, "Where is my order ORD-1042?", 60_000);

      const events = await fixture.events();
      expect(events.find((e) => e.type === "tool_start")).toBeTruthy();
      const transcript = await fixture.agent.transcript();
      expect(transcript.messages.at(-1)?.content.toLowerCase()).toContain("ord-1042");
    },
    90_000,
  );
});
