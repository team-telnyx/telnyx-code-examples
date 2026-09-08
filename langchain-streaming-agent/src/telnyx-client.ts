/**
 * Typed seam for the TELNYX Inference binding surface this sample uses.
 *
 * On Edge Compute the binding is generated (`telnyx-edge types`) and typed as
 * the full `telnyx` client. The sample only calls one endpoint —
 * `ai.openai.chat.createCompletion` — whose response the SDK types as an open
 * record (and returns the RAW SSE text when `stream: true`). This interface
 * narrows exactly that surface without `any`.
 */

export interface InferenceToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface InferenceMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Required by OpenAI-compatible APIs on `role: "tool"` turns. */
  tool_call_id?: string;
  name?: string;
  /** Required on assistant turns that requested tool calls. */
  tool_calls?: InferenceToolCall[];
}

export interface InferenceToolSpec {
  type: "function";
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
}

export interface InferenceCompletionParams {
  model?: string;
  messages: InferenceMessage[];
  /** Raw data-only SSE body comes back as a string (parsed in sse.ts). */
  stream?: boolean;
  tools?: InferenceToolSpec[];
  tool_choice?: "none" | "auto" | "required";
  temperature?: number;
  max_tokens?: number;
}

/** Raw SSE text on stream; parsed JSON object otherwise. */
export type InferenceCompletionResult = string | Record<string, unknown>;

export interface TelnyxInferenceClient {
  ai: {
    openai: {
      chat: {
        createCompletion(
          params: InferenceCompletionParams,
        ): Promise<InferenceCompletionResult>;
      };
    };
  };
}
