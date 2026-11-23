export interface DemoState extends Record<string, unknown> {
  processedTurns: number;
  customer?: { phone: string; name: string; orders: string[] };
  lastRunId?: string;
  lastReply?: string;
  lastError?: string;
  runs?: Record<string, string>;
  traceRuns?: Record<string, DemoTrace>;
}

export interface DemoTraceSpan {
  id: string;
  parent?: string;
  kind: "model" | "tool" | "deliver";
  name: string;
  start: number;
  durationMs: number;
  status: "ok" | "error";
  attrs: Record<string, string | number | boolean>;
}

export interface DemoTraceRun {
  runId: string;
  conversation: string;
  channel: string;
  status: string;
  startedAt: number;
  durationMs: number;
  tokens: { input: number; output: number; total: number };
  toolCalls: number;
}

export interface DemoTrace {
  run: DemoTraceRun;
  spans: DemoTraceSpan[];
}

export function finalReply(result: { messages?: Array<{ content?: unknown }> }): string {
  const finalMessage = result.messages?.at(-1);
  return typeof finalMessage?.content === "string"
    ? finalMessage.content
    : JSON.stringify(finalMessage?.content ?? "I could not find that order.");
}

