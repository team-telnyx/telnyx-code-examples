// Inbound voice call handling via Telnyx Voice API (Call Control v2).
// Answers calls, uses STT to transcribe speech, pipes through AI, speaks
// answers back via TTS. Same AI pipeline as SMS.
import { setting } from "./settings.js";

const TELNYX_API = "https://api.telnyx.com/v2";

// In-memory map of active calls — keyed by call_control_id
const activeCalls = new Map();

// ---------------------------------------------------------------------------
// Voice API helpers
// ---------------------------------------------------------------------------
async function voiceAction(callControlId, action, params = {}) {
  const resp = await fetch(`${TELNYX_API}/calls/${encodeURIComponent(callControlId)}/actions/${action}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${setting("TELNYX_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`Voice ${action} failed (${resp.status}): ${err.errors?.[0]?.detail || "unknown"}`);
  }
  return resp.json();
}

async function answerCall(callControlId) {
  return voiceAction(callControlId, "answer");
}

async function speakText(callControlId, text) {
  return voiceAction(callControlId, "speak", {
    payload: text,
    voice: "female",
    language: "en-US",
  });
}

async function startTranscription(callControlId) {
  return voiceAction(callControlId, "transcription_start", {
    language: "en",
    transcription_engine: "A",
  });
}

async function hangup(callControlId) {
  return voiceAction(callControlId, "hangup");
}

// ---------------------------------------------------------------------------
// Voice webhook event handler
// ---------------------------------------------------------------------------
export async function handleVoiceEvent(payload, db, ssePublish, processInbound) {
  const data = payload.data || {};
  const eventType = data.event_type || "";
  const p = data.payload || {};
  const callControlId = p.call_control_id || "";

  if (!callControlId) return { status: "ignored" };

  // call.initiated — answer the call
  if (eventType === "call.initiated") {
    const direction = p.direction || "";
    if (direction !== "incoming") return { status: "ignored" };

    const callerPhone = p.from || "";
    activeCalls.set(callControlId, { phone: callerPhone, state: "answering" });
    ssePublish("channel.voice", { direction: "inbound", from: callerPhone, event: "initiated" });

    try {
      await answerCall(callControlId);
    } catch (err) {
      console.error("Answer failed:", err.message);
      activeCalls.delete(callControlId);
    }
    return { status: "answering" };
  }

  // call.answered — greet and start listening
  if (eventType === "call.answered") {
    const call = activeCalls.get(callControlId) || {};
    call.state = "greeting";
    activeCalls.set(callControlId, call);

    ssePublish("channel.voice", { from: call.phone, event: "answered" });

    try {
      await speakText(callControlId, "Welcome to Nomad Gateway. Ask me anything — I have access to Wikipedia and maps, even offline. Go ahead.");
    } catch (err) {
      console.error("Greeting speak failed:", err.message);
    }
    return { status: "greeted" };
  }

  // call.speak.ended — greeting or answer finished, start listening
  if (eventType === "call.speak.ended") {
    const call = activeCalls.get(callControlId) || {};
    call.state = "listening";
    activeCalls.set(callControlId, call);

    try {
      await startTranscription(callControlId);
    } catch (err) {
      console.error("Transcription start failed:", err.message);
    }
    return { status: "listening" };
  }

  // call.transcription — received speech-to-text result
  if (eventType === "call.transcription") {
    const transcript = p.transcription_data?.transcript || "";
    if (!transcript || transcript.trim().length < 2) return { status: "empty_transcript" };

    const call = activeCalls.get(callControlId) || {};
    const callerPhone = call.phone || "unknown";
    call.state = "processing";
    activeCalls.set(callControlId, call);

    ssePublish("channel.voice", { from: callerPhone, event: "transcription", text: transcript });

    // Stop transcription while we process
    try {
      await voiceAction(callControlId, "transcription_stop");
    } catch { /* may already be stopped */ }

    // Process through the same AI pipeline as SMS
    // But instead of sending SMS, we speak the answer back
    const answer = await getAiAnswer(db, ssePublish, callerPhone, transcript);

    try {
      await speakText(callControlId, answer);
      call.state = "speaking";
      activeCalls.set(callControlId, call);
    } catch (err) {
      console.error("Answer speak failed:", err.message);
      activeCalls.delete(callControlId);
    }
    return { status: "answered" };
  }

  // call.hangup — clean up
  if (eventType === "call.hangup") {
    const call = activeCalls.get(callControlId) || {};
    ssePublish("channel.voice", { from: call.phone, event: "hangup" });
    activeCalls.delete(callControlId);
    return { status: "hangup" };
  }

  return { status: "ignored" };
}

// ---------------------------------------------------------------------------
// Get AI answer for voice — reuses the SMS AI pipeline but captures the
// answer text instead of sending it as SMS.
// ---------------------------------------------------------------------------
async function getAiAnswer(db, ssePublish, phone, question) {
  // We import processInbound's internals indirectly — for voice we need
  // the answer text rather than sending SMS. Use a simplified flow.
  const { storeMessage, getConversationHistory } = await import("./ai.js");
  const { searchKiwix, getKiwixArticle, semanticSearch, searchMaps } = await import("./knowledge.js");

  await storeMessage(db, phone, "user", question, "voice");

  const history = await getConversationHistory(db, phone);
  const historyText = history.slice(-10).map((m) => `${m.role}: ${m.content}`).join("\n");

  // Simple one-shot inference for voice (no tool loop — keep latency low)
  const [kiwixResults, semanticResults] = await Promise.all([
    searchKiwix(question),
    semanticSearch(db, question),
  ]);

  let context = "";
  if (semanticResults.length) {
    context = "\n\nRelevant knowledge:\n" + semanticResults.map((r) => `${r.title}: ${r.content}`).join("\n\n");
  } else if (kiwixResults.length) {
    // Fetch first article for context
    const first = kiwixResults[0];
    const article = await getKiwixArticle(first.zim, first.path);
    if (article) context = `\n\nWikipedia article "${first.title}":\n${article.slice(0, 2000)}`;
  }

  const systemPrompt = `You are Nomad Gateway, a voice assistant with access to Wikipedia and maps.
Answer the caller's question concisely — they're on a phone call.
Keep answers under 3 sentences. Cite Wikipedia if you used it.
${context}`;

  // Try Telnyx AI, fall back to Ollama
  let answer = "I'm sorry, I couldn't process your question. Please try again.";
  try {
    const resp = await fetch("https://api.telnyx.com/v2/ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${setting("TELNYX_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: setting("AI_MODEL") || "meta-llama/Llama-3.3-70B-Instruct",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: question },
        ],
        max_tokens: 512,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (resp.ok) {
      const data = await resp.json();
      answer = data.choices?.[0]?.message?.content || answer;
    } else {
      throw new Error(`Telnyx AI ${resp.status}`);
    }
  } catch {
    // Fall back to Ollama
    const ollamaHost = setting("OLLAMA_HOST");
    if (ollamaHost) {
      try {
        const resp = await fetch(`${ollamaHost}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: setting("OLLAMA_MODEL") || "llama3.2",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: question },
            ],
            stream: false,
          }),
          signal: AbortSignal.timeout(60_000),
        });
        if (resp.ok) {
          const data = await resp.json();
          answer = data.message?.content || answer;
        }
      } catch { /* use default answer */ }
    }
  }

  await storeMessage(db, phone, "assistant", answer, "voice");
  ssePublish("channel.voice", { from: phone, event: "ai_response", text: answer });

  return answer;
}

export { activeCalls };
