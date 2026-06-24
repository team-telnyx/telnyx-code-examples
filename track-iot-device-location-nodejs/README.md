# Device Location with Node.js and Express

## What Does This Example Do?

Build a production-ready Express application that tracks SIM card device locations using the Telnyx IoT API. This tutorial demonstrates how to retrieve SIM card details, monitor network attachment events via webhooks, and expose location data through REST endpoints. You'll learn the new client-based SDK initialization pattern, proper error handling for telecom APIs, and secure credential management via environment variables.

## Who Is This For?

- **Node.js developers** building iot features with Express.
- **Backend engineers** integrating telephony or messaging into existing applications.
- **DevOps teams** looking for containerized, production-ready telecom examples.
- **Startups and enterprises** replacing legacy telecom providers with a modern API-first platform.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform that gives developers a single API for [voice](https://telnyx.com/products/voice-ai-agents), [messaging](https://telnyx.com/products/sms-api), [SIP](https://telnyx.com/products/sip-trunks), [AI](https://telnyx.com/ai-assistants), and [IoT](https://telnyx.com/products/iot-sim-card) — no Frankenstack required.

- **Integrated platform** — [Voice](https://telnyx.com/products/voice-ai-agents), [SMS](https://telnyx.com/products/sms-api), [SIP trunking](https://telnyx.com/products/sip-trunks), [AI assistants](https://telnyx.com/ai-assistants), and [IoT SIM management](https://telnyx.com/products/iot-sim-card) under one roof. No stitching together multiple vendors.
- **Global private network** — Calls and messages traverse the Telnyx-owned IP network for lower latency and higher reliability than the public internet.
- **Developer-first** — SDKs for Python, Node.js, Go, Ruby, Java, and PHP. Comprehensive webhook event model. Sandbox environment for testing.
- **Competitive pricing** — Pay-as-you-go with no minimums, contracts, or per-seat fees.

## Prerequisites

- Node.js 16 or higher.
- npm (Node package manager).
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- At least one active SIM card in your Telnyx account.
- A publicly accessible URL for webhook testing (ngrok or similar for local development).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/track-iot-device-location-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create helper functions to retrieve SIM card details and network information. Add this to `app.js`:

```javascript
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
```

Add Express routes to expose location and status data:

```javascript
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
```

Add a health check endpoint and start the server:

```javascript
/**
 * GET /health
 * Health check endpoint for monitoring.
 */
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Device location service running on port ${PORT}`);
  console.log(`Webhook URL: ${process.env.WEBHOOK_URL}`);
});
```

## Complete Code

See [`server.js`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/track-iot-device-location-nodejs/server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Node.js server. |
| SIM Card Not Found (404) | You receive a 404 error when querying a specific SIM card ID. | Confirm the SIM card ID exists in your Telnyx account by listing all SIM cards with `GET /sim-cards`. Copy the exact ID from the response and use it in the location endpoint. Verify the SIM card has not been deleted or archived. |
| Webhook Events Not Received | The `/webhooks/sim-status` endpoint is not receiving events from Telnyx. | Ensure your webhook URL is publicly accessible and correctly configured in the [Telnyx Portal](https://portal.telnyx.com) under IoT → Webhooks. If testing locally, use ngrok to expose your server: `ngrok http 3000`. Update the webhook URL in your `.env` file and the portal to match the ngrok URL. Verify your firewall allows inbound HTTPS traffic on port 443. |
| Network Status Always "Unknown" | The `networkStatus` field returns "unknown" for all SIM cards. | Network status is only populated when a SIM card is actively attached to a network. Ensure your IoT device is powered on and has a valid data plan. Network attachment events are sent via webhooks; monitor the webhook endpoint logs to confirm events are being received. |
| Rate Limit Errors (429) | Requests return `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | The Telnyx API enforces rate limits. Implement exponential backoff in your client code and cache SIM card data when possible. Avoid polling the same SIM card more than once per minute. Consider using webhooks instead of polling for real-time updates. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this IoT example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What Node.js version do I need?**

Node.js 18 or higher. Node.js 20 LTS is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [IoT SIM Get Started](https://developers.telnyx.com/docs/iot-sim/get-started)
- [SIM Card API Reference](https://developers.telnyx.com/api-reference/sim-cards/get-all-sim-cards)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx IoT SIM Cards](https://telnyx.com/products/iot-sim-card)
- [IoT Data Plans Pricing](https://telnyx.com/pricing/iot-data-plans)

## Related Examples

- [Monitor SIM Card Data Usage](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/nodejs/data-usage-monitoring).
- [Activate SIM Cards Programmatically](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/nodejs/sim-activation).
- [Receive SIM Status Change Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/nodejs/sim-status-webhook).
