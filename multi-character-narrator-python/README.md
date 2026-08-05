---
name: multi-character-narrator
title: "Multi-Character Narrator"
description: "Try every Telnyx Ultra voice in one scene. Paste a dialogue script, assign each character a distinct Ultra voice and an SSML emotion, render every line in parallel, and hear all the voices in context in one stitched MP3."
language: python
framework: flask
telnyx_products: [Text-to-Speech]
channel: [api]
---

# Multi-Character Narrator

Telnyx ships over 700 Ultra voices across 36 languages with sub-100ms time-to-first-byte. The docs list three. The Voices API returns 4,000+ across every provider. Voice pickers play a fixed sample sentence per voice. None of that tells you how a voice handles emotion, pacing, or character inside a real scene.

This app lets you hear Telnyx voices in context. Paste a dialogue script with speaker labels, assign each character a distinct Telnyx Ultra voice and an SSML emotion, render every line in parallel, and stitch the per-line audio into one continuous MP3. Every voice speaks in character, in emotion, in one audio file.

Pure TTS, no phone, no webhook, no Cloud Storage required.

## Telnyx API Endpoints Used

- **Text-to-Speech (Ultra, REST)**: `POST /v2/text-to-speech/speech` — [API reference](https://developers.telnyx.com/api/inference/generate-speech-from-text)
  - Voice format: `Telnyx.Ultra.<voice_uuid>` — Ultra voice IDs are UUIDs, not short names. Enumerate available voices with `GET /v2/text-to-speech/voices`.
  - Ultra is **REST-only** — a 403 on `wss://` is intentional. Use this REST endpoint, not the public WebSocket.
  - `output_type: "binary_output"` is used so we can measure true time-to-first-byte per line.
  - `text_type: "ssml"` is used when an emotion is set, with inline `<emotion value="..." />` tags.
- **Voices API** (optional, for enumerating Ultra voices): `GET /v2/text-to-speech/voices` — returns all 4,000+ voices across providers; filter to `provider == "telnyx"` and `id | startswith("Telnyx.Ultra.")` for Ultra only.

> Note: Other TTS examples in this repo use the OpenAI-compatible `/v2/ai/generate` endpoint. This example uses the full Telnyx TTS endpoint `/v2/text-to-speech/speech` because Ultra voices are exposed there. Both endpoints accept a Bearer API key.

## Architecture

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

## How It Works

1. The caller POSTs a multi-line script. Each line is `Speaker: text`. Lines without a label inherit the previous speaker.
2. The Flask app maps each speaker to one of eight curated Telnyx Ultra voices and to one of twenty Ultra SSML emotions. Both are overridable per request.
3. The app fans out one REST TTS call per line in parallel (up to 8 concurrent). When an emotion is set (not "neutral"), the line is wrapped with an inline `<emotion value="..." />` SSML tag and sent with `text_type: ssml`.
4. Successful audio chunks are concatenated in original script order to produce one continuous MP3.
5. The result is stored in memory (1-hour TTL) and served via `/audio/<project_id>.mp3`.

## Why Telnyx

Telnyx AI Communications Infrastructure ships sub-100ms TTFB Text-to-Speech on the Ultra provider with over 700 voices across 36 languages. This example shows how to hear those voices in context — not a sample sentence, but a real scene with real characters and real emotions. One API key, one endpoint, multiple pre-built Ultra voices, and 20 SSML emotions produce a finished multi-character scene in a single request.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |

No phone number, connection ID, public key, or webhook URL is required — this example is pure TTS.

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/multi-character-narrator-python
cp .env.example .env    # ← fill in your TELNYX_API_KEY
pip install -r requirements.txt
python app.py           # starts on http://localhost:5050
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login
```

To enumerate available Ultra voices before overriding the default map:

```bash
curl -H "Authorization: Bearer $TELNYX_API_KEY" \
  https://api.telnyx.com/v2/text-to-speech/voices | jq '.voices[] | select(.id | startswith("Telnyx.Ultra."))'
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>

## API Reference

See [`API.md`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/multi-character-narrator-python/API.md) for the full typed endpoint reference. Quick start:

```bash
curl -X POST http://localhost:5050/narrate \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Scene 1 — Coffee Shop",
    "script": "Narrator: The coffee shop buzzed with morning chatter.\nBob: Did you see the news?\nAlice: I did. Wild, right?\nCarol: We should talk about it later.",
    "voices": {"Bob": "Telnyx.Ultra.00967b2f-88a6-4a31-8153-110a92134b9f"},
    "emotions": {"Bob": "excited", "Alice": "calm"}
  }'
```

Response:

```json
{
  "project_id": "narr-a1b2c3d4",
  "title": "Scene 1 — Coffee Shop",
  "lines_rendered": 4,
  "lines_failed": 0,
  "speakers": ["Alice", "Bob", "Carol", "Narrator"],
  "voice_map": {
    "Narrator": "Telnyx.Ultra.01eaafa9-308a-4276-a017-6ab0cf061b1f",
    "Bob": "Telnyx.Ultra.00967b2f-88a6-4a31-8153-110a92134b9f",
    "Alice": "Telnyx.Ultra.00a77add-48d5-4ef6-8157-71e5437b282d",
    "Carol": "Telnyx.Ultra.2747b6cf-fa34-460c-97db-267566918881"
  },
  "emotion_map": {
    "Narrator": "calm",
    "Bob": "excited",
    "Alice": "calm",
    "Carol": "neutral"
  },
  "total_ms": 1840,
  "per_line_ttfb_ms": [180, 145, 152, 167],
  "audio_url": "/audio/narr-a1b2c3d4.mp3"
}
```

Stream the stitched audio:

```bash
curl -o scene.mp3 http://localhost:5050/audio/narr-a1b2c3d4.mp3
ffprobe scene.mp3   # should report MP3, ~seconds long
```

## The Eight Curated Ultra Voices

The app ships with eight pre-built Telnyx Ultra voices curated for the most common use cases. Each one is a real Telnyx voice with a UUID voice ID that works on the REST endpoint.

| Voice | UUID | Gender | Language | Best Use Case | Sound Profile |
|---|---|---|---|---|---|
| Asher | `Telnyx.Ultra.00967b2f-...` | Male | en | Voice Assistants & Media | Smooth, dynamic, podcaster-style tone |
| Callie | `Telnyx.Ultra.00a77add-...` | Female | en | Coaching & Onboarding | High energy, encouraging, friendly tone |
| Clara | `Telnyx.Ultra.01eaafa9-...` | Female | en-US | General Purpose IVR/AI | Clear, standard US accent, versatile pacing |
| Howard | `Telnyx.Ultra.0d42f0f6-...` | Male | en-US | Conversational Agents | Deep, reassuring, highly trustworthy |
| Allie | `Telnyx.Ultra.2747b6cf-...` | Female | en-US | Casual & Interactive AI | Conversational flow, natural pauses |
| Jasper | `Telnyx.Ultra.3faa81ae-...` | Male | en-GB | Finance & Healthcare | Calm, authoritative, precise delivery |
| Skyler | `Telnyx.Ultra.01fd7d67-...` | Neutral | en | Modern Brand Voice | Casual, tech-forward, friendly vibe |
| Arvin | `Telnyx.Ultra.3f04e815-...` | Male | en | Navigation & Directives | Steady, clear cadence for detailed guidance |

The app ships with 8 curated UUIDs, but the Voices API (`GET /v2/text-to-speech/voices`) returns over 700 Ultra voices. Any of them can be swapped in via the `voices` field in the request body or the voice dropdown in the browser UI.

## Twenty Ultra SSML Emotions

Ultra supports inline SSML emotion tags placed before the text:

```
<emotion value="excited" />Great news — your order shipped early!
```

The app exposes all twenty Ultra SSML emotions as a per-character dropdown:

**Primary:** `angry`, `excited`, `content`, `sad`, `scared`

**Additional:** `happy`, `enthusiastic`, `curious`, `calm`, `grateful`, `affectionate`, `sarcastic`, `surprised`, `confident`, `hesitant`, `apologetic`, `determined`, `frustrated`, `disappointed`

Each character in the default Julius Caesar scene is auto-assigned an emotion that fits the role. Cassius is determined. Caesar is surprised. Brutus is apologetic. Mark Antony is angry. The Narrator is calm. Same voice, different emotion, different delivery — all from one inline SSML tag per line.

Omitting the tag means neutral delivery. Use sparingly — Ultra interprets emotional subtext from the text itself.

## Default Sample Script

The app ships with one sample script: **Julius Caesar — the Ides of March**. Five characters, ten lines, five distinct voices, five different emotions.

```
Cassius: This is our moment. Rome cannot survive under one ruler. Stay focused.
Caesar: What is happening? Why are you all surrounding me?
Brutus: I am sorry, Caesar. This is not personal. I believe it is what Rome needs.
Caesar: Brutus, even you? I never thought you would betray me.
Narrator: The conspirators strike Caesar.
Caesar: Then this is the end.
Cassius: It is over. Rome is free.
Mark Antony: Look at what you have done. The greatest leader Rome has ever known is gone.
Brutus: We did not act out of hate. We acted because we believed Rome deserved a future without a tyrant.
Mark Antony: History will decide whether you saved Rome or destroyed it.
```

## Browser UI

The app includes an inline browser UI at `GET /`:

- Paste a script or use the pre-loaded Julius Caesar scene
- The UI auto-detects speakers as you type
- Each speaker gets a voice dropdown (8 curated Ultra voices) and an emotion dropdown (20 SSML emotions)
- Click **Preview** to hear any voice with any emotion before rendering
- Click **Render scene** — the app fans out parallel TTS calls and stitches the result
- The audio player autoplays the stitched MP3
- The Cast section shows which voice played which character, with emotion badges

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `401 Unauthorized` from `/narrate` | Missing or invalid `TELNYX_API_KEY` | Set `TELNYX_API_KEY` in `.env` from the [Portal](https://portal.telnyx.com/api-keys) |
| `403 Forbidden` from a `wss://` URL | Ultra is REST-only on the public WebSocket | Use `POST /v2/text-to-speech/speech`, not the WebSocket endpoint |
| `400` with `invalid voice specification` | Voice string is not in `Telnyx.Ultra.<uuid>` form | Ultra voice IDs are UUIDs, not display names. Enumerate valid voices with `GET /v2/text-to-speech/voices` |
| `429 Too Many Requests` | Hit TTS rate limit during parallel fan-out | Lower `MAX_WORKERS` in `app.py` or retry with exponential backoff |
| Stitched MP3 plays only the first line | Bytes from one line are zero-length | Check the `errors` array in the response — failed lines are skipped, not silent |
| Two characters sound identical | Both speaker labels mapped to the same Ultra voice UUID | Override via the `voices` field, or pick distinct UUIDs from `GET /v2/text-to-speech/voices` |
| Long scripts (>50 lines) timeout | Default `max_workers=8` plus 60s per-line timeout | Split the script, or increase `MAX_WORKERS` and the per-request timeout |
| Port 5000 already in use | macOS AirPlay Receiver holds port 5000 | App defaults to `PORT=5050` env var |

## Related Examples

- [`ai-voiceover-studio-python`](https://github.com/team-telnyx/telnyx-code-examples/tree/main/ai-voiceover-studio-python) — single-voice voice-over with AI direction cues
- [`ai-audiobook-narrator-python`](https://github.com/team-telnyx/telnyx-code-examples/tree/main/ai-audiobook-narrator-python) — single-voice long-form narration with chapter chunking
- [`multilingual-voiceover-kit-python`](https://github.com/team-telnyx/telnyx-code-examples/tree/main/multilingual-voiceover-kit-python) — same script rendered in 15 languages
- [`commercial-voiceover-generator-python`](https://github.com/team-telnyx/telnyx-code-examples/tree/main/commercial-voiceover-generator-python) — 3 AI-written script variations rendered in multiple voices
- [`text-to-speech-phone-call-python`](https://github.com/team-telnyx/telnyx-code-examples/tree/main/text-to-speech-phone-call-python) — TTS playback during a live phone call

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- TTS overview: [developers.telnyx.com/docs/voice/tts](https://developers.telnyx.com/docs/voice/tts)
- Ultra provider docs (voices, REST fields, SSML emotions): [developers.telnyx.com/docs/voice/tts/providers/telnyx/ultra](https://developers.telnyx.com/docs/voice/tts/providers/telnyx/ultra)
- SSML emotions reference: [developers.telnyx.com/docs/voice/tts/providers/telnyx/ultra#ssml-emotions](https://developers.telnyx.com/docs/voice/tts/providers/telnyx/ultra#ssml-emotions)
- TTS REST request reference: [developers.telnyx.com/docs/voice/tts/rest-api/request](https://developers.telnyx.com/docs/voice/tts/rest-api/request)
- Voices API: `GET https://api.telnyx.com/v2/text-to-speech/voices` — returns all 4,000+ voices across providers
- Repo CONTRIBUTING.md: [github.com/team-telnyx/telnyx-code-examples/blob/main/CONTRIBUTING.md](https://github.com/team-telnyx/telnyx-code-examples/blob/main/CONTRIBUTING.md)
