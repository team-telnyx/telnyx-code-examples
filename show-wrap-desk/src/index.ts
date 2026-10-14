/**
 * show-wrap-desk — the actor IS a podcast producer's wrap desk.
 *
 * Drop the raw episode recording; the desk cuts the tape (speaker-labeled
 * transcription via deepgram/nova-3), marks the chapters (topic boundaries
 * from word timestamps), writes the liner notes (SEO show notes), and cuts a
 * 30-second trailer in the host's own voice via the TTS WebSocket.
 *
 * One durable entity per show keeps the episode ledger, survives a crash
 * mid-wrap, and redoes nothing twice:
 *  - every stage is idempotent (each checks its asset/chapter rows first),
 *  - the wrap task is scheduled by the stable id `wrap:<epId>` (upserted, not
 *    duplicated) so a kill mid-stage resumes at exactly the unfinished stage,
 *  - the episode ledger lives in the agent's own SQL — zero external state.
 *
 * The pipeline walks `transcribing` -> `chapterizing` -> `notes` (notes are
 * written, then the trailer is cut and stored) -> `wrapped`.
 */

import {
  Agent,
  rpc,
  type ActorNamespace,
  type ActorStub,
  type IdFromNameOptions,
} from "@telnyx/edge-runtime";

// Minimal ambient declaration so the example compiles without @types/node.
declare const process: { env: Record<string, string | undefined> };

/** A word from the transcription response, with per-word speaker labels. */
export interface TranscriptionWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  speaker: string;
}

/** A speaker turn: consecutive words from the same speaker. */
export interface SpeakerTurn {
  speaker: string;
  start: number;
  end: number;
  text: string;
}

/** A chapter: a group of turns split at silences longer than CHAPTER_GAP_S. */
export interface ChapterSpan {
  start: number;
  end: number;
  words: string[];
}

export type EpisodeStatus = "transcribing" | "chapterizing" | "notes" | "wrapped";

export interface EpisodeLedger {
  audioUrl: string;
  status: EpisodeStatus;
  error?: string;
}

/** Object-literal type alias so it satisfies `Record<string, unknown>`. */
export type WrapState = {
  episodes: Record<string, EpisodeLedger>;
};

export interface WrapStatus {
  status: EpisodeStatus;
  error?: string;
  chapters: Array<{ title: string; start: number; end: number }>;
  notesPreview: string;
  trailerBytes: number;
  episodes: Array<{
    ep_id: string;
    audio_url: string;
    status: EpisodeStatus;
    created_at: string;
    wrapped_at: string | null;
  }>;
}

interface TelnyxBinding {
  ai: {
    openai: {
      chat: {
        createCompletion(params: {
          model: string;
          messages: Array<{ role: string; content: string }>;
          max_tokens?: number;
          temperature?: number;
        }): Promise<{ choices: Array<{ message: { content: string } }> }>;
      };
    };
  };
}

type WrapDeskStub = ActorStub & Pick<WrapDesk, "onWrap" | "wrapTick" | "wrapstatus">;

interface DeskNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): WrapDeskStub;
}

interface Env {
  DESKS: DeskNamespace;
  TELNYX: TelnyxBinding;
  TELNYX_API_KEY: string;
  AI_MODEL: string;
  EPISODE_URL: string;
  HOST_VOICE: string;
}

export const TELNYX_API = "https://api.telnyx.com/v2";
export const TTS_WS_URL = "wss://api.telnyx.com/v2/text-to-speech/speech";
export const STT_MODEL = "deepgram/nova-3";
export const DEFAULT_AI_MODEL = "zai-org/GLM-5.3-Flash";
export const DEFAULT_HOST_VOICE = "azure.en-US-AvaMultilingualNeural";
/** Silences longer than this (seconds) split the transcript into chapters. */
export const CHAPTER_GAP_S = 60;
/** Trailer length cap, in characters, before the TTS stage. */
export const TRAILER_MAX_CHARS = 400;

/** Minimal WebSocket surface used by the trailer cutter. */
interface TtsSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: unknown) => void): void;
  readyState: number;
}

type TtsSocketFactory = (url: string) => TtsSocket;

// ── Pure helpers (exported for the smoke test) ──────────────────────────────

/** Group words into consecutive same-speaker turns. */
export function buildTurns(words: TranscriptionWord[]): SpeakerTurn[] {
  const turns: SpeakerTurn[] = [];
  let current: SpeakerTurn | null = null;
  for (const w of words) {
    const speaker = String(w.speaker);
    if (!current || current.speaker !== speaker) {
      if (current) turns.push(current);
      current = { speaker, start: w.start, end: w.end, text: w.word };
    } else {
      current.end = w.end;
      current.text += " " + w.word;
    }
  }
  if (current) turns.push(current);
  return turns;
}

/**
 * Collapse turns into chapters: a gap longer than `gapSeconds` between one
 * turn's end and the next turn's start starts a new chapter.
 */
export function splitIntoChapters(
  turns: SpeakerTurn[],
  gapSeconds: number
): ChapterSpan[] {
  const chapters: ChapterSpan[] = [];
  let current: ChapterSpan | null = null;
  for (const turn of turns) {
    if (!current) {
      current = { start: turn.start, end: turn.end, words: [turn.text] };
    } else if (turn.start - current.end > gapSeconds) {
      chapters.push(current);
      current = { start: turn.start, end: turn.end, words: [turn.text] };
    } else {
      current.end = turn.end;
      current.words.push(turn.text);
    }
  }
  if (current) chapters.push(current);
  return chapters;
}

/** Strip a ```json / ``` fence from an LLM response, if present. */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    const inner = trimmed.split("\n").slice(1).join("\n").replace(/```/g, "").trim();
    return inner;
  }
  return trimmed;
}

/** Parse an LLM response into a string array; returns per-chapter fallbacks on failure. */
export function parseJsonArrayTitles(content: string, chapterCount: number): string[] {
  const fallback = () => Array.from({ length: chapterCount }, (_, i) => `Chapter ${i + 1}`);
  try {
    const parsed: unknown = JSON.parse(stripCodeFence(content));
    if (!Array.isArray(parsed)) return fallback();
    const titles = parsed.map((t, i) => {
      const s = typeof t === "string" ? t.trim() : "";
      return s || `Chapter ${i + 1}`;
    });
    if (titles.length < chapterCount) {
      return [...titles, ...fallback().slice(titles.length)];
    }
    return titles.slice(0, chapterCount);
  } catch {
    return fallback();
  }
}

/** Decoded byte length of a base64 string, without decoding it. */
export function base64ByteLength(b64: string): number {
  if (!b64) return 0;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

/** Flatten a verbose_json response into the word array the desk stores. */
export function flattenWords(data: {
  segments?: Array<{ words?: Array<Record<string, unknown>> }>;
}): TranscriptionWord[] {
  const segments = Array.isArray(data?.segments) ? data.segments : [];
  const words: TranscriptionWord[] = [];
  for (const seg of segments) {
    for (const w of Array.isArray(seg?.words) ? seg.words : []) {
      if (typeof w?.word !== "string" || typeof w?.start !== "number") continue;
      words.push({
        word: w.word,
        start: w.start,
        end: typeof w.end === "number" ? w.end : w.start,
        confidence: typeof w.confidence === "number" ? w.confidence : 0,
        speaker: String(w.speaker ?? 0),
      });
    }
  }
  return words;
}

export function transcriptText(words: TranscriptionWord[]): string {
  return words.map((w) => w.word).join(" ");
}

/** Open a WebSocket, carrying auth headers when the client allows it. */
async function openTtsSocket(url: string, headers: Record<string, string>): Promise<TtsSocket> {
  const Global = (globalThis as { WebSocket?: new (url: string) => unknown }).WebSocket;
  if (!Global) throw new Error("this runtime does not expose a WebSocket client");
  if (Object.keys(headers).length === 0) return new Global(url) as TtsSocket;
  try {
    const { WebSocket: HeaderSocket } = await import("ws");
    return new HeaderSocket(url, { headers }) as unknown as TtsSocket;
  } catch {
    // Platform runtime without a module loader — its WebSocket may carry
    // credentials itself; otherwise the handshake will be refused and the
    // wrap tick will retry with backoff.
    return new Global(url) as TtsSocket;
  }
}

/**
 * Stream the trailer script over the TTS WebSocket and collect the base64
 * audio chunks until `isFinal: true`.
 */
async function synthesizeTrailerAudio(
  script: string,
  voice: string,
  apiKey: string
): Promise<string> {
  const url = `${TTS_WS_URL}?voice=${encodeURIComponent(voice)}&audio_format=mp3`;
  const socket = await openTtsSocket(url, { Authorization: `Bearer ${apiKey}` });

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const chunks: string[] = [];
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        // already closed
      }
      reject(err);
    };
    const done = () => {
      if (settled) return;
      settled = true;
      socket.close();
      resolve(chunks.join(""));
    };

    socket.addEventListener("message", (event: unknown) => {
      const raw = (event as { data?: unknown }).data;
      const payload =
        typeof raw === "string" ? raw : raw instanceof ArrayBuffer ? new TextDecoder().decode(new Uint8Array(raw)) : "";
      if (!payload) return;
      let frame: { audio?: string | null; isFinal?: boolean; error?: string };
      try {
        frame = JSON.parse(payload);
      } catch {
        return; // non-JSON frame — ignore
      }
      if (frame.error) return fail(new Error(frame.error));
      if (typeof frame.audio === "string" && frame.audio.length > 0) chunks.push(frame.audio);
      if (frame.isFinal === true) done();
    });
    socket.addEventListener("error", () => fail(new Error("the TTS WebSocket connection failed")));
    socket.addEventListener("close", () => fail(new Error("the TTS WebSocket closed before the trailer finished")));

    // Handshake first, then the script, then an empty text to flush and close.
    socket.send(JSON.stringify({ text: " " }));
    socket.send(JSON.stringify({ text: script }));
    socket.send(JSON.stringify({ text: "" }));
  });
}

// ── The desk ────────────────────────────────────────────────────────────────

export class WrapDesk extends Agent<Env, WrapState> {
  protected initialState(): WrapState {
    return { episodes: {} };
  }

  /** Create the three ledger tables in the agent's own SQL, idempotently. */
  private ensureSchema(): void {
    const sql = this.ctx.storage.sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS episodes (" +
        "ep_id TEXT PRIMARY KEY, audio_url TEXT NOT NULL, status TEXT NOT NULL, " +
        "error TEXT, created_at TEXT NOT NULL, wrapped_at TEXT)"
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS chapters (" +
        "ep_id TEXT NOT NULL, idx INTEGER NOT NULL, title TEXT NOT NULL, " +
        "start REAL NOT NULL, end REAL NOT NULL, PRIMARY KEY (ep_id, idx))"
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS assets (" +
        "ep_id TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, " +
        "created_at TEXT NOT NULL, PRIMARY KEY (ep_id, kind))"
    );
  }

  private getApiKey(): string {
    return (this.env.TELNYX_API_KEY ?? process.env.TELNYX_API_KEY ?? "").trim();
  }

  /** Register an episode (or resume one) and arm its wrap task. */
  async onWrap(show: string, audioUrl: string): Promise<{
    episodeId: string;
    status: EpisodeStatus;
    resumed: boolean;
  }> {
    this.ensureSchema();
    const state = await this.getState();

    // Resume: an unfinished episode registered for this same show + audio.
    const existing = Object.entries(state.episodes).find(
      ([, ep]) => ep.audioUrl === audioUrl && ep.status !== "wrapped"
    );
    if (existing) {
      const [episodeId, ep] = existing;
      await this.schedule(0, "wrapTick", { episodeId }, { id: `wrap:${episodeId}` });
      return { episodeId, status: ep.status, resumed: true };
    }

    // Birth: a brand-new episode for this desk.
    const episodeId = crypto.randomUUID();
    state.episodes[episodeId] = { audioUrl, status: "transcribing" };
    await this.setState({ episodes: state.episodes });
    this.ctx.storage.sql.exec(
      "INSERT INTO episodes (ep_id, audio_url, status, created_at) VALUES (?, ?, 'transcribing', ?)",
      episodeId,
      audioUrl,
      new Date().toISOString()
    );
    await this.schedule(0, "wrapTick", { episodeId }, { id: `wrap:${episodeId}` });
    return { episodeId, status: "transcribing", resumed: false };
  }

  /** One pipeline step, dispatched by the episode's current status. */
  async wrapTick(payload: { episodeId: string }): Promise<void> {
    this.ensureSchema();
    const episodeId = payload?.episodeId;
    if (!episodeId) return;
    const row = this.ctx.storage.sql
      .exec<{ ep_id: string; audio_url: string; status: string }>(
        "SELECT ep_id, audio_url, status FROM episodes WHERE ep_id = ?",
        episodeId
      )
      .toArray()[0];
    if (!row || row.status === "wrapped") return;

    try {
      switch (row.status) {
        case "transcribing":
          await this.transcribe(row.ep_id, row.audio_url);
          break;
        case "chapterizing":
          await this.chapterize(row.ep_id);
          break;
        case "notes":
          await this.finishNotesAndTrailer(row.ep_id);
          break;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const state = await this.getState();
      const ep = state.episodes[episodeId];
      if (ep) {
        ep.error = message;
        await this.setState({ episodes: state.episodes });
      }
      this.ctx.storage.sql.exec("UPDATE episodes SET error = ? WHERE ep_id = ?", message, episodeId);
      // Rethrow so the task scheduler retries with backoff.
      throw err;
    }
  }

  /** Episode ledger row (this episode) plus every episode on this desk. */
  @rpc({ description: "Return the episode ledger row and the desk's full episode list." })
  async wrapstatus(episodeId: string): Promise<WrapStatus> {
    this.ensureSchema();
    const sql = this.ctx.storage.sql;
    const episode = sql
      .exec<{ status: string; error: string | null }>(
        "SELECT status, error FROM episodes WHERE ep_id = ?",
        episodeId
      )
      .toArray()[0];
    const chapters = sql
      .exec<{ title: string; start: number; end: number }>(
        "SELECT title, start, end FROM chapters WHERE ep_id = ? ORDER BY idx",
        episodeId
      )
      .toArray();
    const notes = sql
      .exec<{ content: string }>(
        "SELECT content FROM assets WHERE ep_id = ? AND kind = 'notes'",
        episodeId
      )
      .toArray()[0];
    const trailer = sql
      .exec<{ content: string }>(
        "SELECT content FROM assets WHERE ep_id = ? AND kind = 'trailer'",
        episodeId
      )
      .toArray()[0];
    const episodes = sql
      .exec<{
        ep_id: string;
        audio_url: string;
        status: string;
        created_at: string;
        wrapped_at: string | null;
      }>("SELECT ep_id, audio_url, status, created_at, wrapped_at FROM episodes ORDER BY created_at")
      .toArray();

    return {
      status: (episode?.status ?? "transcribing") as EpisodeStatus,
      ...(episode?.error ? { error: episode.error } : {}),
      chapters: chapters.map((c) => ({ title: c.title, start: c.start, end: c.end })),
      notesPreview: notes?.content?.slice(0, 200) ?? "",
      trailerBytes: trailer ? base64ByteLength(trailer.content) : 0,
      episodes: episodes.map((e) => ({
        ep_id: e.ep_id,
        audio_url: e.audio_url,
        status: e.status as EpisodeStatus,
        created_at: e.created_at,
        wrapped_at: e.wrapped_at,
      })),
    };
  }

  // ── Stage 1: cut the tape ────────────────────────────────────────────────

  /** Diarized transcription via deepgram/nova-3. Stored exactly once. */
  private async transcribe(episodeId: string, audioUrl: string): Promise<void> {
    if (this.hasAsset(episodeId, "transcript")) {
      // Already cut — advance without re-transcribing.
      await this.setStatus(episodeId, "chapterizing");
      return;
    }

    const words = await this.callTranscription(audioUrl);
    this.ctx.storage.sql.exec(
      "INSERT INTO assets (ep_id, kind, content, created_at) VALUES (?, 'transcript', ?, ?)",
      episodeId,
      JSON.stringify(words),
      new Date().toISOString()
    );
    await this.setStatus(episodeId, "chapterizing");
  }

  /**
   * Download the audio in the desk itself, then upload it as multipart
   * `file`. This lets any public URL work (archive.org's redirect chain, for
   * one, is not followable by the STT service's own file_url fetch).
   */
  private async callTranscription(audioUrl: string): Promise<TranscriptionWord[]> {
    const apiKey = this.getApiKey();
    if (!apiKey) throw new Error("TELNYX_API_KEY is not configured");

    const audio = await fetch(audioUrl);
    if (!audio.ok) throw new Error(`could not download the episode audio: HTTP ${audio.status}`);
    const blob = await audio.blob();

    const form = new FormData();
    form.append("file", blob, "episode.mp3");
    form.append("model", STT_MODEL);
    form.append("response_format", "verbose_json");
    form.append(
      "model_config",
      JSON.stringify({ diarize: true, smart_format: true, punctuate: true })
    );

    const resp = await fetch(`${TELNYX_API}/ai/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!resp.ok) {
      throw new Error(`transcription failed: HTTP ${resp.status} ${await resp.text()}`);
    }
    const data = (await resp.json()) as { segments?: Array<{ words?: Array<Record<string, unknown>> }> };
    const words = flattenWords(data);
    if (words.length === 0) throw new Error("the transcription returned no word-level data");
    return words;
  }

  // ── Stage 2: mark the chapters ───────────────────────────────────────────

  private async chapterize(episodeId: string): Promise<void> {
    if (this.hasChapters(episodeId)) {
      await this.setStatus(episodeId, "notes");
      return;
    }

    const words = await this.loadTranscript(episodeId);
    const turns = buildTurns(words);
    const chapters = splitIntoChapters(turns, CHAPTER_GAP_S);
    if (chapters.length === 0) throw new Error("chapterization produced no chapters");

    const titles = await this.askChapterTitles(chapters);
    for (let i = 0; i < chapters.length; i++) {
      this.ctx.storage.sql.exec(
        "INSERT INTO chapters (ep_id, idx, title, start, end) VALUES (?, ?, ?, ?, ?)",
        episodeId,
        i,
        titles[i] ?? `Chapter ${i + 1}`,
        chapters[i].start,
        chapters[i].end
      );
    }
    await this.setStatus(episodeId, "notes");
  }

  /** One LLM call writes a title for every chapter. */
  private async askChapterTitles(chapters: ChapterSpan[]): Promise<string[]> {
    const prompt =
      "You are a podcast chaptering assistant. Given these chapter summaries " +
      "(in order), provide a short, punchy title for each. Return ONLY a JSON " +
      "array of strings, one title per chapter:\n" +
      chapters
        .map((c, i) => `${i + 1}. ${c.words.join(" ").slice(0, 200)}`)
        .join("\n");
    const completion = await this.complete(prompt, "You are a podcast chaptering assistant.");
    return parseJsonArrayTitles(completion, chapters.length);
  }

  // ── Stage 3: write the liner notes, then cut the trailer ─────────────────

  /** Notes are written first; the trailer follows; then the episode lands wrapped. */
  private async finishNotesAndTrailer(episodeId: string): Promise<void> {
    if (!this.hasAsset(episodeId, "notes")) {
      const notes = await this.composeShowNotes(episodeId);
      this.ctx.storage.sql.exec(
        "INSERT INTO assets (ep_id, kind, content, created_at) VALUES (?, 'notes', ?, ?)",
        episodeId,
        notes,
        new Date().toISOString()
      );
    }
    if (!this.hasAsset(episodeId, "trailer")) {
      await this.cutTrailer(episodeId);
    }
    await this.setStatus(episodeId, "wrapped");
  }

  private async composeShowNotes(episodeId: string): Promise<string> {
    const words = await this.loadTranscript(episodeId);
    const chapters = this.loadChapters(episodeId);
    const prompt =
      "Write SEO-friendly show notes for this podcast episode in markdown. " +
      "Include a one-paragraph summary, key takeaways as a bullet list, and " +
      "one standout pull-quote.\n\nTranscript (may be truncated):\n" +
      transcriptText(words).slice(0, 3000) +
      "\n\nChapters:\n" +
      chapters.map((c) => `- ${c.title} (${c.start}s–${c.end}s)`).join("\n");
    return this.complete(prompt, "You are a podcast show-notes writer.");
  }

  /** Pick the boldest chapter hook and stream its trailer voice. */
  private async cutTrailer(episodeId: string): Promise<void> {
    const chapters = this.loadChapters(episodeId);
    if (chapters.length === 0) throw new Error("no chapters available for the trailer");

    const script = await this.writeTrailerScript(chapters);
    const voice = this.env.HOST_VOICE?.trim() || DEFAULT_HOST_VOICE;
    const apiKey = this.getApiKey();
    const audioBase64 = await synthesizeTrailerAudio(script, voice, apiKey);
    if (!audioBase64) throw new Error("the TTS WebSocket returned no audio");

    this.ctx.storage.sql.exec(
      "INSERT INTO assets (ep_id, kind, content, created_at) VALUES (?, 'trailer', ?, ?)",
      episodeId,
      audioBase64,
      new Date().toISOString()
    );
  }

  /** One LLM call picks the boldest chapter and writes a 2–3 sentence script. */
  private async writeTrailerScript(chapters: Array<{ title: string; start: number; end: number }>): Promise<string> {
    const prompt =
      "You write podcast trailers. Below are this episode's chapters. Pick the " +
      "one with the boldest hook and write a 2-3 sentence trailer teaser in the " +
      "show's voice, no more than " +
      `${TRAILER_MAX_CHARS} characters. Return ONLY JSON: ` +
      `{"chapter": <1-based chapter number>, "script": "<teaser text>"}` +
      "\n\nChapters:\n" +
      chapters.map((c, i) => `${i + 1}. ${c.title}`).join("\n");
    const completion = await this.complete(prompt, "You write podcast trailers.");
    try {
      const parsed = JSON.parse(stripCodeFence(completion)) as { script?: unknown };
      const script = typeof parsed.script === "string" ? parsed.script.trim() : "";
      if (script) return script.slice(0, TRAILER_MAX_CHARS);
    } catch {
      // fall through to the first chapter below
    }
    return `On this episode: ${chapters[0].title}. Listen now.`;
  }

  // ── Shared plumbing ──────────────────────────────────────────────────────

  /** One completion through the TELNYX binding — no API key in code. */
  private async complete(prompt: string, systemPrompt: string): Promise<string> {
    const model = this.env.AI_MODEL?.trim() || DEFAULT_AI_MODEL;
    const completion = await this.env.TELNYX.ai.openai.chat.createCompletion({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      max_tokens: 2000,
      temperature: 0.4,
    });
    const content = completion?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) throw new Error("the model returned no content");
    return content;
  }

  private async setStatus(episodeId: string, status: EpisodeStatus): Promise<void> {
    const state = await this.getState();
    const ep = state.episodes[episodeId];
    if (ep) {
      ep.status = status;
      ep.error = undefined;
      await this.setState({ episodes: state.episodes });
    }
    this.ctx.storage.sql.exec(
      status === "wrapped"
        ? "UPDATE episodes SET status = ?, wrapped_at = ?, error = NULL WHERE ep_id = ?"
        : "UPDATE episodes SET status = ?, error = NULL WHERE ep_id = ?",
      status,
      ...(status === "wrapped" ? [new Date().toISOString()] : []),
      episodeId
    );
  }

  private hasAsset(episodeId: string, kind: "transcript" | "notes" | "trailer"): boolean {
    return (
      this.ctx.storage.sql
        .exec<{ n: number }>("SELECT COUNT(*) AS n FROM assets WHERE ep_id = ? AND kind = ?", episodeId, kind)
        .toArray()[0]?.n > 0
    );
  }

  private hasChapters(episodeId: string): boolean {
    return (
      this.ctx.storage.sql
        .exec<{ n: number }>("SELECT COUNT(*) AS n FROM chapters WHERE ep_id = ?", episodeId)
        .toArray()[0]?.n > 0
    );
  }

  private async loadTranscript(episodeId: string): Promise<TranscriptionWord[]> {
    const row = this.ctx.storage.sql
      .exec<{ content: string }>("SELECT content FROM assets WHERE ep_id = ? AND kind = 'transcript'", episodeId)
      .toArray()[0];
    if (!row) throw new Error("the transcript is missing — cannot continue");
    return JSON.parse(row.content) as TranscriptionWord[];
  }

  private loadChapters(episodeId: string): Array<{ title: string; start: number; end: number }> {
    return this.ctx.storage.sql
      .exec<{ title: string; start: number; end: number }>(
        "SELECT title, start, end FROM chapters WHERE ep_id = ? ORDER BY idx",
        episodeId
      )
      .toArray();
  }
}

export function deskName(show: string): string {
  return `show:${show}`;
}

// ── HTTP surface ────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/health/liveness") return new Response("ok");
    if (path === "/health/readiness") return new Response("ok");

    if (path === "/wrap" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        show?: string;
        audioUrl?: string;
      };
      const show = (body.show ?? "").trim();
      const audioUrl = (body.audioUrl ?? env.EPISODE_URL ?? "").trim();
      if (!show || !audioUrl) {
        return Response.json(
          { error: "show and audioUrl are required (audioUrl may default to the EPISODE_URL binding)" },
          { status: 400 }
        );
      }
      const desk = env.DESKS.idFromName(deskName(show));
      const result = await desk.onWrap(show, audioUrl);
      return Response.json(result, { status: 202 });
    }

    if (path.startsWith("/wrapstatus/") && req.method === "GET") {
      const episodeId = decodeURIComponent(path.split("/")[2] ?? "").trim();
      const show = (url.searchParams.get("show") ?? "").trim();
      if (!episodeId || !show) {
        return Response.json({ error: "episode id path segment and show query parameter are required" }, { status: 400 });
      }
      const desk = env.DESKS.idFromName(deskName(show));
      const status = await desk.wrapstatus(episodeId);
      return Response.json(status, { status: 200 });
    }

    return Response.json({ error: "Not Found" }, { status: 404 });
  },
};
