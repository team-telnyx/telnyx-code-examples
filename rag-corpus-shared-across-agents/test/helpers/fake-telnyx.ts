/**
 * Deterministic fake of the TELNYX binding for tests.
 *
 * Embeddings: bag-of-words hashing into a fixed-size unit vector — texts
 * sharing tokens get positive cosine similarity, so ranking behaves like a
 * real embedding model without network calls.
 * Chat: returns a scripted reply and records every call for assertions.
 */

export const FAKE_EMBEDDING_DIMS = 64;

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

export function hashEmbedding(text: string): number[] {
  const vector = new Array<number>(FAKE_EMBEDDING_DIMS).fill(0);
  for (const token of tokenize(text)) {
    vector[hashToken(token) % FAKE_EMBEDDING_DIMS] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, n) => sum + n * n, 0));
  return norm === 0 ? vector : vector.map((n) => n / norm);
}

export interface RecordedChatCall {
  model: string;
  messages: Array<{ role: string; content: string }>;
}

export interface FakeTelnyxOptions {
  chatReply?: string;
}

export class FakeTelnyx {
  readonly embeddingCalls: Array<{ model: string; input: string[] }> = [];
  readonly chatCalls: RecordedChatCall[] = [];
  chatReply: string;

  constructor(options: FakeTelnyxOptions = {}) {
    this.chatReply = options.chatReply ?? "Grounded answer from the shared corpus.";
  }

  readonly ai = {
    openai: {
      embeddings: {
        createEmbeddings: async (params: { model: string; input: string | string[] }) => {
          const input = Array.isArray(params.input) ? params.input : [params.input];
          this.embeddingCalls.push({ model: params.model, input });
          return {
            object: "list",
            model: params.model,
            data: input.map((text, index) => ({
              object: "embedding",
              index,
              embedding: hashEmbedding(text),
            })),
            usage: { prompt_tokens: 0, total_tokens: 0 },
          };
        },
      },
      chat: {
        createCompletion: async (params: {
          model: string;
          messages: Array<{ role: string; content: string }>;
        }) => {
          this.chatCalls.push({ model: params.model, messages: params.messages });
          return { choices: [{ message: { content: this.chatReply } }] };
        },
      },
    },
  };
}
