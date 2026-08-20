/// <reference types="@telnyx/edge-runtime" />

declare global {
  interface KvNamespace {
    get(key: string, options?: { type?: "text" | "json" }): Promise<string | null>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
    delete(key: string): Promise<void>;
    list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
      keys: { name: string; expiration?: number; metadata?: unknown }[];
      list_complete: boolean;
      cursor: string;
    }>;
  }
}

export {};
