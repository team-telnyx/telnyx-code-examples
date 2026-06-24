#!/usr/bin/env node
/**
 * Production-ready Express application for tracking device location via Telnyx IoT API.
 * Retrieves SIM card network status and receives webhook events for location context.
 */

const express = require("express");
const bodyParser = require("body-parser");
const Telnyx = require("telnyx");
require("dotenv").config();

const app = express();

// Middleware
app.use(bodyParser.json());

// Initialize Telnyx client with the new SDK pattern
const client = new Telnyx({
  apiKey: process.env.TELNYX_API_KEY,
});

/**
 * Retrieve SIM card details including network attachment status.
 * @param {string} simCardId - The SIM card ID.
 * @returns {Promise<Object>} SIM card data with location context.
 */
async function getSimCardLocation(simCardId) {
  const response = await client.simCards.retrieve(simCardId);
  
  // Extract serializable data — SDK objects are NOT JSON-serializable
  return {
    id: response.data.id,
    iccid: response.data.iccid,
    status: response.data.status,
    simCardGroupId: response.data.sim_card_group_id,
    networkStatus: response.data.network_status || "unknown",
    imsi: response.data.imsi || null,
    imei: response.data.imei || null,
    phoneNumber: response.data.phone_number || null,
    createdAt: response.data.created_at,
    updatedAt: response.data.updated_at,
  };
}

/**
 * List all SIM cards with their current network status.
 * @returns {Promise<Array>} Array of SIM card objects.
 */
async function listSimCardsWithStatus() {
  const response = await client.simCards.list();
  
  // Extract serializable data for each SIM card
  return response.data.map((sim) => ({
    id: sim.id,
    iccid: sim.iccid,
    status: sim.status,
    simCardGroupId: sim.sim_card_group_id,
    networkStatus: sim.network_status || "unknown",
    phoneNumber: sim.phone_number || null,
  }));
}

/**
 * GET /health
 * Health check endpoint for monitoring.
 */
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * GET /sim-cards
 * List all SIM cards with their current network status.
 */
app.get("/sim-cards", async (req, res) => {
  try {
    const simCards = await listSimCardsWithStatus();
    res.json(simCards);
  } catch (error) {
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({ error: "Rate limit exceeded. Please slow down." });
    }
    if (error instanceof Telnyx.APIError) {
      return res.status(error.status_code).json({
        error: error.message,
        status_code: error.status_code,
      });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({ error: "Network error connecting to Telnyx" });
    }
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /sim-cards/:id/location
 * Retrieve location context for a specific SIM card.
 */
app.get("/sim-cards/:id/location", async (req, res) => {
  const { id } = req.params;
  
  try {
    const location = await getSimCardLocation(id);
    res.json(location);
  } catch (error) {
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({ error: "Rate limit exceeded. Please slow down." });
    }
    if (error instanceof Telnyx.APIError) {
      return res.status(error.status_code).json({
        error: error.message,
        status_code: error.status_code,
      });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({ error: "Network error connecting to Telnyx" });
    }
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /webhooks/sim-status
 * Receive SIM card status change events (e.g., network attachment).
 * Telnyx sends events like sim_card.network.attached and sim_card.status.changed.
 */
app.post("/webhooks/sim-status", (req, res) => {
  const event = req.body;
  
  // Log the event for debugging
  console.log("Received webhook event:", {
    type: event.type,
    simCardId: event.data?.id,
    status: event.data?.status,
    networkStatus: event.data?.network_status,
    timestamp: new Date().toISOString(),
  });
  
  // Acknowledge receipt immediately to prevent retries
  res.status(200).json({ received: true });
  
  // Process the event asynchronously
  if (event.type === "sim_card.network.attached") {
    console.log(`SIM ${event.data.id} attached to network`);
    // Update your database or trigger location tracking here
  } else if (event.type === "sim_card.status.changed") {
    console.log(`SIM ${event.data.id} status changed to ${event.data.status}`);
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Device location service running on port ${PORT}`);
  console.log(`Webhook URL: ${process.env.WEBHOOK_URL}`);
});
