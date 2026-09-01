import { describe, expect, it } from "vitest";
import { PersonaAgent } from "../src/persona-agent.js";
import { CorpusAgent } from "../src/corpus-agent.js";
import { makeActorContext } from "./helpers/actor-test-kit.js";
import { FakeTelnyx } from "./helpers/fake-telnyx.js";
import type { Env } from "../src/types.js";

function makePersonaAgent(
  fake: FakeTelnyx,
  corpusNamespace: Env["CORPUS"],
  id = "product-docs:support",
): PersonaAgent {
  const env = {
    CORPUS: corpusNamespace,
    PERSONAS: {},
    TELNYX: fake,
  } as unknown as Env;
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

function makeSharedCorpus(fake: FakeTelnyx): {
  namespace: Env["CORPUS"];
  corpus: CorpusAgent;
} {
  const env = { CORPUS: {}, PERSONAS: {}, TELNYX: fake } as unknown as Env;
  const corpus = new CorpusAgent(makeActorContext("product-docs"), env);
  return { namespace: namespaceReturning(corpus), corpus };
}

describe("PersonaAgent", () => {
  it("answers using the persona system prompt and retrieved sources", async () => {
    const fake = new FakeTelnyx({ chatReply: "Rotate keys quarterly." });
    const { namespace } = makeSharedCorpus(fake);
    const persona = makePersonaAgent(fake, namespace);

    const result = await persona.ask({
      corpusId: "product-docs",
      persona: "support",
      question: "How do I rotate an API key?",
    });

    expect(result.answer).toBe("Rotate keys quarterly.");
    expect(result.persona).toBe("support");
    expect(result.corpusId).toBe("product-docs");

    expect(fake.chatCalls).toHaveLength(1);
    const call = fake.chatCalls[0];
    expect(call.model).toBe("meta-llama/Llama-3.3-70B-Instruct");
    expect(call.messages[0].role).toBe("system");
    expect(call.messages[0].content).toContain("patient, friendly customer support agent");
    const userMessage = call.messages[call.messages.length - 1];
    expect(userMessage.content).toContain("How do I rotate an API key?");
  });

  it("includes retrieved corpus text in the prompt as sources", async () => {
    const fake = new FakeTelnyx();
    const { namespace, corpus } = makeSharedCorpus(fake);

    await corpus.ingest(
      "knowledge/api-keys.txt",
      "Create keys in the Portal under Account Settings.\n\nRotate keys quarterly, deploy the new key first.",
    );
    const persona = makePersonaAgent(fake, namespace);
    const result = await persona.ask({
      corpusId: "product-docs",
      persona: "engineer",
      question: "What is the API key rotation procedure?",
    });

    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.sources[0].doc).toBe("knowledge/api-keys.txt");
    const userMessage = fake.chatCalls[0].messages[fake.chatCalls[0].messages.length - 1];
    expect(userMessage.content).toContain("Rotate keys quarterly");
    expect(fake.chatCalls[0].messages[0].content).toContain("precise solutions engineer");
  });

  it("falls back to the support persona for an unknown persona id", async () => {
    const fake = new FakeTelnyx();
    const { namespace } = makeSharedCorpus(fake);
    const persona = makePersonaAgent(fake, namespace);

    const result = await persona.ask({
      corpusId: "product-docs",
      persona: "no-such-persona",
      question: "hello?",
    });

    expect(result.persona).toBe("support");
    expect(fake.chatCalls[0].messages[0].content).toContain("customer support agent");
  });

  it("rejects an empty question", async () => {
    const fake = new FakeTelnyx();
    const { namespace } = makeSharedCorpus(fake);
    const persona = makePersonaAgent(fake, namespace);

    await expect(persona.ask({ corpusId: "c", persona: "support", question: "   " })).rejects.toThrow(
      "question is required",
    );
    expect(fake.chatCalls).toHaveLength(0);
  });

  it("keeps per-persona conversation history for follow-up context", async () => {
    const fake = new FakeTelnyx();
    const { namespace } = makeSharedCorpus(fake);
    const persona = makePersonaAgent(fake, namespace);

    await persona.ask({ corpusId: "product-docs", persona: "support", question: "first question" });
    await persona.ask({ corpusId: "product-docs", persona: "support", question: "follow up please" });

    const secondCall = fake.chatCalls[1];
    const roles = secondCall.messages.map((m) => m.role);
    expect(roles).toContain("assistant");
    const historyText = secondCall.messages.map((m) => m.content).join("\n");
    expect(historyText).toContain("first question");
    expect(historyText).toContain("Grounded answer from the shared corpus.");
  });

  it("two personas share one corpus — both retrieve from the same store", async () => {
    const fake = new FakeTelnyx();
    const { namespace, corpus } = makeSharedCorpus(fake);
    await corpus.ingest("knowledge/shared.txt", "The deployment command is telnyx-edge ship.");

    const support = makePersonaAgent(fake, namespace, "product-docs:support");
    const sales = makePersonaAgent(fake, namespace, "product-docs:sales");

    const supportAnswer = await support.ask({
      corpusId: "product-docs",
      persona: "support",
      question: "How do I deploy?",
    });
    const salesAnswer = await sales.ask({
      corpusId: "product-docs",
      persona: "sales",
      question: "How do I deploy?",
    });

    expect(supportAnswer.sources).toEqual(salesAnswer.sources);
    expect(supportAnswer.sources[0].text).toContain("telnyx-edge ship");
    const transcript = await sales.transcript();
    expect(transcript).toEqual({ persona: "sales", corpusId: "product-docs", asks: 1 });
  });
});
