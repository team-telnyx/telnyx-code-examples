import { describe, expect, it } from "vitest";
import type { CloudStorageBucket, CloudStorageObject } from "@telnyx/edge-runtime";
import { CorpusAgent } from "../src/corpus-agent.js";
import { makeActorContext } from "./helpers/actor-test-kit.js";
import { FakeTelnyx } from "./helpers/fake-telnyx.js";
import type { Env } from "../src/types.js";

/** In-memory bucket stand-in mirroring the CloudStorageBucket surface. */
function makeFakeBucket(files: Record<string, string>): CloudStorageBucket {
  const objectMeta = (key: string): CloudStorageObject => ({ key, writeHttpMetadata: () => {} });
  return {
    async get(key: string) {
      const text = files[key];
      return text === undefined
        ? null
        : {
            ...objectMeta(key),
            body: null as unknown as ReadableStream,
            bodyUsed: false,
            arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
            text: async () => text,
            json: async () => JSON.parse(text) as unknown,
            blob: async () => new Blob([text]),
          };
    },
    async head(key: string) {
      return key in files ? objectMeta(key) : null;
    },
    async put() {
      throw new Error("not needed in tests");
    },
    async delete() {},
    async list(options?: { prefix?: string }) {
      const prefix = options?.prefix ?? "";
      return {
        objects: Object.keys(files)
          .filter((k) => k.startsWith(prefix))
          .map(objectMeta),
        delimitedPrefixes: [],
        truncated: false,
      };
    },
    createMultipartUpload: () => {
      throw new Error("not needed in tests");
    },
    resumeMultipartUpload: () => {
      throw new Error("not needed in tests");
    },
  } as unknown as CloudStorageBucket;
}

function makeCorpus(
  files: Record<string, string> = {},
  envOverrides: Partial<Pick<Env, "CHUNK_SIZE" | "CHUNK_OVERLAP">> = {},
): { corpus: CorpusAgent; fake: FakeTelnyx } {
  const fake = new FakeTelnyx();
  const env = {
    CORPUS: {},
    PERSONAS: {},
    TELNYX: fake,
    KNOWLEDGE: makeFakeBucket(files),
    ...envOverrides,
  } as unknown as Env;
  return { corpus: new CorpusAgent(makeActorContext("corpus_test"), env), fake };
}

describe("CorpusAgent", () => {
  it("starts with an empty corpus", async () => {
    const { corpus } = makeCorpus();
    expect(await corpus.stats()).toEqual({ docs: [], chunkCount: 0, lastIngestedAt: 0 });
  });

  it("ingests a document and reports stats", async () => {
    const { corpus } = makeCorpus({}, { CHUNK_SIZE: "150" });
    const result = await corpus.ingest(
      "knowledge/guide.txt",
      "SIP trunk setup with the domain and credentials from the portal, including the outbound proxy configuration for production carriers.\n\n" +
        "Number provisioning happens separately: order numbers first, then assign them to the trunk connection profile.",
    );
    expect(result).toEqual({ doc: "knowledge/guide.txt", chunks: 2 });
    const stats = await corpus.stats();
    expect(stats.docs).toEqual(["knowledge/guide.txt"]);
    expect(stats.chunkCount).toBe(2);
    expect(stats.lastIngestedAt).toBeGreaterThan(0);
  });

  it("re-ingesting a document replaces its chunks instead of duplicating", async () => {
    const { corpus } = makeCorpus();
    await corpus.ingest("doc.txt", "first version\n\nsecond paragraph");
    await corpus.ingest("doc.txt", "replacement text only");
    const stats = await corpus.stats();
    expect(stats.chunkCount).toBe(1);
    expect(stats.docs).toEqual(["doc.txt"]);
  });

  it("search ranks the most similar chunk first", async () => {
    const { corpus } = makeCorpus();
    await corpus.ingest(
      "sip.txt",
      "Configure the SIP trunk with the domain and credentials from the portal.\n\n" +
        "Bananas are a good source of potassium for breakfast.",
    );
    const hits = await corpus.search("how do I configure my SIP trunk?", 1);
    expect(hits).toHaveLength(1);
    expect(hits[0].doc).toBe("sip.txt");
    expect(hits[0].text).toContain("SIP trunk");
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it("search respects the requested limit", async () => {
    const { corpus } = makeCorpus();
    await corpus.ingest("alpha.txt", "alpha topic");
    await corpus.ingest("beta.txt", "beta topic");
    await corpus.ingest("gamma.txt", "gamma topic");
    await corpus.ingest("delta.txt", "delta topic");
    const hits = await corpus.search("alpha", 2);
    expect(hits).toHaveLength(2);
    expect(hits[0].doc).toBe("alpha.txt");
  });

  it("search returns nothing for a blank query", async () => {
    const { corpus } = makeCorpus();
    await corpus.ingest("doc.txt", "some text");
    expect(await corpus.search("   ")).toEqual([]);
  });

  it("reset drops every chunk", async () => {
    const { corpus } = makeCorpus();
    await corpus.ingest("doc.txt", "hello world\n\nmore text");
    await corpus.reset();
    expect(await corpus.stats()).toEqual({ docs: [], chunkCount: 0, lastIngestedAt: 0 });
    expect(await corpus.search("hello")).toEqual([]);
  });

  it("ingestBucket reads every object under the bucket prefix", async () => {
    const { corpus, fake } = makeCorpus({
      "knowledge/api-keys.txt": "Create keys in the portal.\n\nRotate keys quarterly.",
      "knowledge/rate-limits.txt": "60 requests per minute per key.",
      "other/ignored.txt": "should not be ingested",
    });
    const results = await corpus.ingestBucket();
    expect(results.map((r) => r.doc).sort()).toEqual([
      "knowledge/api-keys.txt",
      "knowledge/rate-limits.txt",
    ]);
    expect(fake.embeddingCalls.length).toBe(2);
    const stats = await corpus.stats();
    expect(stats.docs.sort()).toEqual(["knowledge/api-keys.txt", "knowledge/rate-limits.txt"]);
  });

  it("embeds through the TELNYX binding with the configured model", async () => {
    const { corpus, fake } = makeCorpus();
    await corpus.ingest("doc.txt", "hello world");
    expect(fake.embeddingCalls).toHaveLength(1);
    expect(fake.embeddingCalls[0].model).toBe("thenlper/gte-large");
    expect(fake.embeddingCalls[0].input).toEqual(["hello world"]);
  });
});
