import { Agent, rpc, type ActorContext } from "@telnyx/edge-runtime";
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { AgentExecutor, createToolCallingAgent } from "langchain/agents";
import { TelnyxStreamingChatModel } from "./telnyx-chat-model.js";
import { supportTools } from "./tools.js";
import { modelId, type AgentState, type Env, type StreamingAgentEvent } from "./types.js";

const SYSTEM_PROMPT =
  "You are the support copilot for Telnyx Logistics. " +
  "Answer in one or two short sentences. " +
  "Use the lookup_order tool when the customer mentions an order id or asks where an order is, " +
  "and get_return_policy for policy questions — never invent order details or policy text.";

/**
 * Maps the Agent SDK's durable message log into LangChain messages.
 *
 * `this.messages.toLangChain()` returns plain `{ role, content }` turns
 * (user/assistant/system; tool turns are dropped). Wrap them into
 * `HumanMessage` / `AIMessage` instances for the LangChain agent.
 */
function toBaseMessages(
  history: Array<{ role: string; content: string }>,
): BaseMessage[] {
  return history.map((m) => {
    if (m.role === "user") return new HumanMessage(m.content);
    if (m.role === "system") return new SystemMessage(m.content);
    return new AIMessage(m.content);
  });
}

function stringifyEvent(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * One streaming conversation — `class StreamingAgent extends Agent`.
 *
 * Why an Agent (not a plain worker route)?
 * - Durable message history: `this.messages` survives restarts.
 * - Durable progress events: `this.events` is a cursor-replayable log — every
 *   streamed token is committed and can be replayed by a reconnecting client
 *   (the browser `AgentClient` resumes with `resume: true`).
 * - Crash-safe runs: the agent loop is a *task* (`this.queue("run")`); if the
 *   isolate dies mid-turn, the runtime re-dispatches it on reactivation.
 * - Built-in WebSocket surface: clients attach with a token; committed state,
 *   message, and event changes are pushed live with no socket code here.
 */
export class StreamingAgent extends Agent<Env, AgentState> {
  constructor(ctx: ActorContext, env: Env) {
    super(ctx, env, { events: { retain: 5000 } });
  }

  protected override initialState(): AgentState {
    return { status: "idle", turn: 0, answeredThrough: 0, toolsUsed: 0 };
  }

  /**
   * Connection gate — overriding it activates the built-in WebSocket surface.
   * This is a public demo, so any token is granted the `rpc` claim (required
   * for client `stub` calls). In production, verify the token here.
   */
  protected override authorize(): readonly string[] {
    return ["rpc"];
  }

  /** Remote-callable: the browser calls `stub.send(text)`. */
  @rpc({ description: "Append a user message and run the streaming agent loop" })
  async send(text: string): Promise<{ turn: number }> {
    const trimmed = text.trim();
    if (!trimmed) return { turn: (await this.getState()).turn };

    const state = await this.getState();
    const turn = state.turn + 1;

    await this.messages.add("user", trimmed);
    await this.setState({ status: "thinking", turn });
    // Runs as a durable task: survives crashes, serialized per agent.
    await this.queue("run");
    return { turn };
  }

  /** Full history snapshot for REST consumers and tests. */
  async transcript(): Promise<{ messages: Array<{ role: string; content: string }> }> {
    return { messages: await this.messages.toLangChain() };
  }

  /** Public state accessor (the base `getState` is protected). */
  async currentState(): Promise<AgentState> {
    return this.getState();
  }

  /**
   * The agent loop: answers EVERY pending user turn, oldest first.
   *
   * WebSocket message → `send()` → this task → for each unanswered user
   * message (seq > answeredThrough): prior history → LangChain agent
   * (streaming) → token/tool events into `this.events` (pushed live to
   * clients) → assistant reply committed to the message log.
   *
   * Queued runs are idempotent: `answeredThrough` only advances after a
   * turn's answer commits, so a re-dispatch after a crash reprocesses
   * exactly the unanswered turns, and a redundant run finds nothing pending.
   */
  async run(): Promise<void> {
    const state = await this.getState();
    const all = await this.messages.all();
    const pending = all.filter(
      (m) => m.role === "user" && m.seq > (state.answeredThrough ?? 0),
    );
    if (pending.length === 0) return;

    await this.setState({ status: "thinking" });

    let toolsUsed = 0;

    for (const userTurn of pending) {
      const history = all
        .filter((m) => m.seq < userTurn.seq)
        .map((m) => ({ role: m.role, content: m.content }));
      const baseMessages = toBaseMessages(history);
      const turn = userTurn.seq;

      let roundText = "";

      // The executor invokes the model per round rather than streaming it, so
      // token deltas are captured by the model's onToken hook; streamEvents
      // supplies the round boundaries and the tool start/end events.
      const llm = new TelnyxStreamingChatModel({
        env: this.env,
        model: modelId(this.env),
        temperature: 0.3,
        maxTokens: 400,
        onToken: async (text) => {
          roundText += text;
          await this.emit({ type: "token", payload: { turn, text } });
        },
      });

      const prompt = ChatPromptTemplate.fromMessages([
        ["system", SYSTEM_PROMPT],
        new MessagesPlaceholder("chat_history"),
        ["human", "{input}"],
        new MessagesPlaceholder("agent_scratchpad"),
      ]);
      const agent = createToolCallingAgent({ llm, tools: supportTools, prompt });
      const executor = new AgentExecutor({ agent, tools: supportTools });

      // BaseChain.streamEvents(input, { version }) runs the loop and emits v2
      // callback events. on_chat_model_start marks each tool round, so the
      // accumulated text of the LAST round is the committed answer.
      const events = executor.streamEvents(
        { input: userTurn.content, chat_history: baseMessages },
        { version: "v2" },
      );
      for await (const event of events) {
        if (event.event === "on_chat_model_start") {
          roundText = "";
        } else if (event.event === "on_tool_start") {
          toolsUsed += 1;
          await this.emit({
            type: "tool_start",
            payload: { turn, tool: String(event.name ?? "tool"), input: event.data.input },
          });
        } else if (event.event === "on_tool_end") {
          await this.emit({
            type: "tool_result",
            payload: {
              turn,
              tool: String(event.name ?? "tool"),
              output: stringifyEvent(event.data.output),
            },
          });
        }
      }

      const answer = roundText.trim();
      if (answer) {
        await this.messages.add("assistant", answer);
      }
      // Crash-recovery invariant: answeredThrough advances only AFTER the
      // answer commits, so a mid-turn crash reprocesses exactly that turn.
      await this.setState({ answeredThrough: turn });
    }

    const current = await this.getState();
    await this.setState({ status: "idle", toolsUsed: current.toolsUsed + toolsUsed });
  }

  /** Commit one streaming event; the Agent base pushes it live to watchers. */
  private async emit(event: StreamingAgentEvent): Promise<void> {
    await this.events.emit(event.type, event.payload);
  }
}
