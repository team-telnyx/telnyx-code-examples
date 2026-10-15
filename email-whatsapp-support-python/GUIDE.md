# Tutorial: Customer Support Across Email & WhatsApp

This guide walks through how the demo works and how to adapt it for production use.

## Overview

The demo shows a unified support dashboard where a customer reports a damaged order via email, provides a damage photo via WhatsApp, and receives a shipping confirmation via email — all visible in one place.

The value proposition is the **unified dashboard** — a single view across communication channels.

## Architecture

```
Browser (Dashboard)
    │
    ├── SSE (/stream) ──── real-time event updates
    │
Flask App (app.py)
    │
    ├── /webhooks/email ──── Telnyx Email API (inbound)
    ├── /webhooks/whatsapp ── Telnyx Messaging API (inbound WhatsApp)
    │
    ├── send_email() ──────── Telnyx Email API (outbound)
    ├── send_whatsapp() ───── Telnyx Messaging API (outbound WhatsApp)
    │
    └── SQLite
         ├── customers ────── identity registry
         ├── conversations ── cross-channel message history
         └── orders ───────── order state tracking
```

## Running the Demo

```bash
pip install -r requirements.txt
python demo/demo_server.py
```

Open http://localhost:5050 and click **Run Demo Journey**.

The demo server:
1. Sets dummy environment variables (no real credentials needed)
2. Replaces `send_email()` and `send_whatsapp()` with mock functions
3. Registers a demo customer (Maria Santos) and order
4. Runs a scripted 5-step journey via webhook payloads

## The 5-Step Journey

### Step 1: Damage Report (Email)

Maria emails about her damaged headphones. The webhook handler at `/webhooks/email`:
- Parses the Telnyx email webhook payload
- Resolves the customer identity by email address
- Stores the message in the `conversations` table
- Publishes a `channel.email` SSE event

The demo then sends an auto-acknowledgment reply via email.

### Step 2: Photo Request (WhatsApp)

Support reaches out on WhatsApp to request a damage photo. The `send_whatsapp()` function:
- POSTs to the Telnyx Messaging API with `type: "whatsapp"`
- Stores the outbound message
- Publishes a `channel.whatsapp` SSE event

### Step 3: Photo Received (WhatsApp)

Maria sends back a photo with a description. The webhook handler at `/webhooks/whatsapp`:
- Parses the Telnyx messaging webhook payload
- Resolves the customer identity by phone number
- Extracts media URLs from the payload
- Stores the message (with attachment references)
- Publishes a `channel.whatsapp` SSE event with media data

### Step 4: Replacement Approved (WhatsApp)

Support confirms the replacement on WhatsApp and updates the order status.

### Step 5: Shipping Confirmation (Email)

A formal shipping confirmation is sent via email with tracking details.

## Key Components

### Identity Resolution

Customers are identified by email or phone number across channels:

```python
customer = resolve_customer(email=from_email)  # Email webhook
customer = resolve_customer(phone=from_number)  # WhatsApp webhook
```

### SSE Events

The dashboard receives real-time updates via Server-Sent Events:

```python
sse_publish("channel.email", {
    "direction": "inbound",
    "subject": subject,
    "body": body,
    "customer": customer,
})
```

The browser listens on `/stream` and renders events into the appropriate panel.

### Order Tracking

The `orders` table tracks status transitions:

```
delivered → damage_reported → replacement_shipping → resolved
```

Each transition publishes an `order.update` SSE event that updates the status badge in the dashboard.

## Adapting for Production

### 1. Set Up Telnyx Credentials

```bash
cp .env.example .env
```

Configure:
- `TELNYX_API_KEY` — your Telnyx API key
- `TELNYX_EMAIL_FROM` — your verified sending email
- `WHATSAPP_NUMBER` — your Telnyx WhatsApp-enabled number
- `MESSAGING_PROFILE_ID` — your messaging profile ID

### 2. Configure Webhooks

In the Telnyx Portal, set webhook URLs:
- Email: `https://your-domain.com/webhooks/email`
- Messaging (WhatsApp): `https://your-domain.com/webhooks/whatsapp`

### 3. Add Business Logic

The demo uses scripted responses. For production, add:
- Agent routing logic
- CRM integration
- Automated response rules
- Escalation workflows

### 4. Replace SQLite

For production, use PostgreSQL or another production database. The schema is simple enough to port directly.
