# AI Translation Bridge — Web Demo

Browser-based demo of the AI Real-Time Translation Bridge. Uses the same Telnyx AI Inference API as the phone-call code sample, but in a visual interface with dual chat panels and a live pipeline visualization.

## Run

```bash
cp .env.example .env          # add your TELNYX_API_KEY
pip install -r requirements.txt
python app.py                 # open http://127.0.0.1:5001
```

Get an API key at https://portal.telnyx.com/#/app/ai/keys.

## What it shows

- Two chat panels (Caller A / Caller B) with language selectors
- Live pipeline animation: Speech → STT → AI Translate → TTS
- Real translation via Telnyx AI Inference (model: `zai-org/GLM-5.1-FP8`)
- 12 languages: English, Spanish, French, German, Italian, Portuguese, Hindi, Arabic, Chinese, Japanese, Korean, Russian

## How it maps to the phone-call sample

| Phone call sample | This demo |
|---|---|
| Caller speaks into phone | Type in Caller A/B input |
| Telnyx Call Control webhook | `/translate` endpoint |
| STT via Telnyx Call Control | Simulated (text input) |
| `translate()` → AI Inference | Same — real API call |
| TTS played back to caller | Translated text appears in panel |

The translation engine is identical — same endpoint, same model, same system prompt. The demo just replaces telephony I/O with a web UI.

## Files

- `app.py` — Flask backend, `/translate` calls Telnyx AI Inference
- `templates/index.html` — web UI (single file, no build step)
- `requirements.txt` — Flask, requests, python-dotenv
- `.env.example` — config template
