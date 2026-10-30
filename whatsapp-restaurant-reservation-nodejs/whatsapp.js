// WhatsApp messaging via Telnyx API — text, interactive list, interactive buttons.
// Also handles audio transcription for voice notes.
import { setting } from "./settings.js";

const WA_API = "https://api.telnyx.com/v2/messages/whatsapp";
const TRANSCRIPTION_API = "https://api.telnyx.com/v2/ai/audio/transcriptions";

const ALLOWED_AUDIO_DOMAINS = [".telnyx.com", ".telnyxcloudstorage.com"];

function waHeaders() {
  const key = setting("TELNYX_WHATSAPP_API_KEY") || setting("TELNYX_API_KEY");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

function waBase() {
  return {
    from: setting("WHATSAPP_NUMBER"),
    to: null,
    messaging_profile_id: setting("WHATSAPP_MESSAGING_PROFILE_ID"),
  };
}

export async function sendText(to, text) {
  const resp = await fetch(WA_API, {
    method: "POST",
    headers: waHeaders(),
    body: JSON.stringify({
      ...waBase(),
      to,
      whatsapp_message: { type: "text", text: { body: text } },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`WhatsApp send failed: ${resp.status}`);
  return resp.json();
}

export async function sendList(to, bodyText, buttonText, sections) {
  const resp = await fetch(WA_API, {
    method: "POST",
    headers: waHeaders(),
    body: JSON.stringify({
      ...waBase(),
      to,
      whatsapp_message: {
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: bodyText },
          action: { button: buttonText, sections },
        },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`WhatsApp list send failed: ${resp.status}`);
  return resp.json();
}

export async function sendButtons(to, bodyText, buttons) {
  const resp = await fetch(WA_API, {
    method: "POST",
    headers: waHeaders(),
    body: JSON.stringify({
      ...waBase(),
      to,
      whatsapp_message: {
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: bodyText },
          action: {
            buttons: buttons.slice(0, 3).map((b) => ({
              type: "reply",
              reply: { id: b.id, title: b.title },
            })),
          },
        },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`WhatsApp buttons send failed: ${resp.status}`);
  return resp.json();
}

export async function transcribeAudio(audioUrl) {
  try {
    // Validate URL domain — only allow Telnyx-hosted media (SSRF prevention)
    const host = new URL(audioUrl).hostname.toLowerCase();
    if (!(host === "telnyx.com" || ALLOWED_AUDIO_DOMAINS.some((d) => host.endsWith(d)))) {
      console.warn("Blocked audio download from untrusted host:", host);
      return "[Voice note from untrusted source — skipped]";
    }

    const waKey = setting("TELNYX_WHATSAPP_API_KEY") || setting("TELNYX_API_KEY");
    const audioResp = await fetch(audioUrl, {
      headers: { Authorization: `Bearer ${waKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!audioResp.ok) throw new Error(`Audio download failed: ${audioResp.status}`);
    const audioBuffer = await audioResp.arrayBuffer();

    const contentType = audioResp.headers.get("content-type") || "audio/ogg";
    const ext = contentType.includes("mp4") ? "mp4" : "ogg";
    const blob = new Blob([audioBuffer], { type: contentType });

    const form = new FormData();
    form.append("file", blob, `voice.${ext}`);
    form.append("model", "openai/whisper-large-v3-turbo");

    const apiKey = setting("TELNYX_API_KEY");
    const resp = await fetch(TRANSCRIPTION_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) throw new Error(`Transcription failed: ${resp.status}`);
    const data = await resp.json();
    return data.text || "";
  } catch (err) {
    console.error("Audio transcription failed:", err.message);
    return "";
  }
}
