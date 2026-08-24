import { SimpleChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import type { TelnyxEdgeClient, Env } from "./types.js";

function telnyx(env: Env): TelnyxEdgeClient {
  return env.TELNYX as unknown as TelnyxEdgeClient;
}

function roleForMessage(message: BaseMessage): string {
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

export interface TelnyxBoundChatModelOptions {
  env: Env;
  model: string;
}

export class TelnyxBoundChatModel extends SimpleChatModel {
  declare env: Env;
  declare model: string;

  constructor(opts: TelnyxBoundChatModelOptions) {
    super({});
    this.env = opts.env;
    this.model = opts.model;
  }

  async _call(messages: BaseMessage[]): Promise<string> {
    const mapped = messages.map((m) => ({
      role: roleForMessage(m),
      content: contentToString(m.content),
    }));

    const res = await telnyx(this.env).ai.openai.chat.createCompletion({
      model: this.model,
      messages: mapped,
    });

    const content = res.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(
        `TelnyxBoundChatModel: createCompletion returned no content for model ${this.model}`,
      );
    }
    return content;
  }

  _llmType(): string {
    return "telnyx-bound";
  }
}
