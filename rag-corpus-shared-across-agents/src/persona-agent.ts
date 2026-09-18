import { Agent } from "@telnyx/edge-runtime";
import {
  findPersona,
  modelId,
  sanitizeCorpusId,
  type AskInput,
  type AskResult,
  type Env,
  type PersonaState,
} from "./types.js";

/** Narrow the SDK's open record completion response without casting. */
function firstMessageContent(response: unknown): string | null {
  if (typeof response !== "object" || response === null || !("choices" in response)) {
    return null;
  }
  const choices = (response as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (typeof first !== "object" || first === null || !("message" in first)) return null;
  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null || !("content" in message)) return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

/**
 * `toOpenAI()` types roles as `string`; the completions API needs the literal
 * union — keep only the three conversational roles (tool turns are dropped,
 * same as the `toLangChain()` adapter's behavior).
 */
function toChatMessages(
  history: Awaited<ReturnType<PersonaAgent["messages"]["toOpenAI"]>>,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const kept: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
  for (const message of history) {
    if (
      (message.role === "user" || message.role === "assistant" || message.role === "system") &&
      typeof message.content === "string"
    ) {
      kept.push({ role: message.role, content: message.content });
    }
  }
  return kept;
}

function sourcesBlock(sources: AskInput["sources"]): string {
  if (sources.length === 0) return "(no matching documents found)";
  return sources
    .map((hit, i) => `[${i + 1}] (source: ${hit.doc})\n${hit.text}`)
    .join("\n\n---\n\n");
}

/**
 * One agent personality over the shared corpus. The actor name encodes the
 * (corpus, persona) pair, so each persona accumulates its own durable
 * conversation history in `this.messages`. Retrieval is orchestrated by the
 * worker (actor namespaces are not injected into actor envs on the
 * platform), which passes the retrieved sources in — every persona actor
 * therefore answers from the SAME corpus store.
 */
export class PersonaAgent extends Agent<Env, PersonaState> {
  protected initialState(): PersonaState {
    return { corpusId: "", persona: "", asks: 0, lastAskedAt: 0 };
  }

  /**
   * Answer a question from pre-retrieved sources. The persona system prompt
   * shapes the reply; the Q/A pair is appended to this actor's MessageLog so
   * follow-ups keep context.
   */
  async answer(input: AskInput): Promise<AskResult> {
    const question = input.question.trim();
    if (!question) {
      throw new Error("answer: question is required");
    }
    const corpusId = sanitizeCorpusId(input.corpusId);
    const persona = findPersona(input.persona);

    const completion = await this.env.TELNYX.ai.openai.chat.createCompletion({
      model: modelId(this.env),
      messages: [
        { role: "system", content: persona.systemPrompt },
        ...toChatMessages(await this.messages.toOpenAI()),
        {
          role: "user",
          content: `Knowledge-base context:\n\n${sourcesBlock(input.sources)}\n\nQuestion: ${question}`,
        },
      ],
      max_tokens: 500,
      temperature: 0.4,
    });
    const answer =
      firstMessageContent(completion)?.trim() ||
      "I could not generate an answer — the knowledge base may not cover this yet.";

    await this.messages.add("user", question);
    await this.messages.add("assistant", answer);
    await this.setState({
      corpusId,
      persona: persona.id,
      asks: (await this.getState()).asks + 1,
      lastAskedAt: Date.now(),
    });

    return {
      corpusId,
      persona: persona.id,
      question,
      answer,
      sources: input.sources,
      model: modelId(this.env),
    };
  }

  /** Conversation snapshot for the demo UI / REST. */
  async transcript(): Promise<{ persona: string; corpusId: string; asks: number }> {
    const state = await this.getState();
    return { persona: state.persona, corpusId: state.corpusId, asks: state.asks };
  }
}
