# Build a Multi-Character Narrator with Telnyx Ultra TTS

Try every Telnyx Ultra voice in one scene. Paste a dialogue script, assign each character a distinct Ultra voice and an SSML emotion, render every line in parallel, and hear all the voices in context in one stitched MP3.

## How It Works

```
  POST /narrate  (script with speaker labels)
        │
        ▼
  ┌──────────────────────┐
  │ Parse script         │  → lines = [{speaker, text, order}, ...]
  └────────┬─────────────┘
           │
           ▼
  ┌──────────────────────┐
  │ Map speaker → voice  │  (8 curated Telnyx Ultra voices, overridable)
  │ Map speaker → emotion │  (20 Ultra SSML emotions, overridable)
  └────────┬─────────────┘
           │
           ▼
  ┌──────────────────────┐
  │ Parallel TTS fan-out │  ThreadPoolExecutor, one POST per line
  │ N Ultra REST calls   │  text_type=ssml, output_type=binary_output
  │                      │  <emotion value="..." /> wrapping when set
  └────────┬─────────────┘
           │
           ▼
  ┌──────────────────────┐
  │ Stitch audio bytes   │  concatenate MP3 frames in script order
  └────────┬─────────────┘
           │
           ▼
  Return: project_id, total_ms, per_line_ttfb_ms, audio_url
```

## Telnyx Products Used

- **Text-to-Speech (Ultra)** — sub-100ms TTFB, 700+ voices, 36 languages, REST-only. The app uses inline SSML emotion tags (`<emotion value="..." />`) with `text_type: ssml` to apply per-character emotions.

## API Endpoints

- **Text-to-Speech (Ultra, REST)**: `POST /v2/text-to-speech/speech` — [API reference](https://developers.telnyx.com/api/inference/generate-speech-from-text)
- **Voices API** (optional, for enumerating Ultra voices): `GET /v2/text-to-speech/voices` — returns all 4,000+ voices across providers; filter to `provider == "telnyx"` and `id | startswith("Telnyx.Ultra.")` for Ultra only. Voice IDs are UUIDs (e.g. `Telnyx.Ultra.01eaafa9-308a-4276-a017-6ab0cf061b1f`).

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- A Telnyx API v2 key from the [Portal](https://portal.telnyx.com/api-keys)

No phone number, TeXML application, or webhook endpoint is required.

## Step 1 — Configure environment

```bash
cp .env.example .env
# Edit .env and set TELNYX_API_KEY
```

## Step 2 — Install dependencies

```bash
pip install -r requirements.txt
```

## Step 3 — Run the app

```bash
python app.py
# * Running on http://127.0.0.1:5050
```

The app defaults to port 5050 to avoid conflicts with macOS AirPlay Receiver on port 5000. Override with `PORT=xxxx python app.py`.

## Step 4 — Open the browser UI

Open `http://127.0.0.1:5050/` in your browser. The default Julius Caesar script is pre-loaded. The browser UI lets you:

- Pick a Telnyx Ultra voice for each character from 8 curated voices
- Pick an SSML emotion for each character from 20 Ultra emotions
- Click Preview to hear any voice with any emotion before rendering
- Click Render scene to fan out parallel TTS calls and stitch the result
- Play the stitched MP3 inline

## Step 5 — Render a scene via curl

```bash
curl -X POST http://localhost:5050/narrate \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Scene 1 — Coffee Shop",
    "script": "Narrator: The coffee shop buzzed with morning chatter.\nBob: Did you see the news?\nAlice: I did. Wild, right?\nCarol: We should talk about it later.",
    "emotions": {"Bob": "excited", "Alice": "calm"}
  }'
```

The response includes `per_line_ttfb_ms` so you can see the per-line time-to-first-byte of each Ultra REST call. Successful lines are stitched in script order.

## Step 6 — Stream the audio

```bash
curl -o scene.mp3 http://localhost:5050/audio/<project_id>.mp3
afplay scene.mp3   # or open scene.mp3
```

## Step 7 — Override the default voice and emotion maps

The default map assigns eight curated Ultra voices to four common speaker labels. Override per request:

```bash
curl -X POST http://localhost:5050/narrate \
  -H "Content-Type: application/json" \
  -d '{
    "script": "Narrator: Hello.\nDragon: Roar!\nKnight: Have at thee!",
    "voices": {
      "Narrator": "Telnyx.Ultra.01eaafa9-308a-4276-a017-6ab0cf061b1f",
      "Dragon": "Telnyx.Ultra.00967b2f-88a6-4a31-8153-110a92134b9f",
      "Knight": "Telnyx.Ultra.00a77add-48d5-4ef6-8157-71e5437b282d"
    },
    "emotions": {
      "Dragon": "angry",
      "Knight": "confident"
    }
  }'
```

To discover additional Ultra voices:

```bash
curl -H "Authorization: Bearer $TELNYX_API_KEY" \
  https://api.telnyx.com/v2/text-to-speech/voices \
  | jq '.voices[] | select(.provider == "telnyx" and (.id | startswith("Telnyx.Ultra.")))'
```

Ultra voice IDs are UUIDs (e.g. `Telnyx.Ultra.01eaafa9-308a-4276-a017-6ab0cf061b1f` for Clara), not short display names. The voices API returns all 4,000+ voices across providers — filter on `provider == "telnyx"` and `id | startswith("Telnyx.Ultra.")` to see only Telnyx Ultra voices.

## Notes and caveats

- **Ultra is REST-only.** A 403 on `wss://api.telnyx.com/v2/text-to-speech/speech` is intentional. Use the REST endpoint.
- **Ultra voice IDs are UUIDs.** Short names like `Telnyx.Ultra.Clara` return 400 on the REST endpoint. Use the full UUID from `GET /v2/text-to-speech/voices`.
- **SSML emotions are Ultra-specific syntax.** `<emotion value="..." />` is not standard W3C SSML; AWS Polly and Azure use different SSML (`<speak><prosody ...>`). Use the Ultra-specific syntax for Ultra voices.
- **MP3 stitching is byte-wise.** Per-line MP3 frames from Ultra share a format, so concatenation produces a valid MP3. For mixed providers or sample rates, re-encode with `ffmpeg` before stitching.
- **Concurrency is capped at 8.** Scripts with more than 8 lines are queued through the pool. Raise `MAX_WORKERS` in `app.py` if you need more parallelism and your TTS quota allows it.
- **In-memory store with 1-hour TTL.** Rendered audio is held in process memory and expires after one hour. Use a database or Cloud Storage for production.
- **Failed lines are skipped, not silent.** If a single line errors (e.g. invalid voice), the response includes an `errors` array and the stitched audio contains only successful lines in script order.

## Next steps

- Add more voices from the 700+ Ultra voices available via the Voices API. Swap any of the 8 curated UUIDs for a different one.
- Add more languages. Ultra covers 36 languages. The same script-render-stitch pipeline works for any of them via `language_boost`.
- Replace the in-memory store with Telnyx Cloud Storage and serve presigned URLs, mirroring [`ai-voiceover-studio-python`](https://github.com/team-telnyx/telnyx-code-examples/tree/main/ai-voiceover-studio-python).
- Add more sample scripts — audiobook chapters, podcast intros, e-learning role-plays, game cinematics.
