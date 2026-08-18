---
name: ai-email-agent
title: "AI Email Agent"
description: "AI Email Agent — autonomous inbound email reply bot on the Telnyx Email API. A customer emails in, the AI drafts a reply, the Email API sends it back. One platform, one API key, one agent."
language: python
framework: flask
telnyx_products: [Email API, AI Inference]
channel: [email]
---

# AI Email Agent

Autonomous inbound email reply bot on the Telnyx **Email API** and **AI Inference**. A customer sends an email to your agent's inbox address. Telnyx fires an inbound webhook. This app verifies the Ed25519 signature, fetches the full message body, asks Telnyx AI Inference to draft a reply, and sends the reply back via the Email API — with proper `In-Reply-To` / `References` threading so the conversation stays in one thread in the customer's mail client.

One API key. One platform. The agent that replies to email without you typing.

> **Email API is in invite-only beta.** Request access at [telnyx.com/products/email-api](https://telnyx.com/products/email-api). The code in this directory is written against the documented API surface and will run end-to-end the moment beta access is granted.

## Telnyx API Endpoints Used

- **Send Email**: `POST /v2/email_messages` — [API reference](https://developers.telnyx.com/api-reference/email-messages/create-or-send-an-email-message)
- **AI Inference (chat completions)**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/docs/inference/chat-completions)
- **Fetch Inbound Message**: `GET /v2/email_inbound_messages/{id}` — confirm exact path against the [Email API inbound docs](https://developers.telnyx.com/docs/messaging/email) once beta access is granted
- **Domain Webhook Configuration**: `POST /v2/email_domains/{domain_id}/webhooks` — per-domain webhook setup (see launch blog)

## Telnyx Webhook Events

This app handles inbound and outbound email webhook events. Webhooks are Ed25519-signed using the `telnyx-signature-ed25519` and `telnyx-timestamp` headers; verification uses the official `telnyx` Python SDK.

**Inbound** (triggers the AI reply flow):
- `email.received` / `email.inbound` / `email.inbound.received` — new inbound email arrived (the exact event name is being confirmed against the official Email API inbound docs; the handler accepts all three)

**Outbound** (logged to the dashboard, no action taken):
- `email.queued`, `email.sending`, `email.sent`, `email.delivered`
- `email.opened`, `email.clicked`
- `email.bounced`, `email.deferred`, `email.failed`
- `email.unsubscribed`, `email.complained`, `email.rejected`

See the [Email API launch blog](https://telnyx.com/resources/how-to-send-emails-using-api) for the full event reference.

## Architecture

```
  Customer sends email
        │
        ▼
  ┌─────────────────────────────┐
  │ Telnyx Email API (inbound)  │
  │ • receives email            │
  │ • fires webhook (Ed25519)   │
  └────────┬────────────────────┘
           │
           ▼
  ┌─────────────────────────────┐
  │ This app: /webhooks/email   │
  │ • verify Ed25519 signature  │
  │ • extract message_id        │
  └────────┬────────────────────┘
           │ (background thread)
           ▼
  ┌─────────────────────────────┐
  │ Fetch full inbound message  │
  │ GET /v2/email_inbound_messages/{id}
  └────────┬────────────────────┘
           │
           ▼
  ┌─────────────────────────────┐
  │ Telnyx AI Inference          │
  │ POST /v2/ai/chat/completions │
  │ • system prompt = agent     │
  │ • user content = email body │
  │ • model = moonshotai/Kimi-K2.6
  └────────┬────────────────────┘
           │
           ▼
  ┌─────────────────────────────┐
  │ Send reply via Email API    │
  │ POST /v2/email_messages     │
  │ • In-Reply-To + References  │
  │ • html_body + text_body     │
  └────────┬────────────────────┘
           │
           ▼
  Customer sees AI reply in their inbox, threaded under the original
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal → API Keys](https://portal.telnyx.com/api-keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `-----BEGIN PUBLIC KEY-----…` | **yes** (prod) | Telnyx public key for Ed25519 webhook verification. Leave blank to skip verification (local dev only). | [Portal → API Keys → Webhook Signing Key](https://portal.telnyx.com/api-keys) |
| `EMAIL_SENDING_DOMAIN` | `string` | `mail.telnyxemail.com` | **yes** | Sending domain (Telnyx shared domain or your own verified domain). | [Portal → Email → Domains](https://portal.telnyx.com/email) |
| `INBOX_ADDRESS` | `string` | `[email protected]` | **yes** | Inbox address that receives inbound emails. Must be on the sending domain. | Configure in Portal once beta access is granted. |
| `AGENT_DISPLAY_NAME` | `string` | `Nyx AI Agent` | no | Display name shown in the `From:` header of AI-generated replies. | Any friendly name. |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | Telnyx AI Inference model name. | [Inference models](https://developers.telnyx.com/docs/inference/models) |
| `AGENT_SYSTEM_PROMPT` | `string` | `You are Nyx, a friendly…` | no | System prompt that defines the agent's reply persona. | See `.env.example` for the default. |
| `MAX_TOKENS` | `integer` | `400` | no | Max tokens for AI-generated reply. | — |
| `TELNYX_PUBLIC_BASE_URL` | `string` | `https://your-tunnel.ngrok.app` | **yes** (webhooks) | Public HTTPS URL of this app. Telnyx webhooks must point to `{this}/webhooks/email`. | [ngrok](https://ngrok.com), [cloudflare-tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/), or any HTTPS tunnel. |
| `HOST` | `string` | `0.0.0.0` | no | Flask bind host. | — |
| `PORT` | `integer` | `8000` | no | Flask bind port. | — |

## Setup

```bash
# 1. Clone and enter the demo directory
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-email-agent-python

# 2. Install dependencies
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env
# Edit .env — fill in TELNYX_API_KEY, TELNYX_PUBLIC_KEY,
# EMAIL_SENDING_DOMAIN, INBOX_ADDRESS, TELNYX_PUBLIC_BASE_URL

# 4. Expose the local server over HTTPS (Telnyx needs a public webhook URL)
ngrok http 8000
# → copy the https://*.ngrok-free.app URL into TELNYX_PUBLIC_BASE_URL

# 5. Configure the webhook in the Telnyx portal (or via API):
#    POST /v2/email_domains/{domain_id}/webhooks
#    { "url": "https://your-tunnel.ngrok.app/webhooks/email",
#      "events": ["email.received", "email.delivered", "email.opened",
#                 "email.bounced", "email.failed"] }

# 6. Run the agent
python app.py
# → starts on http://localhost:8000
# → dashboard live at http://localhost:8000
```

## Demo flow (for the video)

The dashboard at `/` is the screen-record target — it shows every step of the agent as it happens, auto-refreshing every 3 seconds.

1. **Show setup (30s)** — open the dashboard in one tab, the inbox in Gmail/Outlook in another. Narrate: "this is the agent's inbox, this is the live dashboard."
2. **Send a test email (15s)** — from your personal email to `INBOX_ADDRESS`. Subject: "Question about your service". Body: anything.
3. **Watch the agent work (60s)** — within a few seconds the dashboard shows:
   - `[inbound]` New email from `<your address>` — Subject: Question about your service
   - `[inbound]` Fetched message from `<your address>` — body preview…
   - `[ai]` AI reply drafted — first ~200 chars of the reply…
   - `[reply]` Reply sent to `<your address>` — Subject: Re: Question about your service
   - `[outbound]` `email.queued` / `email.sent` / `email.delivered` as the reply travels
4. **Show the reply in the inbox (15s)** — switch to Gmail/Outlook; the AI reply is there, threaded under your original email.
5. **Reply to the AI (optional, 30s)** — send a follow-up email in the same thread; the agent replies again, demonstrating multi-turn email conversation.
6. **Outro (10s)** — "One API key. One platform. The AI agent that replies to email on its own."

## Files

| File | Purpose |
|------|---------|
| `app.py` | Flask app: `/webhooks/email` (Ed25519-verified receiver), `/` (live dashboard), `/health`. Orchestrates fetch → AI → reply in a background thread. |
| `agent.py` | Telnyx AI Inference wrapper — sends the inbound email body to `/v2/ai/chat/completions` with a system prompt; returns the AI-generated reply text. |
| `email_tools.py` | Email API wrappers — `send_email`, `fetch_inbound_message`, `list_inbound_messages`, plus domain/webhook setup helpers. |
| `templates/reply.liquid` | Liquid template reference for the AI reply (the demo sends raw HTML directly; this shows the Liquid pattern for teams that want server-side template rendering). |
| `requirements.txt` | `flask`, `requests`, `python-dotenv`, `telnyx` (official SDK for Ed25519 verification). |
| `.env.example` | All environment variables with defaults and where to find each value. |

## Notes

- **Using a Portal AI Assistant instead of AI Inference**: this demo uses `/v2/ai/chat/completions` for the agent brain. If you'd rather use a [Telnyx AI Assistant](https://developers.telnyx.com/docs/ai-voice-cs/ai-assistants) configured in the Portal (with a knowledge base, custom tools, etc.), swap the `generate_reply()` call in `agent.py` for a call to the AI Assistant's webhook — the rest of the flow stays the same.
- **Liquid templates**: the demo sends raw AI-generated HTML (via `agent.html_wrap`) for simplicity. To use server-side Liquid rendering, create a template via `POST /v2/email_templates`, render it via `POST /v2/email_templates/{id}/render` with `{ "template_variables": { ... } }`, and send the rendered HTML as `html_body`. See `templates/reply.liquid` for the template structure.
- **Email validation**: optionally validate the inbound sender's address via `POST /v2/email_validations` before generating a reply — free, same API key, reduces replies to malformed addresses.
- **Suppressions**: the Email API auto-suppresses bounces, spam complaints, and unsubscribes. Replies to suppressed addresses are blocked at send time with a 422. See `/v2/suppressions` in the API reference.

## References

- [Email API launch blog](https://telnyx.com/resources/how-to-send-emails-using-api) — full feature walkthrough and curl examples
- [Omnichannel AI agents blog](https://telnyx.com/resources/build-omnichannel-ai-agents) — the narrative this demo rides
- [Email API quickstart](https://developers.telnyx.com/docs/messaging/email/quickstart)
- [Email API API reference](https://developers.telnyx.com/api-reference/email-messages/create-or-send-an-email-message)
- [Telnyx AI Inference docs](https://developers.telnyx.com/docs/inference/chat-completions)
- [Telnyx AI repo](https://github.com/team-telnyx/ai) — Agent Toolkit, MCP server, Skills (incl. `telnyx-email-curl`, `telnyx-email-inbound-curl`, `telnyx-email-domains-curl`, `telnyx-email-suppressions-curl`)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python) — used here for Ed25519 webhook verification
