/**
 * Smoke test for show-wrap-desk.
 *
 * Verifies the module loads, the WrapDesk actor exposes the pipeline
 * methods, the pure chaptering helpers behave, and the HTTP routes wire
 * every call to the `show:<name>` actor the spec requires.
 *
 * Run with: npx tsx smoke_test.ts
 */

import {
  WrapDesk,
  default as handler,
  deskName,
  buildTurns,
  splitIntoChapters,
  stripCodeFence,
  parseJsonArrayTitles,
  base64ByteLength,
  flattenWords,
  transcriptText,
  CHAPTER_GAP_S,
  STT_MODEL,
} from "./src/index";
import type { Env } from "./src/index";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  console.log(`ok - ${message}`);
}

interface RecordedCall {
  actorName: string;
  method: string;
  args: unknown[];
}

function makeFakeEnv(): { env: Env; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let currentName = "";
  const stub = {
    onWrap: async (show: string, audioUrl: string) => {
      calls.push({ actorName: currentName, method: "onWrap", args: [show, audioUrl] });
      return { episodeId: "ep-1", status: "transcribing" as const, resumed: false };
    },
    wrapstatus: async (episodeId: string) => {
      calls.push({ actorName: currentName, method: "wrapstatus", args: [episodeId] });
      return {
        status: "wrapped" as const,
        chapters: [{ title: "Chapter 1", start: 0, end: 10 }],
        notesPreview: "lorem",
        trailerBytes: 12,
        episodes: [{ ep_id: "ep-1", audio_url: "x", status: "wrapped" as const, created_at: "t", wrapped_at: "t" }],
      };
    },
  };
  const env = {
    DESKS: {
      idFromName: (name: string) => {
        currentName = name;
        calls.push({ actorName: name, method: "idFromName", args: [] });
        return stub;
      },
    },
    TELNYX: {},
    TELNYX_API_KEY: "",
    AI_MODEL: "",
    EPISODE_URL: "https://example.com/episode.mp3",
    HOST_VOICE: "",
  } as unknown as Env;
  return { env, calls };
}

async function runSmokeTest(): Promise<void> {
  // ── Actor surface ────────────────────────────────────────────────────────
  assert(typeof WrapDesk === "function", "WrapDesk class is exported");
  const proto = WrapDesk.prototype as Record<string, unknown>;
  assert(typeof proto.onWrap === "function", "onWrap method exists");
  assert(typeof proto.wrapTick === "function", "wrapTick method exists");
  assert(typeof proto.wrapstatus === "function", "wrapstatus method exists");
  assert(typeof handler?.fetch === "function", "default export has a fetch handler");

  assert(deskName("tok-podcast") === "show:tok-podcast", "actor name is show:<show>");

  // ── Chaptering helpers ───────────────────────────────────────────────────
  const turns = buildTurns([
    { word: "hello", start: 0, end: 1, confidence: 0.9, speaker: "0" },
    { word: "world", start: 1, end: 2, confidence: 0.9, speaker: "0" },
    { word: "hi", start: 2, end: 3, confidence: 0.9, speaker: "1" },
    { word: "back", start: 3, end: 4, confidence: 0.9, speaker: "0" },
  ]);
  assert(turns.length === 3, `buildTurns groups same-speaker words (got ${turns.length})`);
  assert(turns[0].text === "hello world", "turn text joins words");
  assert(turns[1].speaker === "1", "turn speaker follows the words");

  const longGap = splitIntoChapters(turns, CHAPTER_GAP_S);
  assert(longGap.length === 1, "turns without gaps between them collapse into one chapter");
  const closeTurns: typeof turns = [
    { speaker: "0", start: 0, end: 10, text: "a" },
    { speaker: "1", start: 30, end: 40, text: "b" },
    { speaker: "0", start: 120, end: 130, text: "c" },
  ];
  const twoChapters = splitIntoChapters(closeTurns, CHAPTER_GAP_S);
  assert(twoChapters.length === 2, "the 80s gap splits; the 20s gap merges (got " + twoChapters.length + ")");
  assert(
    twoChapters[0].start === 0 && twoChapters[0].end === 40 && twoChapters[1].start === 120,
    "chapter boundaries span their turns"
  );

  // ── LLM response parsing ─────────────────────────────────────────────────
  assert(stripCodeFence('```json\n["a"]\n```') === '["a"]', "stripCodeFence removes a json fence");
  assert(stripCodeFence("plain") === "plain", "stripCodeFence leaves plain text alone");
  assert(
    JSON.stringify(parseJsonArrayTitles('```json\n["Alpha","Beta"]\n```', 2)) ===
      JSON.stringify(["Alpha", "Beta"]),
    "parseJsonArrayTitles reads a fenced JSON array"
  );
  assert(
    JSON.stringify(parseJsonArrayTitles('["Only one"]', 2)) ===
      JSON.stringify(["Only one", "Chapter 2"]),
    "parseJsonArrayTitles pads a short array"
  );
  assert(
    JSON.stringify(parseJsonArrayTitles("not json at all", 2)) ===
      JSON.stringify(["Chapter 1", "Chapter 2"]),
    "parseJsonArrayTitles falls back on garbage"
  );

  // ── Word flattening (the verified verbose_json shape) ────────────────────
  const words = flattenWords({
    segments: [
      { words: [{ word: "sonnet", start: 5.68, end: 6.24, confidence: 0.98, speaker: 0 }] },
      { words: [{ word: "one", start: 6.3, end: 6.5, confidence: 0.99, speaker: 1 }] },
    ],
  });
  assert(words.length === 2, "flattenWords collects words across segments");
  assert(words[0].speaker === "0" && words[1].speaker === "1", "speakers normalize to strings");
  assert(transcriptText(words) === "sonnet one", "transcriptText joins the words");
  assert(flattenWords({}).length === 0, "flattenWords tolerates a missing segments array");

  // ── Trailer bookkeeping ──────────────────────────────────────────────────
  assert(base64ByteLength("AAAA") === 3, "base64ByteLength counts a full group");
  assert(base64ByteLength("AA==") === 1, "base64ByteLength counts padding");
  assert(base64ByteLength("") === 0, "base64ByteLength of empty is zero");
  assert(STT_MODEL === "deepgram/nova-3", "the transcription model is deepgram/nova-3");

  // ── HTTP surface wiring ──────────────────────────────────────────────────
  const notFound = await handler.fetch(new Request("https://x.example/unknown", { method: "GET" }), makeFakeEnv().env);
  assert(notFound.status === 404, "unknown route returns 404");

  const missing = await handler.fetch(
    new Request("https://x.example/wrap", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    }),
    makeFakeEnv().env
  );
  assert(missing.status === 400, "/wrap without show/audioUrl returns 400");

  const missingStatus = await handler.fetch(
    new Request("https://x.example/wrapstatus/ep-1", { method: "GET" }),
    makeFakeEnv().env
  );
  assert(missingStatus.status === 400, "/wrapstatus without show returns 400");

  const liveness = await handler.fetch(new Request("https://x.example/health/liveness", { method: "GET" }), makeFakeEnv().env);
  assert(liveness.status === 200, "/health/liveness returns 200");

  const { env, calls } = makeFakeEnv();
  const wrapResp = await handler.fetch(
    new Request("https://x.example/wrap", {
      method: "POST",
      body: JSON.stringify({ show: "tok-podcast", audioUrl: "https://example.com/episode.mp3" }),
      headers: { "Content-Type": "application/json" },
    }),
    env
  );
  assert(wrapResp.status === 202, "/wrap returns 202");
  const wrapBody = (await wrapResp.json()) as { episodeId: string; status: string };
  assert(wrapBody.episodeId === "ep-1" && wrapBody.status === "transcribing", "/wrap returns the episode ledger stub");
  assert(
    calls.some((c) => c.method === "idFromName" && c.actorName === "show:tok-podcast"),
    "POST /wrap addresses the show:tok-podcast actor"
  );
  assert(calls.some((c) => c.method === "onWrap"), "POST /wrap calls onWrap on that actor");

  const statusResp = await handler.fetch(
    new Request("https://x.example/wrapstatus/ep-1?show=tok-podcast", { method: "GET" }),
    env
  );
  assert(statusResp.status === 200, "/wrapstatus returns 200");
  const statusBody = (await statusResp.json()) as { status: string; episodes: unknown[] };
  assert(statusBody.status === "wrapped", "/wrapstatus returns the ledger row");
  assert(Array.isArray(statusBody.episodes), "/wrapstatus includes the desk's episode ledger");
  assert(
    calls.filter((c) => c.method === "idFromName" && c.actorName === "show:tok-podcast").length === 2,
    "POST /wrap and GET /wrapstatus both address the same show:tok-podcast actor"
  );

  console.log("\nAll smoke tests passed.");
}

runSmokeTest().catch((err: unknown) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
