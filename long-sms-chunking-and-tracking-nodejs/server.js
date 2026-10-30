#!/usr/bin/env node

require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const Telnyx = require("telnyx");

const app = express();
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });
const deliveries = new Map();

function requireEnv(name) {
  if (!process.env[name]) throw new Error(`${name} environment variable not set`);
  return process.env[name];
}

function isE164(value) {
  return typeof value === "string" && /^\+\d{1,15}$/.test(value);
}

function verifyTelnyxSignature(rawBody, headers, toleranceSec = 300) {
  const signature = headers["telnyx-signature-ed25519"];
  const timestamp = headers["telnyx-timestamp"];
  const publicKey = process.env.TELNYX_PUBLIC_KEY;
  if (!signature || !timestamp || !publicKey) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSec) return false;

  try {
    const der = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(publicKey, "base64"),
    ]);
    const key = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
    return crypto.verify(
      null,
      Buffer.from(`${timestamp}|${rawBody}`),
      key,
      Buffer.from(signature, "base64")
    );
  } catch {
    return false;
  }
}

function getChunkId(payload) {
  return payload.child_message_id || payload.id || null;
}

function updateDelivery(payload, eventType) {
  const chunkId = getChunkId(payload);
  const parentId = payload.parent_message_id || chunkId;
  if (!chunkId || !parentId) throw new Error("Webhook payload is missing message identifiers");

  const current = deliveries.get(parentId) || {
    parent_message_id: parentId,
    chunks: {},
    status: "pending",
    updated_at: new Date().toISOString(),
  };

  current.chunks[chunkId] = {
    child_message_id: chunkId,
    event: eventType,
    status: payload.to?.[0]?.status || payload.status || eventType,
    errors: payload.errors || [],
    updated_at: new Date().toISOString(),
  };

  if (eventType === "message.finalized" && payload.to?.[0]?.status === "failed") {
    current.status = "failed";
    current.cancelled = true;
  } else if (eventType === "message.finalized") {
    current.status = "finalized";
  } else if (eventType === "message.sent") {
    current.status = "sent";
  }

  current.updated_at = new Date().toISOString();
  deliveries.set(parentId, current);
  return current;
}

async function enableLongMessageChunking() {
  const profileId = requireEnv("TELNYX_MESSAGING_PROFILE_ID");
  const response = await client.messagingProfiles.update(profileId, {
    features: { auto_chunk_long_messages: true },
  });
  return response.data;
}

async function sendLongSms(to, text) {
  const from = requireEnv("TELNYX_PHONE_NUMBER");
  if (!isE164(to)) throw new Error("'to' must be an E.164 phone number");
  if (typeof text !== "string" || text.length <= 1530) {
    throw new Error("'text' must be longer than 1,530 characters for this demo");
  }

  const response = await client.messages.send({ from, to, text });
  const message = response.data;
  const parentId = message.id;
  deliveries.set(parentId, {
    parent_message_id: parentId,
    chunks: {},
    status: "queued",
    text_length: text.length,
    child_message_id: message.child_message_id || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  return {
    parent_message_id: parentId,
    child_message_id: message.child_message_id || null,
    status: message.to?.[0]?.status || "queued",
    text_length: text.length,
  };
}

async function sendSms(to, text) {
  const from = requireEnv("TELNYX_PHONE_NUMBER");
  if (!isE164(to)) throw new Error("'to' must be an E.164 phone number");
  if (typeof text !== "string" || text.length === 0 || text.length > 1600) {
    throw new Error("'text' must be between 1 and 1,600 characters");
  }
  const response = await client.messages.send({ from, to, text });
  return {
    message_id: response.data.id,
    status: response.data.to?.[0]?.status || "queued",
  };
}

// Keep the webhook route ahead of express.json() so the signature uses raw bytes.
app.post("/webhooks/messaging", express.raw({ type: "*/*" }), (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  if (!verifyTelnyxSignature(rawBody.toString(), req.headers)) {
    return res.status(401).json({ error: "invalid signature" });
  }

  try {
    const event = JSON.parse(rawBody.toString());
    const eventType = event.data?.event_type;
    const payload = event.data?.payload;
    if (!eventType || !payload || !["message.sent", "message.finalized"].includes(eventType)) {
      return res.status(400).json({ error: "unsupported or invalid messaging event" });
    }
    const delivery = updateDelivery(payload, eventType);
    console.log(`[${eventType}] parent=${delivery.parent_message_id} chunks=${Object.keys(delivery.chunks).length}`);
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Webhook processing error:", error.message);
    return res.status(400).json({ error: "invalid webhook payload" });
  }
});

app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.post("/profile/enable-chunking", async (req, res) => {
  try {
    const profile = await enableLongMessageChunking();
    return res.json({ profile_id: profile.id, auto_chunk_long_messages: profile.features?.auto_chunk_long_messages });
  } catch (error) {
    console.error("Messaging profile update failed:", error.message);
    if (error instanceof Telnyx.AuthenticationError) return res.status(401).json({ error: "invalid API key" });
    return res.status(error.status || 500).json({ error: "could not update messaging profile" });
  }
});

app.post("/sms/send-long", async (req, res) => {
  try {
    return res.status(200).json(await sendLongSms(req.body?.to, req.body?.text));
  } catch (error) {
    if (error.message.includes("E.164") || error.message.includes("1,530") || error.message.includes("environment")) {
      return res.status(400).json({ error: error.message });
    }
    console.error("Long SMS send failed:", error.message);
    if (error instanceof Telnyx.AuthenticationError) return res.status(401).json({ error: "invalid API key" });
    return res.status(error.status || 500).json({ error: "could not send long SMS" });
  }
});

app.post("/sms/send", async (req, res) => {
  try {
    return res.status(200).json(await sendSms(req.body?.to, req.body?.text));
  } catch (error) {
    if (error.message.includes("E.164") || error.message.includes("between") || error.message.includes("environment")) {
      return res.status(400).json({ error: error.message });
    }
    console.error("SMS send failed:", error.message);
    if (error instanceof Telnyx.AuthenticationError) return res.status(401).json({ error: "invalid API key" });
    return res.status(error.status || 500).json({ error: "could not send SMS" });
  }
});

app.get("/deliveries/:parentMessageId", (req, res) => {
  const delivery = deliveries.get(req.params.parentMessageId);
  if (!delivery) return res.status(404).json({ error: "delivery not found" });
  return res.json(delivery);
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Long SMS server running on http://localhost:${port}`));
