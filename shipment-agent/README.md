---
name: shipment-agent
title: "ShipmentAgent: The Actor IS the Package"
description: "A durable AI shipment agent that proactively communicates with customers across carriers and status changes via SMS and Voice."
language: python
framework: flask
telnyx_products: ["SMS", "Call Control", "Number Lookup", "AI Inference"]
---

# ShipmentAgent: The Actor IS the Package

A durable AI shipment agent that lives across days, carriers, and status changes, proactively contacting customers via Telnyx SMS and Voice when things change.

## Why Telnyx

Telnyx provides a comprehensive AI Communications Infrastructure that enables developers to build intelligent, autonomous agents. By combining programmable SMS, Call Control, and AI inference capabilities, Telnyx allows you to create durable entities that act as real-world actors—communicating naturally with users across multiple channels. This example leverages Telnyx's robust webhook verification, global messaging network, and AI integrations to build a shipment agent that truly represents the package itself.

## Telnyx API Endpoints Used

- **Telnyx Messaging API** (`telnyx.Message.create`): Sends proactive SMS updates to the customer regarding shipment status changes.
- **Telnyx Webhook Verification** (`telnyx.Webhook.construct_event`): Securely verifies inbound Telnyx webhooks using Ed25519 signatures for SMS replies and Call Control events.
- **Telnyx Call Control API**: Manages inbound customer calls, allowing the agent to answer with full shipment context.
- **Telnyx AI Inference**: Processes natural language SMS replies from customers for dynamic shipment Q&A.

## Architecture

```text
+----------------+        +-----------------+        +-----------------+
| Carrier Webhook |        | Telnyx Webhook  |        | Customer Call   |
| (FedEx/UPS API) |        | (SMS Reply/Call)|        | (Call Control)  |
+-------+--------+        +--------+--------+        +--------+--------+
        |                          |                          |
        | POST /webhooks/carrier   | POST /webhooks/telnyx    | POST /api/agents/{id}/call
        v                          v                          v
+-----------------------------------------------------------------------+
|                         Flask Application (app.py)                     |
+-----------------------------------------------------------------------+
                               |
                               v
+-----------------------------------------------------------------------+
|                             ShipmentAgent                             |
|  (Durable entity owning state, carrier data, and customer link)        |
+-----------------------------------------------------------------------+
          |                                 |               |
          v                                 v               v
+-------------------+        +------------------------+   +-----------------+
| Proactive SMS     |        | Self-Waking Scheduler  |   | AI Inference    |
| (telnyx.Message)  |        | (schedule())           |   | (NL Q&A)        |
+-------------------+        +------------------------+   +-----------------+
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY01...` | **yes** | Telnyx API v2 authentication key | [portal.telnyx.com → API Keys](https://portal.telnyx.com/#/app/api-keys) |
| `TELNYX_FROM_NUMBER` | `string` | `+18005550100` | **yes** | E.164 number for outbound SMS shipment notifications | [portal.telnyx.com → Numbers](https://portal.telnyx.com/#/app/numbers/my-numbers) |
| `TELNYX_MESSAGING_PROFILE_ID` | `string` | `40017...` | **yes** | Messaging profile associated with your sending number | [portal.telnyx.com → Messaging → Profiles](https://portal.telnyx.com/#/app/messaging) |
| `TELNYX_PUBLIC_KEY` | `string` | `abc123...` | **yes** | Ed25519 public key for webhook signature verification | [portal.telnyx.com → API Keys](https://portal.telnyx.com/#/app/api-keys) |
| `TELNYX_TO_NUMBER` | `string` | `+18005550199` | **yes** | E.164 destination number for shipment updates | Your customer notification number |

## Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/team-telnyx/telnyx-code-examples.git
   cd telnyx-code-examples/shipment-agent
   ```

2. **Create a virtual environment and install dependencies**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows use `venv\Scripts\activate`
   pip install -r requirements.txt
   ```

3. **Configure environment variables**
   Create a `.env` file in the root of the `shipment-agent` directory:
   ```bash
   cp .env.example .env
   ```
   Edit the `.env` file and replace the placeholder values with your actual Telnyx credentials.

4. **Run the application**
   ```bash
   python app.py
   ```
   The Flask server will start on `http://localhost:5000`.

## API Reference

See `API.md` for a complete typed endpoint reference, including request/response shapes and status codes.

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `401 Unauthorized` on webhooks | Missing or invalid Telnyx Ed25519 signature verification | Ensure `TELNYX_PUBLIC_KEY` is set correctly in your `.env` file. |
| SMS not sending | Invalid `TELNYX_FROM_NUMBER` or `TELNYX_MESSAGING_PROFILE_ID` | Verify your Telnyx number is provisioned and linked to the messaging profile ID in the Telnyx Portal. |
| Agent state lost on restart | In-memory `SHIPMENT_AGENTS` dictionary is cleared | This is expected in this demo. For production, implement a persistent database (e.g., Postgres/Redis) as noted in the code. |
| Scheduled wakes not firing | Background thread failed or process restarted | The `threading.Timer` approach is for demo purposes only. Use a task queue (e.g., Celery, RQ) for production scheduling. |

## Agent Discovery

- [Agent Signup](https://telnyx.com/agent-signup.md)
- [Team Telnyx AI on GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [SMS Chatbot with Conversation Memory](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-chatbot-with-conversation-memory-python/README.md)
- [AI Appointment Booking SMS Flow](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-appointment-booking-sms-flow-python/README.md)
- [Agent SMS Triage Bot](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/agent-sms-triage-bot/README.md)

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com/)
- [Telnyx API Reference](https://developers.telnyx.com/docs/api/v2/overview)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Telnyx Messaging Product Page](https://telnyx.com/products/sms-api)
- [Telnyx Pricing](https://telnyx.com/pricing)
