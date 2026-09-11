/**
 * Minimal parser for the data-only SSE bodies Telnyx Inference returns when
 * `createCompletion` is called with `stream: true`.
 *
 * The telnyx Node SDK types the response as an open record and does NOT parse
 * streaming bodies — with `stream: true` the `APIPromise` resolves to the raw
 * SSE text (`data: {...}\\n\\n ... \\n\\ndata: [DONE]`). This module turns that
 * text into typed chunk deltas without `as any`.
 */

/** One `delta.tool_calls[]` entry as it arrives on the wire (partial). */
export interface WireToolCallDelta {
  index?: number;
  id?: string | null;
  type?: string;
  function?: { name?: string | null; arguments?: string | null };
}

export interface StreamedChunk {
  /** Assistant text delta (null on tool-call or reasoning-only chunks). */
  content: string | null;
  /** Partial tool-call deltas (OpenAI-style, arguments streamed in pieces). */
  toolCalls: WireToolCallDelta[];
  /** Set on the final chunk of a choice: `stop`, `tool_calls`, `length`, ... */
  finishReason: string | null;
}

interface WireChunkShape {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: WireToolCallDelta[] | null;
    } | null;
    finish_reason?: string | null;
  }>;
}

/**
 * Parse the raw SSE text into chunks. Each `data: <json>` line is one
 * OpenAI-style `chat.completion.chunk`; `data: terminates the stream.
 * Non-JSON payloads (keep-alives, comments) are skipped.
 */
export function parseStreamedSse(raw: unknown): StreamedChunk[] {
  if (typeof raw !== "string") {
    throw new Error(
      `Expected the raw SSE body (string) from createCompletion(stream: true), got ${typeof raw}.`,
    );
  }
  const chunks: StreamedChunk[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice("data:".length).trim();
    if (!payload || payload === "[DONE]") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue; // keep-alive or comment — not a data frame
    }
    if (typeof parsed !== "object" || parsed === null || !("choices" in parsed)) continue;
    const wire = parsed as WireChunkShape;
    const choice = wire.choices?.[0];
    if (!choice) continue;
    chunks.push({
      content: choice.delta?.content ?? null,
      toolCalls: choice.delta?.tool_calls ?? [],
      finishReason: choice.finish_reason ?? null,
    });
  }
  return chunks;
}
