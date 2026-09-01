import { describe, expect, it } from "vitest";
import { PersonaAgent } from "../src/persona-agent.js";
import { CorpusAgent } from "../src/corpus-agent.js";
import worker from "../src/index.js";
import { makeActorContext, makeNamespace } from "./helpers/actor-test-kit.js";
import { FakeTelnyx, type RecordedChatCall } from "./helpers/fake-telnyx.js";
import type { Env, SearchHit } from "../src/types.js";

function makePersonaAgent(fake: FakeTelnyx, id = "product-docs:support"): PersonaAgent {
  const env = { PERSONAS: {}, TELNYX: fake } as unknown as Env;
  return new PersonaAgent(makeActorContext(id), env);
}

/** Namespace stand-in whose idFromName always resolves to the SAME actor. */
function namespaceReturning(instance: unknown): Env["CORPUS"] {
  return {
    idFromName: () =>
      new Proxy(instance as Record<string, unknown>, {
        get(obj, prop) {
          const value = Reflect.get(obj, prop);
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(instance) : value;
        },
      }),
  } as unknown as Env["CORPUS"];
}

const HITS: SearchHit[] = [
  { id: "knowledge/api-keys.txt#0", doc: "knowledge/api-keys.txt", ord: 0, text: "Rotate keys quarterly, deploying the new key first.", score: 0.88 },
];

describe("PersonaAgent", () => {
  it("answers using the persona system prompt and the injected sources", async () => {
    const fake = new FakeTelnyx({ chatReply: "Rotate keys quarterly." });
    const persona = makePersonaAgent(fake);

    const result = await persona.answer({
      corpusId: "product-docs",
      persona: "support",
      question: "How do I rotate an API key?",
      sources: HITS,
    });

    expect(result.answer).toBe("Rotate keys quarterly.");
    expect(result.persona).toBe("support");
    expect(result.corpusId).toBe("product-docs");
    expect(result.sources).toEqual(HITS);
    expect(result.model).toBe("meta-llama/Llama-3.3-70B-Instruct");

    expect(fake.chatCalls).toHaveLength(1);
    const call = fake.chatCalls[0];
    expect(call.messages[0].role).toBe("system");
    expect(call.messages[0].content).toContain("patient, friendly customer support agent");
    const userMessage = call.messages[call.messages.length - 1];
    expect(userMessage.content).toContain("How do I rotate an API key?");
    expect(userMessage.content).toContain("Rotate keys quarterly, deploying the new key first.");
  });

  it("falls back to the support persona for an unknown persona id", async () => {
    const fake = new FakeTelnyx();
    const persona = makePersonaAgent(fake);

    const result = await persona.answer({
      corpusId: "product-docs",
      persona: "no-such-persona",
      question: "hello?",
      sources: [],
    });

    expect(result.persona).toBe("support");
    expect(fake.chatCalls[0].messages[0].content).toContain("customer support agent");
  });

  it("rejects an empty question", async () => {
    const fake = new FakeTelnyx();
    const persona = makePersonaAgent(fake);

    await expect(
      persona.answer({ corpusId: "c", persona: "support", question: "   ", sources: [] }),
    ).rejects.toThrow("question is required");
    expect(fake.chatCalls).toHaveLength(0);
  });

  it("keeps per-persona conversation history for follow-up context", async () => {
    const fake = new FakeTelnyx();
    const persona = makePersonaAgent(fake);

    await persona.answer({ corpusId: "product-docs", persona: "support", question: "first question", sources: HITS });
    await persona.answer({ corpusId: "product-docs", persona: "support", question: "follow up please", sources: [] });

    const secondCall = fake.chatCalls[1];
    expect(secondCall.messages.map((m) => m.role)).toContain("assistant");
    const historyText = secondCall.messages.map((m) => m.content).join("\n");
    expect(historyText).toContain("first question");
    expect(historyText).toContain("Grounded answer from the shared corpus.");
  });

  it("worker orchestration: every persona answers from the SAME corpus retrieval", async () => {
    const fake = new FakeTelnyx();
    const corpusEnv = { TELNYX: fake } as unknown as Env;
    const corpus = new CorpusAgent(makeActorContext("product-docs"), corpusEnv);
    await corpus.ingest("knowledge/shared.txt", "The deployment command is telnyx-edge ship.");

    const personaEnv = { PERSONAS: {}, TELNYX: fake } as unknown as Env;
    const env = {
      CORPUS: namespaceReturning(corpus),
      PERSONAS: makeNamespace((name) => new PersonaAgent(makeActorContext(name), personaEnv)),
      TELNYX: fake,
    } as unknown as Env;

    const ask = (persona: string) =>
      worker.fetch(
        new Request("https://f/api/corpus/product-docs/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ persona, question: "How do I deploy?" }),
        }),
        env,
      ) as Promise<Response>;

    const support = (await (await ask("support")).json()) as { answer: string; sources: SearchHit[] };
    const sales = (await (await ask("sales")).json()) as { answer: string; sources: SearchHit[] };

    expect(support.sources).toEqual(sales.sources);
    expect(support.sources[0].text).toContain("telnyx-edge ship");
    const personaCalls = fake.chatCalls as RecordedChatCall[];
    expect(personaCalls).toHaveLength(2);
    expect(personaCalls[0].messages[0].content).toContain("customer support agent");
    expect(personaCalls[1].messages[0].content).toContain("confident sales engineer");
  });
});
