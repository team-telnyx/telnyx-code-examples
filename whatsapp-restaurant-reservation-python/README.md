---
title: "Restaurant Reservations via WhatsApp with AI Agent"
description: "Build a WhatsApp-powered restaurant reservation system with AI agent, interactive messages, and real-time dashboard using Telnyx WhatsApp Business API and AI Inference"
slug: "whatsapp-restaurant-reservation-python"
author: "Harpreet Singh Seehra"
published: 2026-10-20
tags: "WhatsApp, AI Inference, Reservations, Interactive Messages, Python, Flask"
---

# Restaurant Reservations via WhatsApp

Browse real Amsterdam restaurants on a live dashboard, book a table through WhatsApp conversation with an AI agent, and watch reservations update in real time.

This example demonstrates how to build a full restaurant reservation system using Telnyx WhatsApp Business API, AI Inference for natural language understanding, and interactive WhatsApp messages (lists and buttons) for a guided booking experience.

## Telnyx Products Used

- **WhatsApp Business API** — Send and receive WhatsApp messages including interactive lists and buttons
- **AI Inference** — Natural language understanding with tool calling for agentic reservation flow
- **Webhooks** — Receive inbound WhatsApp messages in real time
- **Messaging Profiles** — Route WhatsApp messages through a configured profile

## Architecture

```
Web Dashboard (3-panel)
  ├── Restaurant Browser (Overpass API + Unsplash photos)
  ├── WhatsApp Phone Mockup (live chat via SSE)
  └── Reservation Board (real-time updates)

WhatsApp ──► Telnyx Webhook ──► Flask App
                                  ├── AI Inference (GLM3-flash) with tool calling
                                  ├── Interactive messages (lists, buttons)
                                  ├── Voice note transcription
                                  └── SQLite (restaurants, reservations, conversations)
```

## Features

- **Real Amsterdam restaurants** from OpenStreetMap Overpass API with cuisine-matched photos
- **AI-powered booking** — natural language conversation via WhatsApp
- **Interactive WhatsApp messages** — list messages for restaurant/time selection, button messages for confirmation
- **Voice note support** — transcribe audio messages and process as booking requests
- **Three booking paths**: web-to-WhatsApp deeplink, freeform text, or voice note
- **Real-time dashboard** with SSE-powered updates across all three panels
- **Table inventory management** — 6 tables with seat capacity and time slot availability

## Prerequisites

- Python 3.9+
- A Telnyx account with API key ([sign up](https://telnyx.com/sign-up))
- A separate Telnyx account with WhatsApp Business API enabled
- A WhatsApp-enabled phone number and messaging profile
- (Optional) Unsplash API key for restaurant photos

## Quick Start

```bash
# Clone and navigate
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/whatsapp-restaurant-reservation-python

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Run
python app.py
```

The dashboard opens at [http://localhost:5051](http://localhost:5051).

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TELNYX_API_KEY` | Yes | Main account API key (AI Inference) |
| `TELNYX_WHATSAPP_API_KEY` | Yes | WABA account API key (WhatsApp messaging) |
| `WHATSAPP_NUMBER` | Yes | WhatsApp-enabled phone number (E.164) |
| `WHATSAPP_MESSAGING_PROFILE_ID` | Yes | Messaging profile ID for WhatsApp |
| `AI_MODEL` | No | AI model (default: `THUDM/GLM3-flash`) |
| `UNSPLASH_ACCESS_KEY` | No | Unsplash API key for restaurant photos |
| `DEFAULT_CITY` | No | City for restaurant search (default: `Amsterdam`) |
| `PORT` | No | Server port (default: `5051`) |

## Webhook Setup

Configure your Telnyx WhatsApp messaging profile to send webhooks to:

```
https://your-server.example.com/webhooks/whatsapp
```

For local development, use [ngrok](https://ngrok.com):

```bash
ngrok http 5051
```

Then set the ngrok URL as your webhook URL in the Telnyx portal.

## Why Telnyx

Telnyx AI Communications Infrastructure provides the complete stack for this application — WhatsApp Business API for messaging, AI Inference for natural language understanding, and webhooks for real-time message delivery. Unlike assembling separate providers for messaging, AI, and telephony, Telnyx provides all three through a single platform with carrier-grade reliability and global reach. The AI Inference API supports tool calling out of the box, enabling the agentic reservation loop without any external orchestration framework.

## How It Works

### Booking via WhatsApp

1. **From the dashboard**: Click "Book via WhatsApp" on a restaurant card — opens WhatsApp with a pre-filled message
2. **Freeform text**: Message the WhatsApp number directly — "Table for 4 at De Kas, Friday 7pm"
3. **Voice note**: Send an audio recording — the AI transcribes and processes it

### AI Agent Flow

The AI agent uses tool calling to manage the conversation:

1. `search_restaurants` — Find restaurants by name or cuisine
2. `check_availability` — Check open time slots for a date and party size
3. `make_reservation` — Create the confirmed booking
4. `cancel_reservation` — Cancel an existing reservation
5. `send_whatsapp` — Send text, interactive list, or button messages

### Interactive Messages

- **List messages** — Let customers pick from a restaurant list or available time slots
- **Button messages** — Quick confirmation with Confirm / Change / Cancel buttons (max 3)

## Dashboard

The dark-themed dashboard has three panels:

- **Left**: Restaurant browser with search, photos, cuisine tags, and "Book via WhatsApp" buttons
- **Center**: WhatsApp phone mockup showing live chat bubbles updated via SSE
- **Right**: Reservation board with today's bookings, status badges, and a 6-table availability grid

## Running Tests

```bash
python smoke_test.py
```

All tests use mocked HTTP — no real API credentials needed.

## API Reference

See [API.md](API.md) for the full endpoint reference.

## Tutorial

See [GUIDE.md](GUIDE.md) for a step-by-step walkthrough of how this app is built.

## Troubleshooting

- **Overpass API returns 406**: The API may be rate-limited or temporarily unavailable. The app automatically falls back to 12 pre-seeded Amsterdam restaurants. Click "Refresh Restaurants" later to retry.
- **WhatsApp messages not arriving**: Verify your webhook URL is publicly accessible (use ngrok for local development) and correctly configured in your Telnyx messaging profile.
- **Interactive messages falling back to text**: Interactive list and button messages require a WhatsApp Business API-approved account. If they fail, the app automatically falls back to plain text messages.
- **Voice notes not transcribing**: Ensure your main `TELNYX_API_KEY` has AI Inference access enabled. The audio transcription uses the `distil-whisper/distil-large-v3` model.
- **Two API keys confusion**: `TELNYX_API_KEY` is for your main account (AI), `TELNYX_WHATSAPP_API_KEY` is for your WABA-enabled account (WhatsApp). They can be the same key if both services are on one account.

## Agent Discovery

This example implements an AI agent that autonomously handles restaurant reservations through tool calling. The agent is discoverable by other AI systems through its webhook endpoint and SSE stream. Key capabilities:

- **search_restaurants** — Search the restaurant database by name or cuisine
- **check_availability** — Query time slot availability for a given date and party size
- **make_reservation** — Create confirmed reservations with full details
- **cancel_reservation** — Cancel existing bookings
- **send_whatsapp** — Send text, interactive list, or interactive button messages via WhatsApp

The agent operates within Telnyx AI Communications Infrastructure, using the AI Inference API for natural language understanding and the WhatsApp Business API for customer communication.

## Resources

- [Telnyx WhatsApp Business API Docs](https://developers.telnyx.com/docs/messaging/whatsapp)
- [Telnyx AI Inference Docs](https://developers.telnyx.com/docs/inference/overview)
- [Telnyx Webhooks](https://developers.telnyx.com/docs/api/v2/overview#webhooks)
- [Telnyx Portal](https://portal.telnyx.com)
- [Sign up for Telnyx](https://telnyx.com/sign-up)
- [OpenStreetMap Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API)

## Related Examples

- [Email & WhatsApp Support](../email-whatsapp-support-python/) — Multi-channel AI customer support
- [Restaurant Reservation Waitlist](../restaurant-reservation-waitlist-python/) — Voice-based reservation system
- [WhatsApp Order Tracking](../whatsapp-order-tracking-notifications-python/) — WhatsApp notifications for order updates
- [WhatsApp SMS Bridge](../whatsapp-sms-bridge-python/) — Bridge between WhatsApp and SMS channels
- [AI Receptionist with Booking Tools](../ai-receptionist-with-booking-tools-python/) — AI phone receptionist for bookings
- [Omnichannel AI Agent](../omnichannel-ai-agent-python/) — Multi-channel AI agent
- [RCS Campaign Desk](../rcs-capability-campaign-desk-python/) — Rich messaging campaign management

## Frequently Asked Questions

### What WhatsApp message types does this example use?
This example sends plain text messages, interactive list messages (for selecting restaurants and time slots), and interactive button messages (for booking confirmation with Confirm / Change / Cancel options). These are sent via the Telnyx WhatsApp Business API using the `POST /v2/messages/whatsapp` endpoint with `whatsapp_message.type` set to `"interactive"`.

### Can I use this with a city other than Amsterdam?
Yes. Set the `DEFAULT_CITY` environment variable to any city available in OpenStreetMap. The Overpass API query will fetch restaurants within that city's boundaries. The fallback data is Amsterdam-specific, so for best results with other cities, ensure the Overpass API is accessible.

### Why does this use two separate Telnyx API keys?
WhatsApp Business API requires a WABA-enabled Telnyx account, which may be separate from your main account used for AI Inference and other services. The `TELNYX_API_KEY` is used for AI model calls, while `TELNYX_WHATSAPP_API_KEY` is used for sending and receiving WhatsApp messages.

### How does voice note booking work?
When a customer sends an audio message via WhatsApp, the app downloads the OGG file from the media URL provided in the webhook payload, sends it to Telnyx AI for speech-to-text transcription, and then processes the transcribed text through the same AI agent flow as a text message.

### How does the real-time dashboard update?
The dashboard uses Server-Sent Events (SSE) via the `/stream` endpoint. When WhatsApp messages arrive, the AI processes them, or reservations change, the server pushes events to all connected browser clients. The chat panel, reservation board, and table grid all update instantly without page refresh.
