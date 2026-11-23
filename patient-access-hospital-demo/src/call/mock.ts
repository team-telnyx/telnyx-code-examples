import type { CallEvent } from "@/domain/types";
import type { CallDriver } from "@/call/driver";

// Trivial mock transport: emits call.initiated on start, otherwise inert.
// The DemoDriver orchestrates every scripted beat through the shared emit.

export class MockCallDriver implements CallDriver {
  private seq = 0;
  /** Calls whose start() was invoked; useful for asserting transport behavior. */
  readonly startedCalls: string[] = [];
  readonly cancelledCalls: string[] = [];

  async start(
    req: { to: string; from: string },
    emit: (e: CallEvent) => void,
  ): Promise<{ callId: string }> {
    this.seq += 1;
    const callId = `mock-call-${this.seq}`;
    this.startedCalls.push(callId);
    emit({
      id: `evt-${crypto.randomUUID()}`,
      callId,
      atIso: new Date().toISOString(),
      kind: "call.initiated",
      data: { to: req.to, from: req.from },
    });
    return { callId };
  }

  async cancel(callId: string): Promise<void> {
    this.cancelledCalls.push(callId);
  }
}
