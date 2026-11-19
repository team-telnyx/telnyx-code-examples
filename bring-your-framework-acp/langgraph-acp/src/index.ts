import { Agent, rpc, type Claim, type Env } from "@telnyx/edge-runtime";
import { AgentHttpServer } from "@telnyx/edge-runtime/agent-http";
import { buildGraph } from "./graph.js";
import { finalReply, type DemoState, type DemoTrace, type DemoTraceRun } from "./conversation.js";
import { customerForPhone, type CustomerProfile } from "./tools.js";

type AgentEnv = Env & {
  SECRETS?: { get(name: string): Promise<string | undefined> };
  TELNYX?: {
    messages: { send(params: Record<string, unknown>): Promise<unknown> };
  };
  DEMO_CUSTOMER_PHONE?: string;
  DEMO_CUSTOMER_NAME?: string;
};

type ReplyVia = {
  kind: "messaging";
  profileId: string;
  from: string;
  to: string;
};

export class Conversation extends Agent<AgentEnv, DemoState> {
  private door: AgentHttpServer<DemoState> | undefined;

  override fetch(req: Request): Promise<Response> {
    return (this.door ??= new AgentHttpServer<DemoState>(this.connectionEngine)).fetch(req);
  }

  protected override authorize(): readonly Claim[] {
    return ["read", "rpc"];
  }

  protected override initialState(): DemoState {
    return { processedTurns: 0 };
  }

  @rpc({ description: "Record one user message and process it in the background." })
  async receive(text: string, _from?: string, key?: string): Promise<{ runId: string; duplicate: boolean }> {
    return this.admit(text, _from, key);
  }

  async receiveVia(
    text: string,
    from: string,
    key: string,
    via: ReplyVia,
  ): Promise<{ runId: string; duplicate: boolean }> {
    return this.admit(text, from, key, via);
  }

  private async admit(
    text: string,
    _from?: string,
    key?: string,
    via?: ReplyVia,
  ): Promise<{ runId: string; duplicate: boolean }> {
    const runId = key === undefined ? `run-${Date.now()}-${crypto.randomUUID()}` : `run-${key}`;
    const state = await this.getState();
    if (state.runs?.[runId] !== undefined) return { runId, duplicate: true };

    const startedAt = Date.now();
    const customer = await this.customerFor(_from);
    const trace: DemoTrace = {
      run: {
        runId,
        conversation: this.ctx.id,
        channel: via?.kind ?? "invoke",
        status: "accepted",
        startedAt,
        durationMs: 0,
        tokens: { input: 0, output: 0, total: 0 },
        toolCalls: 0,
      },
      spans: [],
    };
    await this.setState({ customer: customer ?? undefined, runs: { [runId]: "accepted" }, traceRuns: { [runId]: trace } });
    await this.messages.add("user", text);
    await this.queue("process", { runId, via });
    return { runId, duplicate: false };
  }

  @rpc({ description: "Return the status of one conversation run." })
  async run(runId: string): Promise<{ id: string; status: string } | undefined> {
    const status = (await this.getState()).runs?.[runId];
    return status === undefined ? undefined : { id: runId, status };
  }

  @rpc({ description: "Return the native ACP trace for one run." })
  async trace(runId: string): Promise<DemoTrace | null> {
    return (await this.getState()).traceRuns?.[runId] ?? null;
  }

  @rpc({ description: "Return recent native ACP trace summaries." })
  async traces(limit = 20): Promise<{ runs: DemoTraceRun[] }> {
    const traceRuns = Object.values((await this.getState()).traceRuns ?? {});
    return {
      runs: traceRuns
        .sort((a, b) => b.run.startedAt - a.run.startedAt)
        .slice(0, Math.min(Math.max(limit, 1), 50))
        .map(({ run }) => run),
    };
  }

  async process({ runId, via }: { runId: string; via?: ReplyVia }): Promise<void> {
    try {
      const startedAt = Date.now();
      await this.updateTrace(runId, (trace) => ({ ...trace, run: { ...trace.run, status: "running" } }));
      const history = await this.messages.toLangChain();
      const apiKey = await this.env.SECRETS?.get("TELNYX_API_KEY");
      const state = await this.getState();
      const customer = state.customer;
      const modelStarted = Date.now();
      console.log(JSON.stringify({ framework_event: "model_request", framework: "langgraph", model: "zai-org/GLM-5.3-Flash" }));
      const result = await buildGraph({ apiKey, customer }).invoke({ messages: history });
      const modelDuration = Math.max(1, Date.now() - modelStarted);
      const reply = finalReply(result);
      console.log(JSON.stringify({ framework_event: "assistant_response", reply }));
      await this.messages.add("assistant", reply);
      await this.setState({
        processedTurns: state.processedTurns + 1,
        lastRunId: runId,
        lastReply: reply,
        runs: { [runId]: "completed" },
      });
      await this.updateTrace(runId, (trace) => ({
        ...trace,
        run: { ...trace.run, status: "completed", durationMs: Math.max(1, Date.now() - trace.run.startedAt), toolCalls: 1 },
        spans: [
          ...trace.spans,
          { id: `${runId}-model`, parent: "run", kind: "model", name: "langgraph model", start: modelStarted, durationMs: modelDuration, status: "ok", attrs: { model: "zai-org/GLM-5.3-Flash" } },
          { id: `${runId}-tool`, parent: "run", kind: "tool", name: "lookup_order", start: modelStarted + modelDuration, durationMs: 1, status: "ok", attrs: { framework: "langgraph" } },
        ],
      }));
      if (via) {
        const deliveryStarted = Date.now();
        await this.deliver(reply, via);
        await this.updateTrace(runId, (trace) => ({
          ...trace,
          run: { ...trace.run, durationMs: Math.max(1, Date.now() - trace.run.startedAt) },
          spans: [...trace.spans, { id: `${runId}-deliver`, parent: "run", kind: "deliver", name: "messaging", start: deliveryStarted, durationMs: Math.max(1, Date.now() - deliveryStarted), status: "ok", attrs: { channel: "messaging" } }],
        }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("LangGraph process failed", message);
      await this.setState({ lastRunId: runId, lastError: message, runs: { [runId]: "failed" } });
      await this.updateTrace(runId, (trace) => ({ ...trace, run: { ...trace.run, status: "failed", durationMs: Math.max(1, Date.now() - trace.run.startedAt) }, spans: trace.spans }));
    }
  }

  private async customerFor(from?: string): Promise<CustomerProfile | null> {
    const configuredPhone = from ?? await this.env.SECRETS?.get("DEMO_CUSTOMER_PHONE") ?? this.env.DEMO_CUSTOMER_PHONE;
    const configuredDemoPhone = await this.env.SECRETS?.get("DEMO_CUSTOMER_PHONE") ?? this.env.DEMO_CUSTOMER_PHONE;
    const name = await this.env.SECRETS?.get("DEMO_CUSTOMER_NAME") ?? this.env.DEMO_CUSTOMER_NAME ?? "Demo customer";
    return customerForPhone(configuredPhone, configuredDemoPhone, name);
  }

  private async updateTrace(runId: string, update: (trace: DemoTrace) => DemoTrace): Promise<void> {
    const state = await this.getState();
    const trace = state.traceRuns?.[runId];
    if (!trace) return;
    await this.setState({ traceRuns: { [runId]: update(trace) } });
  }

  private async deliver(text: string, via: ReplyVia): Promise<void> {
    if (via.kind !== "messaging" || !this.env.TELNYX) {
      throw new Error("Messaging delivery requires the TELNYX binding.");
    }
    await this.env.TELNYX.messages.send({
      from: via.to,
      to: via.from,
      text,
      messaging_profile_id: via.profileId,
    });
  }
}

export default Conversation;

