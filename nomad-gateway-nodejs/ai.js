// Two-tier AI inference — Telnyx AI (online) with Ollama fallback (offline).
// Tool-calling loop with 5 tools: search_knowledge, get_article, search_maps,
// check_system_status, send_sms.
import crypto from "node:crypto";
import { setting } from "./settings.js";
import { sendSms } from "./messaging.js";
import { searchKiwix, getKiwixArticle, semanticSearch, searchMaps } from "./knowledge.js";

const TELNYX_INFERENCE = "https://api.telnyx.com/v2/ai/chat/completions";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
function buildSystemPrompt() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const dayName = now.toLocaleDateString("en-US", { weekday: "long" });

  return `You are Nomad Gateway — a knowledge assistant connected to an offline-capable knowledge base (Wikipedia via Kiwix), maps (OpenStreetMap), and AI inference.

Today is ${dateStr} (${dayName}).

You help people get answers via SMS and voice calls. When the internet is down, you use a local AI model (Ollama) and offline Wikipedia. The user never needs to know which mode you're in — just answer their question.

CRITICAL RULES:
- ALWAYS use the send_sms tool to reply. NEVER put your reply in plain text — it MUST go through send_sms.
- Send EXACTLY ONE SMS per turn. After calling send_sms, STOP.
- Keep messages SHORT — this is SMS, not email. 1-3 sentences max. SMS has segment limits.
- For factual questions, ALWAYS search the knowledge base first using search_knowledge or get_article.
- For location questions, use search_maps.
- Cite your sources briefly: "(Wikipedia)" or "(OpenStreetMap)".
- If you can't find an answer, say so honestly.
- You may call search_knowledge, get_article, search_maps, or check_system_status multiple times before sending your ONE message via send_sms.

System status context:
- You can check if services are online/offline with check_system_status
- Report status honestly if asked ("I'm running on local AI right now" or "All systems online")`;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_knowledge",
      description: "Search the knowledge base (Wikipedia/Kiwix) for articles matching a query. Also performs semantic search if embeddings are available. Returns titles and snippets.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query — a topic, question, or keyword" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_article",
      description: "Fetch the full text of a specific Wikipedia/Kiwix article by ZIM name and path. Use after search_knowledge returns results.",
      parameters: {
        type: "object",
        properties: {
          zim: { type: "string", description: "ZIM file name (from search results)" },
          path: { type: "string", description: "Article path within the ZIM (from search results)" },
        },
        required: ["zim", "path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_maps",
      description: "Search for a geographic location, address, or place using OpenStreetMap/Nominatim. Returns coordinates and place names.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Place name, address, or geographic query" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_system_status",
      description: "Check the current status of all system components: internet connectivity, Kiwix (Wikipedia), Ollama (local AI), Maps, and IoT SIM. Returns which services are online/offline.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "send_sms",
      description: "Send an SMS reply to the user. This is the ONLY way to respond — you must call this exactly once per turn.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient phone number in E.164 format" },
          text: { type: "string", description: "Message text (keep short — SMS has segment limits)" },
        },
        required: ["to", "text"],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Inference — Telnyx AI with Ollama fallback
// ---------------------------------------------------------------------------
async function callTelnyxInference(messages) {
  const resp = await fetch(TELNYX_INFERENCE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${setting("TELNYX_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: setting("AI_MODEL") || "meta-llama/Llama-3.3-70B-Instruct",
      messages,
      tools: TOOLS,
      max_tokens: 4096,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`Telnyx inference failed: ${resp.status}`);
  return resp.json();
}

function normalizeOllamaResponse(data) {
  // Map Ollama's response format to OpenAI-compatible format
  const msg = data.message || {};
  const toolCalls = (msg.tool_calls || []).map((tc, i) => ({
    id: `call_${crypto.randomUUID().slice(0, 8)}`,
    type: "function",
    function: {
      name: tc.function?.name || "",
      arguments: JSON.stringify(tc.function?.arguments || {}),
    },
  }));

  return {
    choices: [{
      message: {
        role: "assistant",
        content: msg.content || null,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      },
    }],
  };
}

async function callOllamaInference(messages) {
  const host = setting("OLLAMA_HOST");
  if (!host) throw new Error("OLLAMA_HOST not configured");

  const resp = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: setting("OLLAMA_MODEL") || "llama3.2",
      messages,
      tools: TOOLS,
      stream: false,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!resp.ok) throw new Error(`Ollama inference failed: ${resp.status}`);
  const data = await resp.json();
  return normalizeOllamaResponse(data);
}

async function callInference(messages) {
  // Try Telnyx AI first (online mode)
  try {
    const result = await callTelnyxInference(messages);
    result._mode = "online";
    return result;
  } catch (err) {
    console.warn("Telnyx AI unavailable, falling back to Ollama:", err.message);
  }

  // Fall back to Ollama (offline mode)
  const result = await callOllamaInference(messages);
  result._mode = "offline";
  return result;
}

// ---------------------------------------------------------------------------
// Conversation helpers
// ---------------------------------------------------------------------------
export async function storeMessage(db, phone, role, content, channel = "sms") {
  await db.prepare(
    "INSERT INTO conversations (id, phone, role, content, channel, timestamp) VALUES (?,?,?,?,?,?)"
  ).bind(crypto.randomUUID(), phone, role, content, channel, new Date().toISOString()).run();
}

async function getConversationHistory(db, phone, limit = 20) {
  const { results } = await db.prepare(
    "SELECT role, content, timestamp FROM conversations WHERE phone = ? ORDER BY timestamp DESC LIMIT ?"
  ).bind(phone, limit).all();
  return results.reverse();
}

async function storeQuery(db, phone, channel, question, answer, source, inferenceMode, latencyMs) {
  await db.prepare(
    "INSERT INTO queries (id, phone, channel, question, answer, source, inference_mode, latency_ms, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
  ).bind(crypto.randomUUID(), phone, channel, question, answer || "", source, inferenceMode, latencyMs, new Date().toISOString()).run();
}

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------
async function executeTool(db, ssePublish, toolName, toolInput, callerPhone) {
  if (toolName === "search_knowledge") {
    const query = toolInput.query || "";
    const [kiwixResults, semanticResults] = await Promise.all([
      searchKiwix(query),
      semanticSearch(db, query),
    ]);
    const evt = { query, kiwix_count: kiwixResults.length, semantic_count: semanticResults.length };
    ssePublish("knowledge.search", evt);
    return JSON.stringify({ kiwix: kiwixResults, semantic: semanticResults });
  }

  if (toolName === "get_article") {
    const content = await getKiwixArticle(toolInput.zim || "", toolInput.path || "");
    ssePublish("knowledge.article", { zim: toolInput.zim, path: toolInput.path, length: content.length });
    return JSON.stringify({ content: content || "Article not found" });
  }

  if (toolName === "search_maps") {
    const results = await searchMaps(toolInput.query || "");
    ssePublish("maps.search", { query: toolInput.query, count: results.length });
    return JSON.stringify({ places: results });
  }

  if (toolName === "check_system_status") {
    const row = await db.prepare("SELECT * FROM system_status WHERE id = 1").first();
    const status = row || { internet_up: 0, kiwix_up: 0, ollama_up: 0, maps_up: 0, iot_sim_status: "unknown" };
    return JSON.stringify({
      internet: status.internet_up ? "online" : "offline",
      kiwix: status.kiwix_up ? "online" : "offline",
      ollama: status.ollama_up ? "online" : "offline",
      maps: status.maps_up ? "online" : "offline",
      iot_sim: status.iot_sim_status,
      mode: status.internet_up ? "cloud (Telnyx AI)" : "local (Ollama)",
    });
  }

  if (toolName === "send_sms") {
    const to = toolInput.to;
    const text = toolInput.text || "";
    await sendSms(to, text);
    await storeMessage(db, to, "assistant", text, "sms");
    ssePublish("channel.sms", { direction: "outbound", text, to });
    return JSON.stringify({ status: "sent" });
  }

  return JSON.stringify({ error: `Unknown tool: ${toolName}` });
}

// ---------------------------------------------------------------------------
// Persist a UI event for cross-instance dashboard sync
// ---------------------------------------------------------------------------
async function persistUiEvent(db, type, payload) {
  try {
    await db.prepare(
      "INSERT INTO ui_events (id, type, payload, created_at) VALUES (?,?,?,?)"
    ).bind(crypto.randomUUID(), type, JSON.stringify(payload), new Date().toISOString()).run();
  } catch (err) { console.warn("persistUiEvent failed:", err.message); }
}

// ---------------------------------------------------------------------------
// Main agentic loop — exported for webhook handlers (SMS + voice)
// ---------------------------------------------------------------------------
export async function processInbound(db, ssePublish, fromNumber, text, channel = "sms") {
  const startTime = Date.now();
  const history = await getConversationHistory(db, fromNumber);
  const historyText = history.map((m) => `${m.role}: ${m.content}`).join("\n");

  const messages = [
    { role: "system", content: buildSystemPrompt() },
    {
      role: "user",
      content: `Caller phone: ${fromNumber}\nChannel: ${channel}\nInbound message: ${text}\n\nRecent conversation:\n${historyText}\n\nAnswer the question. Search the knowledge base if needed. Send your reply via send_sms.`,
    },
  ];

  ssePublish("agent.thinking", { content: `Processing ${channel} from ${fromNumber}...` });

  let inferenceMode = "online";
  let answerText = "";

  for (let i = 0; i < 10; i++) {
    let data;
    try {
      data = await callInference(messages);
      inferenceMode = data._mode || "online";
    } catch (err) {
      console.error("Inference failed:", err.message);
      ssePublish("agent.error", { error: err.message });
      try {
        await sendSms(fromNumber, "Sorry, I'm having trouble right now. Please try again shortly.");
      } catch { /* ignore */ }
      return;
    }

    const choice = data.choices[0];
    const msg = choice.message;

    if (msg.content) ssePublish("agent.thinking", { content: msg.content });

    if (!msg.tool_calls) {
      if (msg.content) {
        try {
          await sendSms(fromNumber, msg.content);
          await storeMessage(db, fromNumber, "assistant", msg.content, channel);
          answerText = msg.content;
          ssePublish("channel.sms", { direction: "outbound", text: msg.content, to: fromNumber });
        } catch (err) {
          console.error("Auto-send failed:", err.message);
          ssePublish("agent.error", { error: err.message });
        }
      }
      ssePublish("agent.done", { content: "Reply sent" });
      break;
    }

    messages.push(msg);
    let messageSent = false;

    for (const tc of msg.tool_calls) {
      const fn = tc.function;
      const toolName = fn.name;
      let toolInput;
      try {
        const raw = fn.arguments || "{}";
        toolInput = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (typeof toolInput !== "object" || toolInput === null) toolInput = {};
      } catch {
        toolInput = {};
      }

      ssePublish("agent.tool_call", { tool: toolName, input: toolInput });
      const result = await executeTool(db, ssePublish, toolName, toolInput, fromNumber);
      ssePublish("agent.tool_result", { tool: toolName, result });

      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
      if (toolName === "send_sms") {
        messageSent = true;
        try { answerText = JSON.parse(result).text || toolInput.text || ""; } catch { answerText = toolInput.text || ""; }
      }
    }

    if (messageSent) {
      ssePublish("agent.done", { content: "Reply sent, waiting for next message" });
      break;
    }
  }

  // Log the query
  const latencyMs = Date.now() - startTime;
  await storeQuery(db, fromNumber, channel, text, answerText, `${inferenceMode}-ai`, inferenceMode, latencyMs);
}

export { getConversationHistory };
