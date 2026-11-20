# Build an AI Grocery Delivery Assistant on WhatsApp

Build an AI-powered grocery delivery assistant that takes orders via WhatsApp — customers browse products, add items to cart, place orders, track deliveries, and even order by voice note. An operator dashboard shows everything in real time.

## How It Works

```
  WhatsApp User
        |
        v
  Telnyx WhatsApp API
        |
        v
  POST /webhooks/whatsapp
        |
        v
  +------------------+
  | Message Router   |  -- text, interactive, audio
  +--------+---------+
           |
     +-----+------+
     |            |
   text/       audio
  interactive    |
     |           v
     |     Telnyx Audio
     |     Transcription API
     |           |
     +-----+-----+
           |
           v
  +------------------+
  | AI Inference     |  -- tool-calling loop (up to 10 turns)
  | 12 tools         |
  +--------+---------+
           |
     +-----+------+
     |            |
  tool calls   send_whatsapp
     |            |
     v            v
  SQLite DB    Customer
           |
           v
  SSE /stream --> Operator Dashboard
```

## Telnyx Products Used

- **WhatsApp Business API** — Send and receive WhatsApp messages including text, interactive lists, buttons, and images. Handles inbound webhooks for customer messages.
- **AI Inference** — OpenAI-compatible chat completions API with tool calling. Powers the "Mia" assistant that understands natural language grocery requests and orchestrates 12 tools.
- **Number Lookup** — Validates customer phone numbers and normalizes them to E.164 format during registration.
- **Audio Transcription** — Converts WhatsApp voice notes to text using Whisper, enabling voice-based grocery ordering.

## The 12 AI Tools

The AI assistant ("Mia") has access to 12 tools for managing the full grocery ordering flow:

| Tool | Description |
|------|-------------|
| `browse_products` | Search products by keyword or category |
| `add_to_cart` | Add a product to the customer's cart |
| `view_cart` | Show cart contents with prices and total |
| `update_cart` | Change quantity or remove items |
| `get_delivery_slots` | List available delivery windows |
| `place_order` | Convert cart into an order with a delivery slot |
| `track_delivery` | Check order status and delivery pipeline |
| `reschedule_delivery` | Change delivery window for an order |
| `handle_substitution` | Accept, reject, or remove out-of-stock substitutions |
| `reorder` | Repopulate cart from a previous order |
| `register_customer` | Register with name and address (validates phone via Number Lookup) |
| `send_whatsapp` | Send the response message back to the customer |

## Prerequisites

- Node.js 22+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)
- WhatsApp Business Account (WABA) configured in the [Telnyx Portal](https://portal.telnyx.com)
- A WhatsApp-enabled phone number with messaging profile
- [ngrok](https://ngrok.com) for exposing your local server to Telnyx webhooks

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/whatsapp-grocery-delivery-nodejs
cp .env.example .env
npm install
```

Edit `.env` with your credentials:

```
TELNYX_API_KEY=KEYyour-main-api-key-here
TELNYX_WHATSAPP_API_KEY=KEYyour-whatsapp-api-key-here
WHATSAPP_NUMBER=+1XXXXXXXXXX
WHATSAPP_MESSAGING_PROFILE_ID=your-messaging-profile-id-here
AI_MODEL=zai-org/GLM-5.3-Flash
PORT=3000
```

Note: This app uses two API keys — `TELNYX_API_KEY` for AI Inference and Number Lookup, and `TELNYX_WHATSAPP_API_KEY` for WhatsApp messaging (which requires a WABA-enabled account). If the same account has both, you can use the same key for both.

## Step 2: Understand the Code

The project is split into focused modules:

- `server.js` — Express routes, SSE streaming, webhook handler
- `ai.js` — System prompt, tool definitions, inference loop, tool executor
- `whatsapp.js` — WhatsApp messaging (text, list, buttons, image) and audio transcription
- `orders.js` — Cart, orders, delivery slots, substitutions
- `products.js` — Product catalog with search and seeding
- `db.js` — SQLite database (local) or Edge SQL (deployed)
- `settings.js` — Environment variable loader with Edge prefix support

### The Webhook Handler

When a WhatsApp message arrives, the webhook at `POST /webhooks/whatsapp` extracts the message type (text, interactive reply, or audio), deduplicates it, and dispatches to the AI:

```javascript
app.post("/webhooks/whatsapp", (req, res) => {
  const payload = req.body;
  if (!payload) return res.status(400).json({ error: "No payload" });

  const data = payload.data || {};
  const p = data.payload || {};

  if (data.event_type !== "message.received") return res.json({ status: "ignored" });
  if (p.direction !== "inbound") return res.json({ status: "ignored" });

  const fromNumber = p.from?.phone_number || "";
  // ...extract text based on message type...

  // Return 200 immediately, process in background
  res.json({ status: "processing" });

  (async () => {
    await storeMessage(db, fromNumber, "user", text);
    await processInbound(db, ssePublish, fromNumber, text);
  })();
});
```

The handler returns `200` immediately so Telnyx doesn't retry, then processes the message asynchronously.

### The AI Tool-Calling Loop

The core intelligence lives in `ai.js`. The `processInbound` function builds a conversation context (history, customer info, active orders, cart) and enters a tool-calling loop that runs up to 10 turns:

```javascript
export async function processInbound(db, ssePublish, fromNumber, text) {
  const history = await getConversationHistory(db, fromNumber);
  const customer = await db.prepare(
    "SELECT phone, name, address FROM customers WHERE phone = ?"
  ).bind(fromNumber).first();

  const messages = [
    { role: "system", content: buildSystemPrompt() + customerContext + orderContext + cartContext },
    { role: "user", content: `Customer phone: ${fromNumber}\nInbound WhatsApp message: ${text}...` },
  ];

  for (let i = 0; i < 10; i++) {
    const data = await callInference(messages);
    const msg = data.choices[0].message;

    if (!msg.tool_calls) {
      // No more tools — send final text response
      if (msg.content) await sendText(fromNumber, msg.content);
      break;
    }

    // Execute each tool call and feed results back
    messages.push(msg);
    for (const tc of msg.tool_calls) {
      const result = await executeTool(db, ssePublish, tc.function.name, toolInput, fromNumber);
      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
  }
}
```

Each iteration: call inference, check for tool calls, execute them, feed results back as `tool` messages, repeat until the model sends `send_whatsapp` or a plain text response.

### Voice Note Transcription

When a customer sends a voice note, the app downloads the audio from Telnyx, validates the domain (SSRF prevention), and transcribes it:

```javascript
export async function transcribeAudio(audioUrl) {
  // Validate URL domain — only allow Telnyx-hosted media
  const host = new URL(audioUrl).hostname.toLowerCase();
  if (!ALLOWED_AUDIO_DOMAINS.some((d) => host.endsWith(d))) {
    return "[Voice note from untrusted source — skipped]";
  }

  const audioResp = await fetch(audioUrl, {
    headers: { Authorization: `Bearer ${waKey}` },
  });
  const audioBuffer = await audioResp.arrayBuffer();

  const form = new FormData();
  form.append("file", new Blob([audioBuffer]), `voice.ogg`);
  form.append("model", "openai/whisper-large-v3-turbo");

  const resp = await fetch("https://api.telnyx.com/v2/ai/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const data = await resp.json();
  return data.text || "";
}
```

The transcription is prefixed with `[Voice note transcription]:` and passed to the AI, which parses the items and adds them to cart.

### Number Lookup for Customer Registration

When registering a customer via the dashboard or the AI tool, the phone number is validated and normalized:

```javascript
const nlResp = await fetch(
  `https://api.telnyx.com/v2/number_lookup/${encodeURIComponent(phone)}`,
  { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } }
);
if (nlResp.ok) {
  const nlData = await nlResp.json();
  if (nlData.data && nlData.data.valid_number === false) {
    return res.status(422).json({ error: "This phone number is not valid." });
  }
  if (nlData.data?.phone_number) e164Phone = nlData.data.phone_number;
}
```

### WhatsApp Messaging

The `whatsapp.js` module wraps the Telnyx WhatsApp API for different message types — text, interactive lists, and button replies:

```javascript
export async function sendText(to, text) {
  const resp = await fetch("https://api.telnyx.com/v2/messages/whatsapp", {
    method: "POST",
    headers: waHeaders(),
    body: JSON.stringify({
      ...waBase(),
      to,
      whatsapp_message: { type: "text", text: { body: text } },
    }),
  });
  if (!resp.ok) throw new Error(`WhatsApp send failed: ${resp.status}`);
  return resp.json();
}
```

## Step 3: Run It

Start the server:

```bash
node server.js
```

You should see:

```
FreshCart running on http://localhost:3000
WhatsApp number: +1XXXXXXXXXX
Messaging profile: your-messaging-profile-id-here
API key: KEYyour-main...
```

In a separate terminal, expose your server for webhooks:

```bash
ngrok http 3000
```

Copy the HTTPS URL and set it in the [Telnyx Portal](https://portal.telnyx.com):

- **Messaging Profile** → Webhook URL → `https://<id>.ngrok.io/webhooks/whatsapp`

Open `http://localhost:3000` in your browser to see the operator dashboard.

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:3000/health
```

**Register a customer via the dashboard API:**

```bash
curl -X POST http://localhost:3000/api/customers \
  -H "Content-Type: application/json" \
  -d '{"phone":"+15551234567","name":"Jane Doe","address":"123 Main St"}'
```

**Browse products:**

```bash
curl "http://localhost:3000/api/products?q=milk"
```

**Send a WhatsApp message** to your WhatsApp Business number. Try:

- "Hi" — Mia greets you and offers help
- "I need milk, eggs, and bread" — Mia adds items to your cart
- "Show my cart" — Mia shows cart contents and total
- "I want to checkout" — Mia offers delivery slots and places the order
- Send a voice note listing items — Mia transcribes and adds them

Watch the operator dashboard at `http://localhost:3000` for real-time updates as messages flow.

## Going to Production

This example uses SQLite for simplicity. For production:

- **Edge SQL** — Deploy to Telnyx Edge with `SQLDB_ID` for a managed, replicated database
- **Webhook security** — Validate Telnyx webhook signatures ([docs](https://developers.telnyx.com/docs/api/v2/overview#webhook-signing))
- **Rate limiting** — Protect your endpoints from abuse
- **Redis sessions** — Replace in-memory deduplication maps with Redis for multi-instance deployments
- **Error recovery** — Add retry logic for failed WhatsApp sends and inference timeouts
- **Monitoring** — Add structured logging and health check alerts
- **10DLC compliance** — Ensure your WhatsApp Business number is properly registered

## Resources

- [Source code and reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/whatsapp-grocery-delivery-nodejs/README.md)
- [WhatsApp Business API Guide](https://developers.telnyx.com/docs/messaging/whatsapp)
- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Number Lookup API Reference](https://developers.telnyx.com/api/number-lookup/number-lookup)
- [Audio Transcription API Reference](https://developers.telnyx.com/api/inference/audio-transcriptions)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
