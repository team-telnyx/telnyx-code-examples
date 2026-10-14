# Guide: Build a Show Wrap Desk with Telnyx Edge Compute

A podcast producer's wrap desk as one durable AI agent: drop the raw episode
recording, and the desk cuts the tape (speaker-labeled transcription), marks
the chapters (topic boundaries from word timestamps), writes the liner notes
(SEO show notes), and cuts a 30-second trailer in the host's own voice. If the
process dies mid-wrap, it picks up exactly where it stopped — nothing is
re-cut, nothing is lost.

You will build a `WrapDesk` stateful actor on Telnyx Edge Compute that composes
three primitives:

1. **Speech-to-Text** — `POST /v2/ai/audio/transcriptions` with
   `deepgram/nova-3`, diarization on, returning per-word timestamps and
   speaker labels.
2. **AI Inference** — chapter titles, show notes, and the trailer script,
   through the `[telnyx]` binding with zero credentials in code.
3. **Text-to-Speech WebSocket** — `wss://api.telnyx.com/v2/text-to-speech/speech`,
   streaming the trailer until `isFinal: true`.

…all held together by the **Agent SDK**: one durable entity per show, a
stable-id scheduled task per episode, and the agent's own SQL as the ledger.

## Prerequisites

- Node.js 18+
- A [Telnyx API key](https://portal.telnyx.com/api-keys)
- The [Telnyx Edge CLI](https://github.com/team-telnyx/edge-compute/releases) v0.2.2+

## 1. The durable entity

The core idea: **one durable actor per show** owns the entire wrap pipeline.
When you `POST /wrap` with an episode URL, the desk is born (or re-activated
if it already exists), and it walks the episode through four stages:

```text
transcribing ──► chapterizing ──► notes (+ trailer) ──► wrapped
```

Each stage checks its own output before running, so a crash between any two
stages resumes at exactly the unfinished stage:

| Kill after…            | Next wake runs…        | What it does NOT do   |
| ---------------------- | ---------------------- | --------------------- |
| transcription stored   | chapterize             | re-transcribe         |
| chapters persisted     | show notes             | re-chapterize         |
| notes stored           | the trailer            | re-write notes        |
| trailer stored         | mark `wrapped`         | re-stream the voice   |

The wrap task itself is scheduled under the stable id `wrap:<epId>` — the SDK
upserts it, so a resume replaces the pending task instead of duplicating it.

## 2. Scaffold the actor

The `WrapDesk` extends `Agent<Env, WrapState>`. Its durable state holds the
episode map; the ledger rows live in the agent's own SQL (`ctx.storage.sql`)
— three tables, zero external state:

```sql
episodes (ep_id, audio_url, status, error, created_at, wrapped_at)
chapters (ep_id, idx, title, start, end)
assets   (ep_id, kind, content, created_at)   -- kind: transcript | notes | trailer
```

`ensureSchema()` creates all three idempotently (`CREATE TABLE IF NOT EXISTS`)
at the top of every entry point.

## 3. Birth or resume: `onWrap`

`POST /wrap` routes to `env.DESKS.idFromName("show:" + show)` — the actor name
is the show, not the episode, so a second `POST /wrap` for a new episode
reuses the same desk instance (the ledger carries over). `onWrap` resolves the
episode id itself:

- an unfinished episode registered with the same `audioUrl` is **resumed** —
  the stable-id task is re-armed and the call returns the existing episode id;
- otherwise a **new** episode is born with status `transcribing`.

## 4. Stage 1 — cut the tape (STT)

`transcribe()` checks the `transcript` asset first. When absent, it downloads
the episode audio itself and uploads it as a multipart `file` to
`POST /v2/ai/audio/transcriptions` with:

- `model: "deepgram/nova-3"`
- `response_format: "verbose_json"`
- `model_config: {"diarize": true, "smart_format": true, "punctuate": true}`

The response's `segments[].words[]` carry `word`, `start`, `end`,
`confidence`, and `speaker` — the desk flattens them into one word array and
stores it as the `transcript` asset. Storing the download in the desk (rather
than passing `file_url`) means any public URL works, including archive.org's
redirect chain, which the STT service's own fetcher cannot follow.

## 5. Stage 2 — mark the chapters

`chapterize()` groups consecutive same-speaker words into turns
(`buildTurns`), then collapses turns into chapters wherever the silence
between one turn's end and the next turn's start exceeds `CHAPTER_GAP_S` (60
seconds). One LLM call writes a title per chapter (a JSON array; fenced
responses are stripped, garbage falls back to `Chapter N`). Chapter rows are
persisted before the status advances to `notes`.

## 6. Stage 3 — write the liner notes, then cut the trailer

`finishNotesAndTrailer()` runs two idempotent steps under the `notes` status:

1. **Show notes** — if the `notes` asset is absent, one LLM call composes
   markdown from the transcript (first 3000 chars) plus the chapter list:
   a summary, key takeaways, and a pull-quote.
2. **Trailer** — if the `trailer` asset is absent, one LLM call picks the
   chapter with the boldest hook and writes a 2–3 sentence teaser (≤400
   chars). The script then streams over the TTS WebSocket:
   - connect to `wss://api.telnyx.com/v2/text-to-speech/speech?voice=HOST_VOICE&audio_format=mp3`
     with the API key on the handshake's `Authorization` header,
   - handshake with `{"text": " "}`,
   - send `{"text": script}`, then `{"text": ""}` to flush and close,
   - collect `{"audio": "<base64>", "isFinal": false}` frames until
     `{"audio": null, "isFinal": true}`,
   - store the concatenated base64 as the `trailer` asset.

Finally the status lands `wrapped`.

## 7. Deploy and run

```bash
npm install
cp .env.example .env      # set TELNYX_API_KEY
npm run types             # telnyx-edge types
npm run deploy            # telnyx-edge ship — prints the deployed URL
```

Set `DEPLOY_URL` in `.env` to the printed URL, then bootstrap:

```bash
npm run bootstrap
```

The script registers the demo episode (a public-domain LibriVox reading of
Shakespeare's Sonnet 116) and polls until the desk reports `wrapped`, printing
the chapter list, notes preview, trailer bytes, and the episode ledger.

Watch it work with curl:

```bash
curl -X POST https://show-wrap-desk-<id>.telnyxcompute.com/wrap \
  -H "Content-Type: application/json" \
  -d '{"show": "tok-podcast"}'

curl "https://show-wrap-desk-<id>.telnyxcompute.com/wrapstatus/<episodeId>?show=tok-podcast"
```

## 8. The interruption demo

Kill the worker after the transcript is stored but before chapters appear
(abort the deployment mid-wrap). Then:

```bash
npm run bootstrap   # same show + same audioUrl → resumes, does not duplicate
```

`wrapstatus` shows the episode still mid-wrap with its ledger intact; the
re-armed `wrap:<epId>` task completes from the unfinished stage — the
transcript is reused, nothing is re-cut. A second `POST /wrap` with a *new*
`audioUrl` adds a new episode row to the same desk; `wrapstatus` for either
episode returns the full ledger of both.

## Troubleshooting

See the README's troubleshooting table. The two most common runtime failures:
audio Deepgram can't parse (mp3/wav only) and a `HOST_VOICE` the TTS service
refuses — both surface as an `error` on the episode ledger and are retried by
the task scheduler with backoff.

## Wrapping up

You built a wrap desk that is genuinely load-bearing: a four-stage pipeline
that must survive a crash between any two stages, never re-cut finished work,
and keep an episode ledger per show — with zero external state. The speech
primitives (diarized STT in, TTS voice out) and the durable actor identity are
all Telnyx, in one deploy.
