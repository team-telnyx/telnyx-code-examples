import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import type { ToolCallChunk } from "@langchain/core/messages/tool";
import { parseStreamedSse, type WireToolCallDelta } from "./sse.js";
import type { TelnyxInferenceClient, InferenceMessage, InferenceToolCall } from "./telnyx-client.js";
import type { Env } from "./types.js";

export interface TelnyxStreamingChatModelFields {
  env: Env;
  /** Telnyx Inference model id (e.g. `zai-org/GLM-5.2`). */
  model: string;
  temperature?: number;
  maxTokens?: number;
  /** OpenAI-schema tools injected by `bindTools` (immutable rebinding). */
  boundTools?: ReturnType<typeof convertToOpenAITool>[];
  /**
   * Fires for every answer-text SSE delta, in wire order — including inside
   * `invoke()` (the executor's path). Awaited by the stream, so consumers can
   * preserve ordering across async work.
   */
  onToken?: (text: string) => Promise<void> | void;
}

function roleForMessage(message: BaseMessage): InferenceMessage["role"] {
  const type = message._getType();
  if (type === "human") return "user";
  if (type === "system") return "system";
  if (type === "ai") return "assistant";
  if (type === "tool") return "tool";
  return "user";
}

function contentToString(content: BaseMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text: string }).text);
        }
        return "";
      })
      .join("");
  }
  return String(content ?? "");
}

/** Merge partial tool-call chunks (arguments arrive in pieces, by index). */
function mergeToolCallChunks(chunks: ToolCallChunk[]): InferenceToolCall[] {
  const byIndex = new Map<number, { id?: string; name?: string; arguments: string }>();
  for (const chunk of chunks) {
    const index = chunk.index ?? 0;
    const entry = byIndex.get(index) ?? { arguments: "" };
    if (chunk.id) entry.id = chunk.id;
    if (chunk.name) entry.name = chunk.name;
    if (chunk.args) entry.arguments += chunk.args;
    byIndex.set(index, entry);
  }
  return [...byIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, call]) => ({
      id: call.id ?? "",
      type: "function" as const,
      function: { name: call.name ?? "", arguments: call.arguments },
    }));
}

/**
 * Wire mapping. Tool round-trips must round-trip the call linkage:
 * assistant turns carry `tool_calls`, tool turns carry `tool_call_id` —
 * OpenAI-compatible APIs reject tool turns without the id.
 */
function toWireMessage(message: BaseMessage): InferenceMessage {
  if (message instanceof ToolMessage) {
    return {
      role: "tool",
      content: contentToString(message.content),
      tool_call_id: message.tool_call_id,
      ...(message.name ? { name: message.name } : {}),
    };
  }

  const toolCalls = collectToolCalls(message);
  if (toolCalls.length > 0) {
    // AIMessageChunk does NOT extend AIMessage in @langchain/core, so the
    // gate is on the collected calls (chunks carry the scratchpad turns).
    return {
      role: "assistant",
      content: contentToString(message.content),
      tool_calls: toolCalls,
    };
  }
  return { role: roleForMessage(message), content: contentToString(message.content) };
}

/**
 * Assistant tool calls from any of the three shapes LangChain produces:
 * parsed `tool_calls` on messages, streaming `tool_call_chunks` on chunks,
 * or the raw OpenAI-format `additional_kwargs.tool_calls` the agent
 * scratchpad rebuilds turns from between tool rounds.
 */
function collectToolCalls(message: BaseMessage): InferenceToolCall[] {
  if (message instanceof AIMessage && message.tool_calls && message.tool_calls.length > 0) {
    return message.tool_calls.map((call) => ({
      id: call.id ?? "",
      type: "function" as const,
      function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
    }));
  }
  if (message instanceof AIMessageChunk && message.tool_call_chunks?.length) {
    return mergeToolCallChunks(message.tool_call_chunks);
  }
  const raw: unknown = message.additional_kwargs?.tool_calls;
  if (!Array.isArray(raw)) return [];
  const calls: InferenceToolCall[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const fn = (entry as { function?: { name?: unknown; arguments?: unknown } }).function;
    if (typeof fn?.name !== "string" || !fn.name) continue;
    calls.push({
      id: typeof (entry as { id?: unknown }).id === "string" ? (entry as { id: string }).id : "",
      type: "function",
      function: {
        name: fn.name,
        arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
      },
    });
  }
  return calls;
}

/** Merge OpenAI-style tool-call deltas (arguments arrive in pieces, by index). */
function toToolCallChunks(deltas: WireToolCallDelta[]): ToolCallChunk[] {
  return deltas.map((delta, i) => ({
    name: delta.function?.name ?? undefined,
    args: delta.function?.arguments ?? undefined,
    id: delta.id ?? undefined,
    index: delta.index ?? i,
    type: "tool_call_chunk" as const,
  }));
}

/**
 * A LangChain `BaseChatModel` whose every token comes from the Telnyx
 * Inference binding — `env.TELNYX.ai.openai.chat.createCompletion()` — with
 * `stream: true`. No OpenAI key, no extra credential: the binding is
 * pre-authenticated by Telnyx Edge Compute (zero-credential inference).
 *
 * - `_streamResponseChunks` yields real `AIMessageChunk`s per SSE delta
 *   (text now, later tool-call pieces as `tool_call_chunks`).
 * - `_generate` accumulates the same stream into a single `AIMessage` with
 *   parsed `tool_calls`, so `invoke()` and `stream()` stay consistent.
 * - `bindTools()` returns a rebound clone that forwards OpenAI-schema tools
 *   to the wire — enough for `createToolCallingAgent`.
 *
 * Reasoning-model deltas (`delta.reasoning_content` on GLM/QwQ family
 * models) are ignored: only committed answer tokens are streamed.
 */
export class TelnyxStreamingChatModel extends BaseChatModel {
  readonly env: Env;
  readonly model: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  private readonly boundTools: TelnyxStreamingChatModelFields["boundTools"];
  private readonly onToken?: TelnyxStreamingChatModelFields["onToken"];

  constructor(fields: TelnyxStreamingChatModelFields) {
    super({});
    this.env = fields.env;
    this.model = fields.model;
    this.temperature = fields.temperature;
    this.maxTokens = fields.maxTokens;
    this.boundTools = fields.boundTools;
    this.onToken = fields.onToken;
  }

  _llmType(): string {
    return "telnyx-streaming";
  }

  /** LangChain binding hook — returns a clone carrying the OpenAI-schema tools. */
  override bindTools(
    tools: Parameters<typeof convertToOpenAITool>[0][],
  ): TelnyxStreamingChatModel {
    const mapped = tools.map((tool) => convertToOpenAITool(tool));
    return new TelnyxStreamingChatModel({
      env: this.env,
      model: this.model,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      boundTools: [...(this.boundTools ?? []), ...mapped],
      onToken: this.onToken,
    });
  }

  /** Shared internal stream: one SSE round-trip → typed chunks. */
  private async *streamDeltas(
    messages: BaseMessage[],
  ): AsyncGenerator<{ text: string; toolCallChunks: ToolCallChunk[] }> {
    const mapped = messages.map(toWireMessage);

    const client = this.env.TELNYX as TelnyxInferenceClient;
    const raw = await client.ai.openai.chat.createCompletion({
      model: this.model,
      messages: mapped,
      stream: true,
      ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
      ...(this.maxTokens !== undefined ? { max_tokens: this.maxTokens } : {}),
      ...(this.boundTools && this.boundTools.length > 0
        ? { tools: this.boundTools, tool_choice: "auto" as const }
        : {}),
    });

    for (const chunk of parseStreamedSse(raw)) {
      yield {
        text: chunk.content ?? "",
        toolCallChunks: toToolCallChunks(chunk.toolCalls),
      };
    }
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
  ): AsyncGenerator<ChatGenerationChunk> {
    for await (const delta of this.streamDeltas(messages)) {
      if (!delta.text && delta.toolCallChunks.length === 0) continue;
      if (delta.text && this.onToken) await this.onToken(delta.text);
      const chunk = new AIMessageChunk({
        content: delta.text,
        ...(delta.toolCallChunks.length > 0 ? { tool_call_chunks: delta.toolCallChunks } : {}),
      });
      yield new ChatGenerationChunk({ message: chunk, text: delta.text });
    }
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    let aggregated: AIMessageChunk | undefined;
    for await (const generation of this._streamResponseChunks(messages)) {
      const piece = generation.message as AIMessageChunk;
      aggregated = aggregated ? aggregated.concat(piece) : piece;
    }
    const message = new AIMessage({
      content: typeof aggregated?.content === "string" ? aggregated.content : "",
      tool_calls: aggregated?.tool_calls ?? [],
      additional_kwargs: aggregated?.additional_kwargs ?? {},
    });
    return {
      generations: [
        {
          text: typeof message.content === "string" ? message.content : "",
          message,
        },
      ],
    };
  }

  /** Abstract base contract: text of the first (and only) generation. */
  async _call(messages: BaseMessage[]): Promise<string> {
    const result = await this._generate(messages);
    const text = result.generations[0]?.text;
    if (!text) {
      throw new Error(
        `TelnyxStreamingChatModel: createCompletion returned no content for model ${this.model}`,
      );
    }
    return text;
  }
}
