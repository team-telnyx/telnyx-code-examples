import type { Call, CallEvent, CallEventKind, CallStatus, DemoState, PhoneE164 } from "@/domain/types";
import type { StateStore } from "@/demo/state";

// Call driver seam: implementations simulate (mock) or place (Telnyx) calls.
// The driver owns the call lifecycle; DemoDriver owns the scripted beats.

export interface CallDriver {
  /** Place a call. The driver emits call.initiated (and only that) via emit. */
  start(req: { to: PhoneE164; from: PhoneE164 }, emit: (e: CallEvent) => void | Promise<void>): Promise<{ callId: string }>;
  /** Cancel/hang up an in-flight call. */
  cancel(callId: string): Promise<void>;
}

const STATUS_FOR_EVENT: Partial<Record<CallEventKind, CallStatus>> = {
  "call.initiated": "dialing",
  "call.answered": "in_progress",
  "transfer.connected": "connected_to_staff",
  "call.ended": "ended",
  "call.failed": "failed",
};

export async function appendCallEvent(store: StateStore, event: CallEvent): Promise<void> {
  const status = STATUS_FOR_EVENT[event.kind];
  const withEvent = (call: Call): Call => ({
    ...call,
    events: [...call.events, event],
    status: status ?? call.status,
    endedAtIso: event.kind === "call.ended" ? event.atIso : call.endedAtIso,
  });
  await store.update((s) => {
    if (s.calls.some((c) => c.id === event.callId)) {
      return { ...s, calls: s.calls.map((c) => (c.id === event.callId ? withEvent(c) : c)), updatedAtIso: new Date().toISOString() };
    }
    if (event.kind !== "call.initiated") return s;
    const data = event.data ?? {};
    const call: Call = {
      id: event.callId,
      toE164: typeof data.to === "string" ? data.to : "",
      fromE164: typeof data.from === "string" ? data.from : "",
      status: status ?? "dialing",
      events: [event],
      startedAtIso: event.atIso,
    };
    return { ...s, calls: [...s.calls, call], updatedAtIso: new Date().toISOString() };
  });
}

/**
 * Rescue path for live webhook events keyed by a non-control id (Telnyx
 * conversation/leg ids): if the event matches no call record but exactly one
 * live call exists, retarget it so transcripts and terminal events attach to
 * the demo's own call. Conservative: never steals call.initiated and never
 * resolves when zero or multiple calls are live.
 */
export function rescueLiveCallId(state: DemoState, event: CallEvent): string | null {
  if (state.calls.some((c) => c.id === event.callId)) return null;
  if (event.kind === "call.initiated") return null;
  const live = state.calls.filter(
    (c) => c.status === "dialing" || c.status === "in_progress" || c.status === "connected_to_staff",
  );
  return live.length === 1 ? live[0].id : null;
}
