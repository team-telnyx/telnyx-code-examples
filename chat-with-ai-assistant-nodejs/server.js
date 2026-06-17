#!/usr/bin/env node
/**
 * Production-ready Express endpoint for chatting with Telnyx AI Assistants.
 */

const Telnyx = require("telnyx");
const express = require("express");
require("dotenv").config();

const app = express();
app.use(express.json());

// Initialize client with the SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

/**
 * Send a message to an AI Assistant and retrieve the response.
 * @param {string} assistantId - The ID of the AI Assistant.
 * @param {string} message - The user's message.
 * @returns {Promise<Object>} JSON-serializable response data.
 */
async function chatWithAssistant(assistantId, message) {
  if (!assistantId) {
    throw new Error("AI_ASSISTANT_ID environment variable not set");
  }

  if (!message || message.trim().length === 0) {
    throw new Error("Message cannot be empty");
  }

  // Use client.ai_assistants.chat() to send message and get response
  const response = await client.ai_assistants.chat(assistantId, {
    messages: [
      {
        role: "user",
        content: message,
      },
    ],
  });

  // Extract serializable data — SDK objects are NOT JSON-serializable
  return {
    assistant_id: assistantId,
    user_message: message,
    assistant_response: response.data.result,
    timestamp: new Date().toISOString(),
  };
}

/**
 * POST /chat
 * Send a message to the AI Assistant and receive a response.
 */
app.post("/chat", async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Missing required field: 'message'" });
  }

  try {
    const assistantId = process.env.AI_ASSISTANT_ID;
    const result = await chatWithAssistant(assistantId, message);
    return res.status(200).json(result);
  } catch (error) {
    // Handle Telnyx-specific errors in the route handler
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof Telnyx.RateLimitError) {
      return res
        .status(429)
        .json({ error: "Rate limit exceeded. Please slow down." });
    }
    if (error instanceof Telnyx.APIStatusError) {
      return res.status(error.status_code || 500).json({
        error: error.message,
        status_code: error.status_code,
      });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res
        .status(503)
        .json({ error: "Network error connecting to Telnyx" });
    }
    // Handle validation errors
    if (error.message.includes("environment variable")) {
      return res.status(500).json({ error: error.message });
    }
    return res.status(400).json({ error: error.message });
  }
});

/**
 * GET /health
 * Health check endpoint.
 */
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI Chat server running on http://localhost:${PORT}`);
});
