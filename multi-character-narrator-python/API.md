## `POST /narrate`

Render a multi-character script to a single stitched MP3.

### Request

```json
{
  "title": "Scene 1 — Coffee Shop",
  "script": "Narrator: The coffee shop buzzed.\nBob: Did you see the news?\nAlice: I did. Wild, right?",
  "voices": {},
  "emotions": {}
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | `string` | no | Project name (default: `Untitled Scene`) |
| `script` | `string` | **yes** | Multi-line script. Each line: `Speaker: text`. Lines without a label are appended to the previous speaker. Blank lines are skipped. |
| `voices` | `object` | no | Override the default speaker → voice map. Keys are speaker labels, values are `Telnyx.Ultra.<voice_uuid>` strings. Speaker labels not in the map fall back to Clara (`Telnyx.Ultra.01eaafa9-308a-4276-a017-6ab0cf061b1f`). |
| `emotions` | `object` | no | Override the default speaker → emotion map. Keys are speaker labels, values are Ultra SSML emotion strings (`neutral`, `calm`, `excited`, `scared`, `angry`, `determined`, etc.). Invalid emotions are silently ignored. |

### Response `200`

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
  "voice_display_names": {
    "Telnyx.Ultra.01eaafa9-308a-4276-a017-6ab0cf061b1f": "Clara (Ultra, F, en-US)",
    "Telnyx.Ultra.00967b2f-88a6-4a31-8153-110a92134b9f": "Asher (Ultra, M, en)",
    "Telnyx.Ultra.00a77add-48d5-4ef6-8157-71e5437b282d": "Callie (Ultra, F, en)",
    "Telnyx.Ultra.2747b6cf-fa34-460c-97db-267566918881": "Allie (Ultra, F, en-US)"
  },
  "per_line_voices": ["Telnyx.Ultra.01eaafa9-...", "Telnyx.Ultra.00967b2f-...", ...],
  "per_line_emotions": ["calm", "excited", "calm", "neutral"],
  "per_line_speakers": ["Narrator", "Bob", "Alice", "Carol"],
  "per_line_text": ["The coffee shop buzzed.", "Did you see the news?", ...],
  "total_ms": 1840,
  "per_line_ttfb_ms": [180, 145, 152, 167],
  "audio_url": "/audio/narr-a1b2c3d4.mp3"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `project_id` | `string` | ID used to retrieve the stitched audio |
| `title` | `string` | Echoed from request |
| `lines_rendered` | `integer` | Count of lines that produced audio |
| `lines_failed` | `integer` | Count of lines that errored |
| `speakers` | `array[string]` | Distinct speaker labels found in the script |
| `voice_map` | `object` | Final speaker → voice UUID map (defaults + overrides) |
| `emotion_map` | `object` | Final speaker → emotion map (defaults + overrides) |
| `voice_display_names` | `object` | Voice UUID → human-readable display name |
| `per_line_voices` | `array[string]` | Voice UUID used for each line, in script order |
| `per_line_emotions` | `array[string]` | Emotion used for each line, in script order |
| `per_line_speakers` | `array[string]` | Speaker label for each line, in script order |
| `per_line_text` | `array[string]` | Text for each line, in script order |
| `total_ms` | `integer` | Sum of per-line wall-clock time |
| `per_line_ttfb_ms` | `array[int\|null]` | Time-to-first-byte per line in milliseconds. `null` if the line errored. |
| `audio_url` | `string` | Path to stream the stitched MP3 |
| `errors` | `array[object]` | Present only when at least one line failed. Each entry has `order`, `speaker`, `error`. |

### Response `400`

```json
{"error": "Missing required field: 'script'"}
```

```json
{"error": "No speakable lines found in script"}
```

### Response `500`

```json
{"error": "TELNYX_API_KEY is not set"}
```

**Try it:**

```bash
curl -X POST http://localhost:5050/narrate \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Scene 1",
    "script": "Narrator: Hello world.\nBob: Hi there.\nAlice: Welcome.",
    "emotions": {"Bob": "excited", "Alice": "calm"}
  }'
```

---

## `GET /audio/<project_id>.mp3`

Stream the stitched MP3 for a project. Projects expire from memory after 1 hour.

### Response `200`

Binary MP3 audio with `Content-Type: audio/mpeg`.

### Response `404`

```json
{"error": "project not found"}
```

**Try it:**

```bash
curl -o scene.mp3 http://localhost:5050/audio/narr-a1b2c3d4.mp3
ffprobe scene.mp3
```

---

## `GET /recommended-voices`

Return the curated list of 8 Telnyx Ultra voices with use-case descriptions.

### Response `200`

```json
{
  "voices": [
    {
      "id": "Telnyx.Ultra.00967b2f-88a6-4a31-8153-110a92134b9f",
      "name": "Asher",
      "gender": "Male",
      "language": "en",
      "model": "Ultra",
      "use_case": "Voice Assistants & Media",
      "sound_profile": "Smooth, dynamic, podcaster-style tone"
    }
  ]
}
```

---

## `GET /emotions`

Return the list of 20 Ultra SSML emotions and the default emotion map.

### Response `200`

```json
{
  "emotions": ["neutral", "angry", "excited", "content", "sad", "scared", "happy", "enthusiastic", "curious", "calm", "grateful", "affectionate", "sarcastic", "surprised", "confident", "hesitant", "apologetic", "determined", "frustrated", "disappointed"],
  "default_emotion_map": {
    "Narrator": "calm",
    "Cassius": "determined",
    "Caesar": "surprised",
    "Brutus": "apologetic",
    "Mark Antony": "angry"
  }
}
```

---

## `POST /preview`

Render a short sample line in a given voice with an optional emotion. Returns binary MP3 for the browser UI's Preview button.

### Request

```json
{
  "voice": "Telnyx.Ultra.00967b2f-88a6-4a31-8153-110a92134b9f",
  "text": "Hello, this is a voice preview from Telnyx.",
  "text_type": "text"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `voice` | `string` | **yes** | `Telnyx.Ultra.<voice_uuid>` |
| `text` | `string` | no | Sample text (default: `"Hello, this is a voice preview from Telnyx."`, max 300 chars) |
| `text_type` | `string` | no | `text` or `ssml` (default: `text`). Set to `ssml` when the text contains `<emotion>` tags. |

### Response `200`

Binary MP3 audio with `Content-Type: audio/mpeg`.

---

## `GET /samples`

Return the preset sample scripts for the demo UI.

### Response `200`

```json
{
  "scripts": {
    "Julius Caesar — the Ides of March": "Cassius:\nThis is our moment..."
  }
}
```

---

## `GET /voices`

Return the default voice map and display names for the demo UI.

### Response `200`

```json
{
  "default_voice_map": {
    "Narrator": "Telnyx.Ultra.01eaafa9-308a-4276-a017-6ab0cf061b1f",
    "Bob": "Telnyx.Ultra.00967b2f-88a6-4a31-8153-110a92134b9f",
    "Alice": "Telnyx.Ultra.00a77add-48d5-4ef6-8157-71e5437b282d",
    "Carol": "Telnyx.Ultra.2747b6cf-fa34-460c-97db-267566918881"
  },
  "display_names": {
    "Telnyx.Ultra.00967b2f-88a6-4a31-8153-110a92134b9f": "Asher (Ultra, M, en)",
    "Telnyx.Ultra.00a77add-48d5-4ef6-8157-71e5437b282d": "Callie (Ultra, F, en)"
  },
  "fallback_voice": "Telnyx.Ultra.01eaafa9-308a-4276-a017-6ab0cf061b1f"
}
```

---

## `GET /projects`

List recent render projects (metadata only, no audio bytes).

### Response `200`

```json
{
  "projects": [
    {
      "id": "narr-a1b2c3d4",
      "title": "Scene 1 — Coffee Shop",
      "lines_rendered": 4,
      "created_at": 1722782400.0
    }
  ]
}
```

---

## `GET /telnyx-logo.svg`

Serve the Telnyx logo SVG (green mark + cream wordmark) for the demo UI.

### Response `200`

SVG with `Content-Type: image/svg+xml`.

---

## `GET /health`

Liveness check.

### Response `200`

```json
{"status": "ok", "uptime_s": 3600}
```
