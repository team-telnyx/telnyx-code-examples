# API Reference

This sample calls the Telnyx Email API from `server.js`.

## `POST /v2/email_messages`

Sends a test email from the configured sender to the configured recipient.

The request includes message-level open and click tracking:

```js
tracking_settings: {
  open_tracking: true,
  click_tracking: true,
}
```

If `tracking_settings` is omitted, the message inherits the sender domain's default tracking settings.

## `GET /v2/email_messages/{id}/events`

Fetches lifecycle and engagement events for a message, including:

- `email.queued`
- `email.sending`
- `email.sent`
- `email.delivered`
- `email.opened`
- `email.clicked`
- `email.bounced`
- `email.unsubscribed`

## `GET /v2/email_events`

Used as a fallback when the per-message endpoint is unavailable. The sample filters by `email_id`.

## Local endpoints

The Node server exposes these local-only endpoints:

- `GET /` - serves the dashboard
- `GET /api/config` - returns masked sender and recipient addresses
- `POST /api/send` - sends one test email
- `GET /api/stats` - returns counts, rates, messages, and events

The API key is never returned to the browser.
