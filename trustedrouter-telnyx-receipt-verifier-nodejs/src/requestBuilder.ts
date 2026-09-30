/**
 * Builds the exact request body TrustedRouter receives.
 *
 * The routing object is fixed by this application and can never be weakened
 * by client input: the request is constrained to Telnyx-only routes, the
 * route must satisfy the provider-level zero-data-retention floor, and
 * fallback to any other provider is disabled (a hard 400 from TrustedRouter
 * when nothing matches, never a silent downgrade).
 */
export const TELNYX_ONLY_ROUTING = {
  only: ["telnyx"],
  min_privacy: "zdr",
  allow_fallbacks: false,
} as const;

export const SYSTEM_PROMPT = "Answer clearly and concisely.";

export interface ChatCompletionsRequest {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  max_tokens: number;
  stream: false;
  provider: typeof TELNYX_ONLY_ROUTING;
}

export interface BuiltRequest {
  /** The plain object, useful for logging-safe summaries. */
  bodyObject: ChatCompletionsRequest;
  /**
   * The exact bytes that are sent upstream. Serialize exactly once and
   * preserve this value: receipt verification hashes these bytes.
   */
  bodyBytes: Buffer;
}

export function buildChatRequest(
  model: string,
  prompt: string,
  maxTokens: number
): BuiltRequest {
  const bodyObject: ChatCompletionsRequest = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    max_tokens: maxTokens,
    stream: false,
    provider: { ...TELNYX_ONLY_ROUTING },
  };
  const bodyBytes = Buffer.from(JSON.stringify(bodyObject), "utf8");
  return { bodyObject, bodyBytes };
}
