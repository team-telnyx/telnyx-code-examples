#!/usr/bin/env node
"use strict";

/**
 * Build a complete voice AI agent with Telnyx — inbound call handling,
 * AI conversation via Telnyx Inference, and call control.
 */

require("dotenv").config();
const express = require("express");
const crypto = require("crypto");

const app = express();

// Telnyx client — used for Call Control actions (answer/speak/gather/etc.).
const Telnyx = require("telnyx");
const telnyx = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

// Verify the Telnyx Ed25519 webhook signature (version-proof; stdlib only — no SDK dependency).
function verifyTelnyxSignature(rawBody, headers, toleranceSec = 300) {
  const sig = headers["telnyx-signature-ed25519"];
  const ts = headers["telnyx-timestamp"];
  const pub = process.env.TELNYX_PUBLIC_KEY;
  if (!sig || !ts || !pub) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > toleranceSec) return false;
  try {
    const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pub, "base64")]);
    const key = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(`${ts}|${rawBody}`), key, Buffer.from(sig, "base64"));
  } catch (e) { return false; }
}

// Capture the RAW request body on the webhook route so the Telnyx signature
// can be verified against the exact bytes that were signed. This MUST be
// mounted before any global JSON parser — otherwise express.json() would
// consume the stream first and req.body would be a parsed object, making
// signature verification run over "[object Object]" and reject every webhook.
// JSON parsing for this route happens after verification, inside the handler.
app.use("/webhooks/voice", express.raw({ type: "*/*" }));
// All other (non-Telnyx) routes use standard JSON parsing.
app.use(express.json());

const AI_MODEL = process.env.AI_MODEL || "meta-llama/Llama-3.3-70B-Instruct";
const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  "You are a helpful voice AI agent for a business. " +
    "Keep responses concise — under 2 sentences — since this is a phone call. " +
    "Be natural and conversational.";
const TRANSFER_NUMBER = process.env.TRANSFER_NUMBER || "";
const PORT = parseInt(process.env.PORT || "5000", 10);

// In-memory conversation store (use Redis in production)
const conversations = new Map();

/**
 * Call Telnyx Inference API (OpenAI-compatible).
 */
async function callTelnyxInference(messages) {
  const response = await fetch("https://api.telnyx.com/v2/ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages,
      max_tokens: 150,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    throw new Error(`Inference API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * Get AI response with conversation history.
 */
async function getAiResponse(callControlId, userInput) {
  if (!conversations.has(callControlId)) {
    conversations.set(callControlId, [{ role: "system", content: SYSTEM_PROMPT }]);
  }

  const history = conversations.get(callControlId);
  history.push({ role: "user", content: userInput });

  const aiResponse = await callTelnyxInference(history);
  history.push({ role: "assistant", content: aiResponse });

  // Keep history manageable
  if (history.length > 21) {
    conversations.set(callControlId, [history[0], ...history.slice(-20)]);
  }

  return aiResponse;
}

/**
 * Handle all voice webhook events.
 */
app.post("/webhooks/voice", async (req, res) => {
  // req.body is a raw Buffer here (express.raw above). Guard against a
  // misconfigured pipeline that hands us a parsed object instead of bytes.
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");

  // Verify the Telnyx Ed25519 webhook signature against the RAW request body
  // before trusting any event data.
  if (!verifyTelnyxSignature(rawBody.toString(), req.headers)) {
    return res.status(401).json({ error: "invalid signature" });
  }

  try {
    // Parse only AFTER the signature has been verified.
    const { data } = JSON.parse(rawBody.toString());
    if (!data) return res.status(400).json({ error: "No payload" });

    const eventType = data.event_type;
    const payload = data.payload || {};
    const callControlId = payload.call_control_id;

    switch (eventType) {
      case "call.initiated":
        if (payload.direction === "incoming") {
          await telnyx.calls.actions.answer(callControlId);
        }
        return res.json({ status: "answering" });

      case "call.answered":
        await telnyx.calls.actions.speak(callControlId, {
          payload: "Hi, thanks for calling. How can I help you today?",
          voice: "female",
          language_code: "en-US",
        });
        return res.json({ status: "greeting" });

      case "call.speak.ended":
        await telnyx.calls.actions.gather(callControlId, {
          input_type: "speech",
          end_silence_timeout_secs: 2,
          timeout_secs: 15,
          language_code: "en-US",
        });
        return res.json({ status: "listening" });

      case "call.gather.ended": {
        const speech = payload.speech?.result || "";

        if (!speech) {
          await telnyx.calls.actions.speak(callControlId, {
            payload: "I didn't catch that. Could you repeat?",
            voice: "female",
            language_code: "en-US",
          });
          return res.json({ status: "reprompting" });
        }

        const aiResponse = await getAiResponse(callControlId, speech);

        await telnyx.calls.actions.speak(callControlId, {
          payload: aiResponse,
          voice: "female",
          language_code: "en-US",
        });
        return res.json({ status: "responding", response: aiResponse });
      }

      case "call.hangup":
        conversations.delete(callControlId);
        return res.json({ status: "call_ended" });

      default:
        return res.json({ status: "event_received", event_type: eventType });
    }
  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", active_calls: conversations.size });
});

app.listen(PORT, () => {
  console.log(`Voice AI agent listening on port ${PORT}`);
});
