/**
 * Webhook payload routing — pure logic, no runtime imports.
 *
 * Resolves which QAAgent actor a call belongs to:
 *   1. `data.metadata[<CALL_METADATA_AGENT_KEY>]` (set at call start on the
 *      agent's desk number) → digest enabled.
 *   2. `AGENT_NUMBER_MAP` (JSON phone number → agentId) → digest enabled.
 *   3. Fallback: key the actor by the called number → digest suppressed
 *      (log-only).
 */

export interface ResolvedCall {
  callId: string;
  agentId: string;
  digestEnabled: boolean;
  transcript: string;
}

export const DEFAULT_AGENT_KEY = "agentId";

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function payloadOf(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") return {};
  const data = (body as { data?: unknown }).data;
  if (data && typeof data === "object" && "payload" in (data as object)) {
    const p = (data as { payload?: unknown }).payload;
    if (p && typeof p === "object") return p as Record<string, unknown>;
  }
  if (data && typeof data === "object") return data as Record<string, unknown>;
  return body as Record<string, unknown>;
}

function callerNumber(payload: Record<string, unknown>): string {
  const cc = payload["call_control"] as Record<string, unknown> | undefined;
  const from = cc?.["from"] as { phone_number?: unknown } | undefined;
  return str(from?.phone_number) || str(payload["from_number"]) || "";
}

/**
 * Resolve the call identity from a webhook (or synthetic demo) body.
 * Returns `null` when no transcript is present — the caller must NOT
 * score the call (no false zero); the `transcription-saved` fallback
 * delivers the transcript later.
 */
export function resolveCall(
  body: unknown,
  agentKey: string = DEFAULT_AGENT_KEY,
  numberMap: Record<string, string> | null = null,
): ResolvedCall | null {
  const payload = payloadOf(body);
  const transcript = str(payload["transcript"]);
  if (!transcript) return null;

  const callId =
    str(payload["call_control_id"]) ||
    str((payload["call_control"] as Record<string, unknown> | undefined)?.["id"]) ||
    str(payload["call_id"]) ||
    "";

  const key = agentKey || DEFAULT_AGENT_KEY;
  const metadata = payload["metadata"] as Record<string, unknown> | undefined;
  const fromMetadata = str(metadata?.[key]);

  if (fromMetadata) {
    return { callId, agentId: fromMetadata, digestEnabled: true, transcript };
  }

  const called = str(payload["called_number"]);
  const caller = callerNumber(payload);
  const mapped = numberMap ? numberMap[called] || numberMap[caller] || "" : "";
  if (mapped) {
    return { callId, agentId: mapped, digestEnabled: true, transcript };
  }

  // Fallback: key by the called number; digest suppressed (log-only).
  return {
    callId,
    agentId: called || caller || "unknown",
    digestEnabled: false,
    transcript,
  };
}
