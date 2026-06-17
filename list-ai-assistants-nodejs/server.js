#!/usr/bin/env node
/**
 * Production-ready Express server for listing AI assistants via Telnyx.
 * Demonstrates proper error handling, serialization, and environment configuration.
 */

const express = require("express");
const Telnyx = require("telnyx");
require("dotenv").config();

const app = express();

// Initialize Telnyx client with API key from environment
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

// Middleware to parse JSON request bodies
app.use(express.json());

/**
 * Fetch all AI assistants from Telnyx.
 * Returns a plain JavaScript object array suitable for JSON serialization.
 */
async function listAssistants() {
  // Call the Telnyx API to list all assistants
  const response = await client.ai_assistants.list();

  // Extract serializable fields from each assistant object
  // SDK objects are NOT JSON-serializable — always unpack to plain objects
  return response.data.map((assistant) => ({
    id: assistant.id,
    name: assistant.name,
    model: assistant.model,
    instructions: assistant.instructions,
    enabled_features: assistant.enabled_features,
    created_at: assistant.created_at,
  }));
}

/**
 * GET /assistants
 * Retrieve all AI assistants from the Telnyx account.
 * Returns a JSON array of assistant objects.
 */
app.get("/assistants", async (req, res) => {
  try {
    const assistants = await listAssistants();
    res.status(200).json({
      success: true,
      count: assistants.length,
      data: assistants,
    });
  } catch (error) {
    // Handle Telnyx-specific errors with appropriate HTTP status codes
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({
        error: "Invalid API key. Verify TELNYX_API_KEY in your environment.",
      });
    }

    if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({
        error: "Rate limit exceeded. Please retry after a short delay.",
      });
    }

    if (error instanceof Telnyx.APIStatusError) {
      return res.status(error.status || 500).json({
        error: error.message,
        status_code: error.status,
      });
    }

    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({
        error: "Network error connecting to Telnyx. Please try again later.",
      });
    }

    // Catch-all for unexpected errors
    console.error("Unexpected error:", error);
    res.status(500).json({
      error: "Internal server error. Check logs for details.",
    });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Start the Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`List assistants: curl http://localhost:${PORT}/assistants`);
  console.log(`Health check: curl http://localhost:${PORT}/health`);
});
