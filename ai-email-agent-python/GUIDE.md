# AI Email Agent — Deep Dive

A walkthrough of each component in the demo, the decisions behind them, and how to extend the agent for production use.

## 1. Why this demo exists

The [omnichannel AI agents blog](https://telnyx.com/resources/build-omnichannel-ai-agents) frames the shift: "channels are outputs, not integrations." A channel is a tool your model calls. Email was the last primitive that needed a second vendor — the [Telnyx Email API](https://telnyx.com/products/email-api) closes that gap so voice, SMS, WhatsApp, fax, and email all live under one API key, one event stream, one bill.

This demo shows the simplest meaningful version of that: an **AI agent that replies to inbound email on its own**. Not a human typing. Not a template auto-responder. An LLM reads the customer's email, drafts a context-aware reply, and the Email API sends it back — threaded correctly so the customer's mail client shows it as part of the same conversation.

## 2. Component walkthrough

### `app.py` — Flask webhook receiver + dashboard

Three routes:

- **`POST /webhooks/email`** — the entry point. Telnyx fires this on every email event (inbound and outbound). The handler:
  1. Verifies the Ed25519 signature via the `telnyx` Python SDK's `webhooks.unwrap()`.
  2. Distinguishes inbound events (`email.received` and variants) from outbound events (`email.delivered`, `email.opened`, etc.).
  3. For inbound events: extracts the `message_id`, spawns a background thread running `process_inbound_email()`, and returns `200` immediately. Returning fast matters — Telnyx retries on non-2xx, and the AI inference + reply send can take 5–10 seconds.
  4. For outbound events: logs them to the dashboard. No action needed — these are status updates for emails the agent already sent.

- **`GET /`** — the live dashboard. Auto-refreshes every 3 seconds via `<meta http-equiv="refresh" content="3">`. Shows the in-memory event log as a table: timestamp, stage (`inbound` / `ai` / `reply` / `outbound` / `error`), what happened, and a detail line. This is the screen-record target for the demo video — open it in one browser tab, send an email from another, and watch the whole agent flow appear on screen.

- **`GET /health`** — returns `{"status": "ok", "inbox": ..., "agent": ..., "events_logged": N}`. Useful for uptime checks and for confirming the app is running before sending a test email.

The event log is a `deque(maxlen=100)` guarded by a lock — enough history for a demo, cheap to scan, no database required.

### `agent.py` — Telnyx AI Inference wrapper

One function: `generate_reply(inbound_email)`. Builds an OpenAI-compatible chat-completions request to `POST /v2/ai/chat/completions` on the same Telnyx API key as everything else:

- **System prompt** — defines the agent's persona. The default is in `.env.example` (`AGENT_SYSTEM_PROMPT`); override it per-deployment without touching code.
- **User content** — the inbound email's `From`, `Subject`, and body, formatted as a single user message with explicit instructions to write only the email body (no subject prefix, no metadata) so the output can be sent directly.
- **Model** — `moonshotai/Kimi-K2.6` by default; any model listed at [developers.telnyx.com/docs/inference/models](https://developers.telnyx.com/docs/inference/models) works.
- **HTML wrapping** — `html_wrap()` does minimal escaping + line-break preservation so the plain-text AI output renders nicely in mail clients. No external templating dependency.

If only `html_body` is available (no `text_body`), the wrapper strips HTML tags with a regex + `html.unescape`. Good enough for a demo; production should use a proper HTML-to-text library like `html2text` or `markdownify`.

### `email_tools.py` — Email API wrappers

Two layers:

**Outbound (confirmed from the launch blog):**
- `send_email(to, subject, html_body, text_body, from_email, from_name, in_reply_to, references)` — `POST /v2/email_messages`. The `from` field is an object (`{"email": ..., "name": ...}`), not a string. The body field is `html_body`, not `html`. Threading headers (`In-Reply-To`, `References`) are passed via a `headers` object on the payload — the exact field name is being confirmed against the official Email API skill, but this is the standard email threading mechanism.
- `list_domains()`, `create_domain(domain)`, `verify_domain(domain_id)`, `configure_domain_webhook(domain_id, url, events)` — domain setup helpers. Not used by the live demo flow (configured once via portal) but included so this directory is a self-contained reference.

**Inbound (TODO: confirm exact paths):**
- `fetch_inbound_message(message_id)` — fetches the full inbound email body after the webhook fires. Tries `GET /v2/email_inbound_messages/{id}` first, falls back to `GET /v2/email_messages/{id}`. The exact path will be confirmed against the official `telnyx-email-inbound` skill and updated before the PR merges.
- `list_inbound_messages(limit)` — lists recent inbound messages. Same TODO.
- `_normalize_inbound(raw)` — converts the API response into the shape `agent.generate_reply` expects (`from`, `from_name`, `to`, `subject`, `text_body`, `html_body`, `message_id`). Handles common field-name variants (`from` vs `sender`, `text_body` vs `text` vs `body`).

### `templates/reply.liquid` — Liquid template reference

The demo sends raw AI-generated HTML directly (via `agent.html_wrap`) for simplicity. The Liquid template shows the server-side rendering pattern for teams that want personalization variables (`customer_name`, `agent_name`, `reply_body`) without writing the HTML in Python.

To use it:
1. Create the template via `POST /v2/email_templates` with the file's content as `html_body`.
2. Render it via `POST /v2/email_templates/{id}/render` with `{ "template_variables": { "customer_name": "Ada", "agent_name": "Nyx", "reply_body": "..." } }`.
3. Send the rendered HTML as `html_body` to `POST /v2/email_messages`.

## 3. Webhook signature verification

Telnyx webhooks are Ed25519-signed. The `telnyx` Python SDK handles verification:

```python
import telnyx

client = telnyx.Telnyx(api_key=..., public_key=...)
event = client.webhooks.unwrap(raw_body, headers)  # raises on bad signature
```

The public key is found in the Portal under **API Keys → Webhook Signing Key**. If `TELNYX_PUBLIC_KEY` is unset, the demo logs a warning and skips verification — acceptable for local development, **never** for production.

## 4. Why a background thread for the reply flow

Telnyx retries webhooks on non-2xx responses with exponential backoff. The AI inference + reply send takes 5–10 seconds. If the webhook handler waited for the full flow before returning 200, Telnyx might time out and retry, causing duplicate replies.

The handler returns `200` immediately and runs `process_inbound_email()` in a daemon thread. The dashboard updates as each step completes. For production at higher volume, swap the thread for a task queue (Celery, RQ, SQS) so replies survive a process restart.

## 5. Extending the agent

- **Knowledge base**: replace `AGENT_SYSTEM_PROMPT` with a RAG-augmented prompt. Pull relevant docs from your knowledge base based on the email's content, prepend them to the system prompt. The Telnyx AI Assistant product (in the Portal) has built-in RAG — swap the `generate_reply()` call for an AI Assistant webhook call to use it.
- **Function calling**: give the agent tools (lookup order status, issue refund, schedule callback) using the Telnyx Agent Toolkit (`telnyx-agent-toolkit` on PyPI). The agent can call these tools mid-reply to ground its responses in real data.
- **Multi-turn context**: the demo treats each inbound email as a one-shot reply. For multi-turn email threads, maintain conversation history keyed by the `References` header (or the customer's email address) and pass the full history to the inference call.
- **Omnichannel handoff**: if the email thread needs voice or SMS escalation, the agent can call `POST /v2/messages` (SMS) or trigger a call via Call Control — all on the same API key. This is where the "one platform, every channel" narrative pays off.

## 6. Production checklist

- [ ] Set `TELNYX_PUBLIC_KEY` and remove the verification skip.
- [ ] Replace the in-memory event log with a persistent store (DB, log file, or observability platform).
- [ ] Replace the background thread with a task queue so replies survive restarts.
- [ ] Add idempotency: dedupe by `message_id` so a webhook retry doesn't double-reply.
- [ ] Add rate limiting per sender address to prevent abuse of the AI inference call.
- [ ] Validate the inbound sender via `POST /v2/email_validations` before generating a reply.
- [ ] Configure suppression-list checks: the Email API auto-suppresses bounces and spam complaints, but you should also respect `email.unsubscribed` events by stopping replies to that address.
- [ ] Set up a real HTTPS endpoint (Telnyx Edge Compute, a cloud VM with Caddy, or your existing infra) instead of ngrok.
- [ ] Monitor: alert on `email.bounced` and `email.failed` rates, AI inference error rates, and webhook verification failures.
