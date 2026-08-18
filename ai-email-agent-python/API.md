# API Reference — Endpoints used by this demo

All endpoints are on `https://api.telnyx.com/v2`. Auth: `Authorization: Bearer <TELNYX_API_KEY>`. Content-Type: `application/json`.

> **Email API is in invite-only beta.** Some inbound endpoint paths are marked TODO and will be confirmed against the official `telnyx-email-inbound` skill before the PR merges.

## Send a transactional email

`POST /v2/email_messages`

Send a single email. The `from` field is an object with `email` and `name`, not a string. Use `html_body` (not `html`) for the HTML body.

```bash
curl -X POST https://api.telnyx.com/v2/email_messages \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": {"email": "[email protected]", "name": "Nyx AI Agent"},
    "to": [{"email": "[email protected]"}],
    "subject": "Re: Question about your service",
    "html_body": "<p>Hi Ada, thanks for reaching out! …</p>",
    "text_body": "Hi Ada, thanks for reaching out! …",
    "headers": {
      "In-Reply-To": "<[email protected]>",
      "References": "<[email protected]>"
    }
  }'
```

Used in `email_tools.send_email()`.

## Batch send (up to 50 messages)

`POST /v2/email_messages/batch`

Always returns `207 Multi-Status` with per-message success and error arrays. One call, one round trip, up to 50 messages.

```bash
curl -X POST https://api.telnyx.com/v2/email_messages/batch \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"from": {"email": "[email protected]", "name": "Acme"}, "to": [{"email": "[email protected]"}], "subject": "Receipt", "html_body": "<p>Thanks.</p>"},
      {"from": {"email": "[email protected]", "name": "Acme"}, "to": [{"email": "[email protected]"}], "subject": "Receipt", "html_body": "<p>Thanks.</p>"}
    ]
  }'
```

Not used by this demo but documented for completeness.

## Create a Liquid template

`POST /v2/email_templates`

```bash
curl -X POST https://api.telnyx.com/v2/email_templates \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "AI Reply",
    "subject": "Re: {{original_subject}}",
    "html_body": "<p>Hi {{customer_name}},</p><p>{{reply_body}}</p><p>Best regards,<br>{{agent_name}}</p>"
  }'
```

## Render a Liquid template

`POST /v2/email_templates/{id}/render`

Render without sending — useful for previewing.

```bash
curl -X POST https://api.telnyx.com/v2/email_templates/$TEMPLATE_ID/render \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "template_variables": {
      "customer_name": "Ada",
      "agent_name": "Nyx",
      "reply_body": "Thanks for your question. Here is the answer…",
      "original_subject": "Question about your service"
    }
  }'
```

## Create a sending domain

`POST /v2/email_domains`

Telnyx generates five DNS records: ownership, SPF, DKIM, MX, and DMARC. Publish them at your DNS provider and trigger verification.

```bash
curl -X POST https://api.telnyx.com/v2/email_domains \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"domain": "mail.example.com"}'
```

## Verify a sending domain

`POST /v2/email_domains/{id}/verify`

Triggers DNS verification after you've published the records. Telnyx verifies and monitors for drift going forward.

```bash
curl -X POST https://api.telnyx.com/v2/email_domains/$DOMAIN_ID/verify \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

## Configure a domain-level webhook

`POST /v2/email_domains/{id}/webhooks`

Webhooks are configured per sender domain, not per message. Ed25519-signed using the `telnyx-signature-ed25519` and `telnyx-timestamp` headers, with automatic retry on non-2xx.

```bash
curl -X POST https://api.telnyx.com/v2/email_domains/$DOMAIN_ID/webhooks \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-tunnel.ngrok.app/webhooks/email",
    "events": ["email.received", "email.sent", "email.delivered", "email.opened", "email.bounced", "email.failed"]
  }'
```

## Poll email events (alternative to webhooks)

`GET /v2/email_events`

For services without a public webhook URL. Poll for events on your schedule.

```bash
curl https://api.telnyx.com/v2/email_events \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

## AI Inference — chat completions

`POST /v2/ai/chat/completions`

OpenAI-compatible. Same Telnyx API key as the Email API. The agent brain for this demo.

```bash
curl -X POST https://api.telnyx.com/v2/ai/chat/completions \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "moonshotai/Kimi-K2.6",
    "messages": [
      {"role": "system", "content": "You are Nyx, a friendly AI email assistant. Reply concisely."},
      {"role": "user", "content": "From: [email protected]\nSubject: Question\n\nHi, what does SMS cost?"}
    ],
    "max_tokens": 400,
    "temperature": 0.7
  }'
```

Used in `agent.generate_reply()`.

## Inbound email — fetch message (TODO: confirm path)

`GET /v2/email_inbound_messages/{id}` *(path being confirmed)*

After an inbound webhook fires, fetch the full message body. The webhook payload contains the `message_id` needed here.

```bash
# Most likely path (being confirmed against the official skill):
curl https://api.telnyx.com/v2/email_inbound_messages/$MESSAGE_ID \
  -H "Authorization: Bearer $TELNYX_API_KEY"

# Fallback if the above 404s:
curl https://api.telnyx.com/v2/email_messages/$MESSAGE_ID \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

Used in `email_tools.fetch_inbound_message()`.

## Webhook events reference

**Inbound** (triggers the AI reply flow):
| Event | Description |
|---|---|
| `email.received` *(name being confirmed)* | New inbound email arrived in the inbox |

**Outbound** (logged to the dashboard, no action taken):
| Event | Description |
|---|---|
| `email.queued` | Message accepted and queued for sending |
| `email.sending` | Message is being processed by the MTA |
| `email.sent` | Message handed off to the receiving server |
| `email.delivered` | Receiving server confirmed delivery |
| `email.opened` | Recipient opened the message (pixel tracked) |
| `email.clicked` | Recipient clicked a tracked link |
| `email.bounced` | Hard bounce, message could not be delivered |
| `email.deferred` | Soft bounce, delivery retried on schedule |
| `email.failed` | Sending failed after all retries |
| `email.unsubscribed` | Recipient unsubscribed via link or header |
| `email.complained` | Recipient marked as spam at their provider |
| `email.rejected` | Pre-send rejection, reputation or validation |

## Email validation

`POST /v2/email_validations`

Single or batch validation. Free. Same API key. Use to validate the inbound sender before generating a reply.

```bash
curl -X POST https://api.telnyx.com/v2/email_validations \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email": "[email protected]"}'
```

## Suppressions

`/v2/suppressions`

Auto-suppresses bounces, spam complaints, unsubscribes, and invalid addresses. Two-tier check at API and inject time eliminates the race between checking and sending. Replies to suppressed addresses are blocked at send time with a 422.

## References

- [Email API launch blog](https://telnyx.com/resources/how-to-send-emails-using-api) — full feature walkthrough
- [Email API quickstart](https://developers.telnyx.com/docs/messaging/email/quickstart)
- [Email API API reference](https://developers.telnyx.com/api-reference/email-messages/create-or-send-an-email-message)
- [Telnyx AI Inference docs](https://developers.telnyx.com/docs/inference/chat-completions)
- [Telnyx AI repo (skills, toolkit, MCP)](https://github.com/team-telnyx/ai)
