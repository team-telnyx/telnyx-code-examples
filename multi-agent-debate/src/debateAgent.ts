import { Agent } from "@telnyx/edge-runtime";

// ── State ────────────────────────────────────────────────────────────────

export type Stance = "pro" | "con";

export interface DebateAgentState extends Record<string, unknown> {
  debateId: string;
  topic: string;
  stance: Stance;
  argument: string;
  turnCount: number;
  error: string;
  updatedAt: number;
}

// ── Env: [telnyx] binding only (actors receive no secrets/env_vars) ──────

interface DebateEnv {
  TELNYX: {
    ai: {
      openai: {
        chat: {
          createCompletion(req: {
            model: string;
            messages: Array<{ role: string; content: string }>;
            max_tokens?: number;
            temperature?: number;
          }): Promise<{ choices?: Array<{ message?: { content?: string } }> }>;
        };
      };
    };
  };
}

const MAX_TOKENS = 256;

/** Canned arguments keep the demo running without an inference call. */
const DEMO_ARGUMENTS: Record<Stance, string[]> = {
  pro: [
    "Opening pro: the proposal creates clear value and manageable risk, and delay costs more than the change itself.",
    "Pro rebuttal: the concerns raised are real but solvable with guardrails we can deploy today, while the upside compounds.",
  ],
  con: [
    "Con rebuttal: the promised guardrails are tomorrow's exemptions, and the burden of proof sits with the proposal, not its critics.",
    "Con closing: even with guardrails, the costs land on the people least able to absorb them — vote no.",
  ],
};

const SYSTEM_PROMPT = (stance: Stance): string =>
  `You are a debate agent arguing the ${stance} side. Be concise (under 120 words) and persuasive. ` +
  (stance === "pro"
    ? "Argue in favor of the resolution."
    : "Argue against the resolution.");

function buildPrompt(topic: string, stance: Stance, previousArgument: string): string {
  if (previousArgument) {
    return `Topic: "${topic}". Rebut this opposing argument: "${previousArgument}". Present your ${stance} argument.`;
  }
  return `Topic: "${topic}". Present your opening ${stance} argument.`;
}

/**
 * DebateAgent — one durable actor instance per debater (pro or con), keyed by
 * `<debateId>-<stance>`. The DebateRoom actor composes arguments through
 * `compose()`, passing the debate config along because actors receive no
 * env_vars: `demo` and `model` ride the call from the fetch env.
 */
export class DebateAgent extends Agent<DebateEnv, DebateAgentState> {
  protected override initialState(): DebateAgentState {
    return {
      debateId: "",
      topic: "",
      stance: "pro",
      argument: "",
      turnCount: 0,
      error: "",
      updatedAt: 0,
    };
  }

  async compose(input: {
    debateId: string;
    topic: string;
    stance: Stance;
    demo: boolean;
    model: string;
    previousArgument: string;
  }): Promise<DebateAgentState> {
    const state = await this.getState();
    const argument = await this.generate(input, state.turnCount);
    await this.setState({
      debateId: input.debateId,
      topic: input.topic,
      stance: input.stance,
      argument,
      turnCount: state.turnCount + 1,
      error: "",
      updatedAt: Date.now(),
    });
    return this.getState();
  }

  private async generate(
    input: {
      topic: string;
      stance: Stance;
      demo: boolean;
      model: string;
      previousArgument: string;
    },
    turnCount: number,
  ): Promise<string> {
    const prompt = buildPrompt(input.topic, input.stance, input.previousArgument);
    if (input.demo) {
      const templates = DEMO_ARGUMENTS[input.stance];
      return templates[turnCount % templates.length];
    }
    try {
      const response = await this.env.TELNYX.ai.openai.chat.createCompletion({
        model: input.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT(input.stance) },
          { role: "user", content: prompt },
        ],
        max_tokens: MAX_TOKENS,
        temperature: 0.7,
      });
      const argument = response.choices?.[0]?.message?.content?.trim() ?? "";
      if (!argument) throw new Error("inference returned an empty argument");
      return argument;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await this.setState({ error: message, updatedAt: Date.now() });
      throw new Error(`argument generation failed: ${message}`);
    }
  }
}
