/**
 * A small LangGraph-style orchestration boundary for Edge Compute.
 *
 * The graph keeps channel adapters thin and makes the shared state explicit:
 * normalize -> load context -> draft -> approval/send. Durable actor SQL is
 * the persistence layer, so this module has no Node-only dependencies and can
 * run in the Edge runtime. It can be replaced by @langchain/langgraph when
 * deploying the orchestration layer in a full Node service.
 */

export type OmniChannel = "voice" | "email" | "sms" | "fax";

export interface OmniGraphState<TContext = unknown> {
  customerId: string;
  caseId: string;
  channel: OmniChannel;
  input: string;
  context: TContext;
  draft: string | null;
  approvalRequired: boolean;
  approved: boolean;
  status: "received" | "awaiting_human" | "ready_to_send";
}

export interface OmniGraphNodes<TContext> {
  loadContext: (state: OmniGraphState<TContext>) => Promise<TContext>;
  draft: (state: OmniGraphState<TContext>) => Promise<string>;
  requiresApproval?: (state: OmniGraphState<TContext>) => boolean;
}

/** Execute one deterministic graph run. Human approval resumes with approved=true. */
export async function runOmniGraph<TContext>(
  initial: Pick<OmniGraphState<TContext>, "customerId" | "caseId" | "channel" | "input"> &
    Partial<Pick<OmniGraphState<TContext>, "approved">>,
  nodes: OmniGraphNodes<TContext>,
): Promise<OmniGraphState<TContext>> {
  let state: OmniGraphState<TContext> = {
    ...initial,
    context: undefined as TContext,
    draft: null,
    approvalRequired: false,
    approved: initial.approved ?? false,
    status: "received",
  };
  state = { ...state, context: await nodes.loadContext(state) };
  state = { ...state, draft: await nodes.draft(state) };
  state = {
    ...state,
    approvalRequired: nodes.requiresApproval?.(state) ?? state.channel === "email",
  };
  state = {
    ...state,
    status: state.approvalRequired && !state.approved ? "awaiting_human" : "ready_to_send",
  };
  return state;
}
