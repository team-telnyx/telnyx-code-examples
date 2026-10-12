# Guide: Building the Show Wrap Desk with Telnyx Edge

This guide walks through the `show-wrap-desk` sample — a podcast producer's wrap desk built on the Telnyx Edge runtime. You'll learn how one durable actor can own a multi-stage media pipeline (transcribe → chapterize → write notes → cut a trailer), survive a crash at any point, and never redo finished work.

By the end of this guide you'll understand:

- How a **Stateful Actor** gives you one durable identity per show
- How the **Agent SDK** provides stable-id scheduling, RPC, and SQL persistence
- How to call **Deepgram diarized STT** through Telnyx's OpenAI-compatible transcriptions endpoint
- How to stream **TTS over a WebSocket** to generate a trailer in the host's voice
- How the demo mode simulates the pipeline without incurring charges

---

## Prerequisites

Before you start, make sure you have:

1. **A Telnyx account** — sign up at [portal.telnyx.com](https://portal.telnyx.com) if you don't have one.
2. **A Telnyx API key** — create one in the portal under *API Keys*.
3. **Node.js 18+** — the Edge runtime requires a modern Node version.
4. **The `telnyx-edge` CLI** — install it globally:
   ```bash
   npm install -g @telnyx/edge-runtime
   ```
   > The CLI ships with the `@telnyx/edge-runtime` package. Verify with `telnyx-edge --version`.

5. **A hosted audio file** — for live mode, you need a public URL to an episode recording (≤100MB). For demo mode, any URL works since no real request is made.

---

## Environment Setup

### 1. Install dependencies

```bash
cd show-wrap-desk
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|----------|-------------|---------|
| `TELNYX_API_KEY` | Your Telnyx API key (only needed for live mode) | `your_telnyx_api_key_here` |
| `EPISODE_URL` | Public URL of the episode audio file | `https://example.com/episode.mp3` |
| `HOST_VOICE` | TTS voice for the trailer | `azure.en-US-AvaMultilingualNeural` |
| `DEMO_MODE` | Set to `true` to simulate the pipeline without real API calls | `true` |

> **Security note:** Never commit `.env` or `.env.local` — it's gitignored. The `.env.example` file contains placeholders only.

### 3. Authenticate the CLI

```bash
telnyx-edge auth api-key set "$TELNYX_API_KEY"
```

### 4. Generate types from your bindings

```bash
npm run types
```

This regenerates `telnyx-env.d.ts` from the bindings declared in `telnyx.toml`.

---

## Project Structure

```
show-wrap-desk/
├── src/
│   └── index.ts          # The entire app — actor + HTTP routes
├── telnyx.toml           # Edge runtime config (actors, secrets, bindings)
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript config
├── .env.example          # Placeholder env vars
├── .gitignore
├── smoke_test.ts         # Verifies the module loads
├── README.md             # Project overview
├── API.md                # Endpoint reference
└── GUIDE.md              # This file
```

---

## How the Wrap Desk Works

The core idea: **one durable actor per show** owns the entire wrap pipeline. When you `POST /api/wrap` with an episode URL, the desk is born (or re-activated if it already exists), and it walks the episode through four stages:

```
transcribing → chapterizing → notes → wrapped
```

Each stage is **idempotent** — if the worker dies mid-pipeline, the next wake resumes exactly where it left off, reusing any completed work.

---

## Step 1: The Actor and Its State

The heart of the app is the `WrapDesk` class, which extends `Agent` from `@telnyx/edge-runtime`:

```typescript
export class WrapDesk extends Agent<Env, WrapState> {
  protected initialState(): WrapState {
    return { episodes: {} };
  }
  // ...
}
```

**What's happening here:**

- `Agent<Env, WrapState>` gives you durable state, scheduling, and RPC out of the box.
- `WrapState` is an in-memory ledger of episodes: `{ [episodeId]: { audioUrl, status, error? } }`.
- `initialState()` seeds the actor's state when it's first created.

The actor is declared in `telnyx.toml`:

```toml
[[actors]]
binding = "DESK"
type    = "WrapDesk"
```

This creates an `env.DESK` namespace you can use to address the actor by name:

```ts
const desk = ctx.env.DESK.get("show:tok-podcast");
```

**Key Telnyx primitive: Stateful Actor.** One durable entity per show. It owns the episode ledger, the wrap task, and the resume points between every stage.

---

## Step 2: The HTTP Entry Point

The default export handles incoming HTTP requests:

```ts
export default {
  async fetch(req: Request, ctx: ActorContext): Promise<Response> {
    // POST /api/wrap — birth or resume a desk
    // GET /api/wrapstatus/:episodeId — query the ledger
  }
}
```

### `POST /api/wrap`

```bash
curl -X POST http://localhost:8787/api/wrap \
  -H "Content-Type: application/json" \
  -d '{"show": "tok-podcast", "audioUrl": "https://example.com/episode.mp3"}'
```

The handler:

1. Validates `show` and `audioUrl`.
2. Resolves the actor: `ctx.env.DESK.get("show:" + show)`.
3. Generates an `episodeId` (UUID).
4. Calls `desk.onWrap(episodeId, audioUrl)`.
5. Returns `202 Accepted` with the episode ID.

**Key detail:** The actor is addressed by the **show name**, not the episode. This means a second `POST /api/wrap` for a new episode reuses the same desk instance — the actor's message history and style carry over.

---

## Step 3: Birth and the Wrap Task

When `onWrap` is called, two things happen:

```ts
async onWrap(episodeId: string, audioUrl: string): Promise<void> {
  const state = await this.getState();
  if (!state.episodes[episodeId]) {
    // NEW EPISODE: store it, kick off the pipeline
    state.episodes[episodeId] = { audioUrl, status: "transcribing" };
    await this.setState({ episodes: state.episodes });
    await this.env.EPISODES_DB.exec(
      "INSERT INTO episodes (ep_id, audio_url, status) VALUES (?, ?, ?)",
      [episodeId, audioUrl, "transcribing"]
    );
    await this.schedule(0, "wrapTick", { episodeId });
  } else {
    // EXISTING EPISODE: resume — re-arm the task
    await this.schedule(0, "wrapTick", { episodeId });
  }
}
```

**What's happening here:**

1. **State update** — the episode is recorded in actor state with status `transcribing`.
2. **SQL persistence** — the episode row is inserted into the `episodes` table. This is the durable ledger that survives a crash.
3. **Scheduling** — `this.schedule(0, "wrapTick", { episodeId })` arms a task that fires immediately. The task handler is the `wrapTick` method on the same class.

**Key Telnyx: Agent SDK scheduling.** `this.schedule(delaySeconds, method, payload)` upserts a task by stable ID. If you call it again with the same method + payload, it replaces the existing task rather than duplicating it. This is what makes resume safe — you never double-schedule.

---

## Step 4: The Pipeline Walker

`wrapTick` is the state machine that walks the episode through its stages:

```ts
async wrapTick(payload: { episodeId: string }): Promise<void> {
  const state = await this.getState();
  const episode = state.episodes[episodeId];
  if (!episode) return;

  switch (episode.status) {
    case "transcribing":  await this.transcribe(episodeId); break;
    case "chapterizing":  await this.chapterize(episodeId); break;
    case "notes":         await this.writeNotes(episodeId); break;
    case "wrapped":       break; // already done
  }
}
```

Each stage method:

1. Checks if its output already exists (idempotency check).
2. Does the work (STT, LLM, TTS).
3. Persists the output to SQL.
4. Advances the status.
5. Re-arms the task: `this.schedule(0, "wrapTick", { episodeId })`.

---

## Step 5: Transcription — Cutting the Tape

The `transcribe` method is the first stage. It checks whether a transcript already exists in the `assets` table:

```ts
const existing = await this.env.EPISODES_DB.prepare(
  "SELECT storage_key FROM assets WHERE ep_id = ? AND kind = 'transcript'"
).bind(episodeId).first();

if (existing) {
  // Already transcribed — skip to chapterizing
  episode.status = "chapterizing";
  // ... persist + re-arm
  return;
}
```

**This is the idempotency guard.** If the worker died after transcription but before chapterizing, the next wake finds the transcript and skips straight to step 3.

### Demo mode (default)

```ts
if (this.env.DEMO_MODE === "true") {
  const fakeWords = this.generateFakeWords();
  await this.storeTranscript(episodeId, fakeWords);
  // advance status...
  return;
}
```

`generateFakeWords()` produces a deterministic array of word objects with `word`, `start`, `end`, `confidence`, and `speaker` fields — shaped exactly like a real STT response. This lets you test the full pipeline without spending a cent.

### Live mode

When `DEMO_MODE=false`, the code calls Telnyx's OpenAI-compatible transcriptions endpoint:

```ts
const formData = new FormData();
formData.append("file_url", episode.audioUrl);
formData.append("model", STT_MODEL);                        // "deepgram/nova-3"
formData.append("response_format", "verbose_json");
formData.append("model_config", JSON.stringify({
  diarize: true, smart_format: true, punctuate: true
}));

const resp = await fetch("https://api.telnyx.com/v2/ai/audio/transcriptions", {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}` },
  body: formData,
});
```

**Key Telnyx API: Speech-to-Text.** The `deepgram/nova-3` model with `diarize: true` returns a `words[]` array where every word carries:

- `word` — the token
- `start` / `end` — timestamps in seconds
- `confidence` — 0–1
- `speaker` — speaker label (e.g. `"0"`, `"1"`)

This is the "tape" — the raw material for everything downstream.

---

## Step 6: Chapterizing — Cutting the Tape

The `chapterize` stage groups words into speaker turns, then collapses gaps into chapters:

```ts
// 1. Group words into speaker turns
for (const w of words) {
  if (!currentTurn || currentTurn.speaker !== w.speaker) {
    if (currentTurn) turns.push(currentTurn);
    currentTurn = { speaker: w.speaker, start: w.start, end: w.end, text: w.word };
  } else {
    currentTurn.end = w.end;
    currentTurn.text += " " + w.word;
  }
}

// 2. Collapse gaps > CHAPTER_GAP_S (60s)
for (const turn of turns) {
  if (!currentChapter) {
    currentChapter = { start: turn.start, end: turn.end, words: [turn.text] };
  } else if (turn.start - currentChapter.end > CHAPTER_GAP_S) {
    chapters.push(currentChapter);
    currentChapter = { start: turn.start, end: turn.end, words: [turn.text] };
  } else {
    currentChapter.end = turn.end;
    currentChapter.words.push(turn.text);
  }
}
```

**The logic:**

- A **speaker turn** is a contiguous run of words from one speaker.
- A **chapter boundary** is a gap of more than 60 seconds between turns — that's a natural pause where a new topic starts.

### LLM chapter titles

In live mode, the code asks the LLM binding for a title per chapter:

```ts
const resp = await this.env.TELNYX.ai.openai.chat.createCompletion({
  model: "gpt-4o-mini",
  messages: [
    { role: "system", content: "You are a podcast chaptering assistant." },
    { role: "user", content: prompt },
  ],
});
```

**Key Telnyx: LLM binding.** `this.env.TELNYX.ai.openai.chat.createCompletion` is zero-credential — the platform injects auth automatically. No API key in your code.

### Persistence

Chapters are stored **before** the status advances:

```ts
for (let i = 0; i < chapters.length; i++) {
  await this.env.EPISODES_DB.exec(
    "INSERT INTO chapters (ep_id, idx, title, start, end) VALUES (?, ?, ?, ?, ?)",
    [episodeId, i, titles[i], chapters[i].start, chapters[i].end]
  );
}
```

**Why this matters:** If the worker dies after the LLM call but before the status update, the next wake finds the chapters already in SQL and skips straight to notes. No re-cut.

---

## Step 7: Show Notes — The Liner Notes

The `writeNotes` stage composes SEO-friendly show notes from the transcript + chapters:

```ts
const prompt = `Write SEO-friendly show notes for this podcast episode.
Transcript: ${fullText.slice(0, 3000)}
Chapters: ${chapterRows.map(c => `- ${c.title} (${c.start}s–${c.end}s)`).join("\n")}
Include a summary, key takeaways, and a pull-quote.`;

const resp = await this.env.TELNYX.ai.openai.chat.createCompletion({
  model: "gpt-4o-mini",
  messages: [
    { role: "system", content: "You are a podcast show-notes writer." },
    { role: "user", content: prompt },
  ],
});
```

The notes are stored in the `notes` table and registered in `assets` with kind `notes`.

**Idempotency check:** If a `notes` asset already exists, the stage skips straight to `wrapped`.

---

## Step 8: The Trailer — TTS Over WebSocket

The final stage is the trailer. The spec calls for:

1. LLM picks the chapter with the boldest hook.
2. LLM writes a 2–3 sentence script.
3. The script streams over the TTS WebSocket.
4. Base64 chunks are collected until `isFinal: true`.
5. The result is stored as the `trailer` asset.

The generated code currently implements the **demo path** for the trailer (it marks the episode `wrapped` and stores a placeholder asset). The live path would look like this:

```ts
// 1. LLM picks the hook chapter
// 2. LLM writes the trailer script
const script = "..."; // 2-3 sentences

// 3. Open the TTS WebSocket
const ws = new WebSocket(
  `wss://api.telnyx.com/v2/text-to-speech/speech?voice=${HOST_VOICE}`,
  { headers: { Authorization: `Bearer ${apiKey}` } }
);

// 4. Stream until isFinal
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.isFinal) {
    // save the collected base64 audio as trailer.mp3
    ws.close();
  }
};
```

**Key Telnyx: TTS WebSocket.** The endpoint is `wss://api.telnyx.com/v2/text-to-speech/speech`. You pass the voice as a query parameter (`azure.en-US-AvaMultilingualNeural` in the demo). The server streams audio chunks back until it sends `isFinal: true`.

---

## Step 9: RPC — Querying the Ledger

The `@rpc()` decorator exposes a method that can be called from anywhere:

```ts
@rpc()
async wrapstatus(episodeId: string): Promise<{...}> {
  // Query episodes, chapters, notes, trailer from SQL
  return {
    status: episodeRow?.status ?? "unknown",
    chapters: chapters.map(c => ({ title: c.title, start: c.start, end: c.end })),
    notesPreview: notesRow?.content?.slice(0, 200) ?? "",
    trailerBytes: trailerRow ? 1024 : 0,
  };
}
```

The HTTP route calls it:

```ts
const desk = ctx.env.DESK.get("default");
const status = await desk.wrapstatus(episodeId);
```

**Key Telnyx: `@rpc()`.** This makes the method callable from outside the actor — from HTTP handlers, other actors, or scheduled tasks.

---

## Demo Mode vs Live Mode

The app ships with **demo mode enabled by default** (`DEMO_MODE=true`). This is critical for safe testing:

| Stage | Demo Mode | Live Mode |
|-------|-----------|-----------|
| STT | Deterministic fake words | Real Deepgram call via `POST /v2/ai/audio/transcriptions` |
| LLM | Generic titles ("Chapter 1") | Real GPT-4o-mini via `TELNYX.ai.openai.chat.createCompletion` |
| TTS | No WebSocket — placeholder | Real TTS WebSocket stream |
| Cost | $0 | Real API charges |

**To switch to live mode:**

1. Set `DEMO_MODE=false` in your env.
2. Set `TELNYX_API_KEY` to your real key.
3. Set `EPISODE_URL` to a real hosted audio file (≤100MB).
4. Set `HOST_VOICE` to a voice from `GET /text-to-speech/voices`.

---

## Running the Sample

### Local development

```bash
npm run dev
```

This starts the Edge runtime locally. The app listens on `http://localhost:8787`.

### Deploying

```bash
npm run types   # regenerate types from telnyx.toml
npm run ship    # deploy (alias for telnyx-edge ship)
```

### Smoke test

```bash
npx tsx smoke_test.ts
```

This verifies the module loads and the key classes/methods exist.

---

## Testing the Full Flow

### 1. Birth the desk

```bash
curl -X POST http://localhost:8787/api/wrap \
  -H "Content-Type: application/json" \
  -d '{"show": "tok-podcast", "audioUrl": "https://example.com/episode.mp3"}'
```

Response:

```json
{
  "episodeId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "transcribing"
}
```

### 2. Check status

```bash
curl http://localhost:8787/api/wrapstatus/550e8400-e29b-41d4-a716-446655440000
```

In demo mode, the pipeline runs instantly, so you'll see:

```json
{
  "status": "wrapped",
  "chapters": [
    { "title": "Chapter 1", "start": 0, "end": 120 },
    { "title": "Chapter 2", "start": 180, "end": 300 }
  ],
  "notesPreview": "# Show Notes\n\n...",
  "trailerBytes": 1024
}
```

### 3. Test resume

Kill the worker after transcription (in demo mode, set a breakpoint or kill the process). Restart it, then `POST /api/wrap` again with the same `show` and a new `audioUrl`. The desk re-activates, finds the existing episode, and resumes from `chapterizing` — the transcript is reused.

---

## Next Steps

Now that you understand the wrap desk, here's where to go deeper:

- **Telnyx Edge docs** — [Agent SDK](https://developers.telnyx.com/docs/agent-sdk) for the full API surface: scheduling, RPC, SQL, KV, and more.
- **Speech-to-Text API** — [Transcribe speech to text](https://developers.telnyx.com/api-reference/audio/transcribe-speech-to-text) for the full request/response shape.
- **Text-to-Speech** — [TTS overview](https://developers.telnyx.com/docs/voice/tts/overview) and the [WebSocket streaming guide](https://developers.telnyx.com/api-reference/websockets/stream-text-to-speech-over-websocket).
- **Voice catalog** — [List available voices](https://developers.telnyx.com/api-reference/text-to-speech-commands/list-available-voices) to find the right voice for your host.
- **Related sample** — Compare with the [AI Audiobook Narrator](https://developers.telnyx.com/docs/ai/audiobook-narrator) (DEV-357) to see how a different TTS workflow is structured.

**Ideas to extend this sample:**

- Add a `POST /api/retry/:episodeId` endpoint to force a re-wrap.
- Store the trailer audio in a BlobStore or CloudStorage bucket instead of a placeholder.
- Add a webhook that notifies you when an episode reaches `wrapped`.
- Use `this.every()` to poll the STT job instead of a single wake.
