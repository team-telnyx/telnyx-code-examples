---
name: sms-two-factor-auth
title: "SMS Two-Factor Authentication (OTP)"
description: "Production-ready OTP 2FA system with Node.js and Express. Generates one-time passwords, delivers them over SMS via the Telnyx Messaging API, and verifies them with expiration, attempt limits, and rate limiting."
language: nodejs
framework: express
telnyx_products: [Messaging]
channel: [sms]
---

# SMS Two-Factor Authentication (OTP)

Production-ready OTP 2FA system with Node.js and Express. Generates one-time passwords, delivers them over SMS via the Telnyx Messaging API, and verifies them with expiration, attempt limits, and rate limiting.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network. For SMS OTP delivery that means high deliverability, low latency, and a single API for everything from one-time passcodes to voice fallback.

- **Deliverability built in** — number reputation, 10DLC registration, and deliverability monitoring included.
- **Global private network** — OTP messages traverse the Telnyx-owned IP backbone for lower latency than the public internet.
- **Developer-first SDKs** — the official `telnyx` Node.js SDK is used here for sending messages and typed error handling.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)

Called by the app via the Node.js SDK as `client.messages.send({ from, to, text })`.

## Architecture

```
  POST /auth/request-otp                 POST /auth/verify-otp
        │                                       │
        ▼                                       ▼
  ┌──────────────┐                       ┌──────────────┐
  │ generateOTP  │                       │  verifyOTP    │
  └──────┬───────┘                       └──────┬───────┘
         │                                      │
         ▼                                      ▼
  ┌──────────────┐   store otp + expiry   ┌──────────────┐
  │  sendOTPSMS  │──────────────────────► │  otpStore    │
  └──────┬───────┘                        │  (in-memory) │
         │                                └──────────────┘
         ▼
  ┌──────────────────┐
  │ Telnyx Messaging  │──► SMS with code to user's phone
  └──────────────────┘
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `TELNYX_PHONE_NUMBER` | `string` | `+15551234567` | **yes** | Telnyx number that sends the OTP (E.164) | [My Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `OTP_EXPIRY_SECONDS` | `integer` | `300` | no | OTP lifetime in seconds (default `300`) | — |
| `OTP_LENGTH` | `integer` | `6` | no | Number of digits in the OTP (default `6`) | — |
| `PORT` | `integer` | `5000` | no | Port the Express server listens on (default `3000`) | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-two-factor-auth-nodejs
cp .env.example .env    # ← fill in your credentials
npm install
node server.js          # starts on http://localhost:5000 (or $PORT)
```

There are no webhooks to configure — this example only sends outbound SMS and verifies codes against in-memory storage.

## API Reference

### `POST /auth/request-otp`

Generate an OTP, send it over SMS, and store it for later verification. Rate limited to 5 requests per phone number per 15 minutes.

```bash
curl -X POST http://localhost:5000/auth/request-otp \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+12125551234"}'
```

**Response `200`:**

```json
{
  "message": "OTP sent successfully",
  "message_id": "msg-f5d7a7e0-1234-5678",
  "expires_in_seconds": 300
}
```

### `POST /auth/verify-otp`

Verify a user-supplied OTP against the stored value. On success the OTP is consumed and a session token is returned. After 3 failed attempts the OTP is invalidated.

```bash
curl -X POST http://localhost:5000/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+12125551234", "otp": "123456"}'
```

**Response `200`:**

```json
{
  "message": "OTP verified successfully",
  "authenticated": true,
  "session_token": "session_1718700000000"
}
```

**Response `401` (bad or expired code):**

```json
{
  "message": "Invalid OTP. Please try again.",
  "authenticated": false
}
```

### `GET /health`

Liveness check.

```bash
curl http://localhost:5000/health
```

**Response `200`:**

```json
{ "status": "ok" }
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 {"error": "Invalid API key"}` | `TELNYX_API_KEY` is missing, wrong, or has trailing whitespace/quotes. | Copy a fresh key from [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys), update `.env`, and restart `node server.js`. |
| `400 Phone number must be in E.164 format` | The `phone_number` value does not start with `+`. | Send numbers as E.164, e.g. `+15551234567` (US) or `+447700900123` (UK). |
| `{"message": "OTP has expired. Request a new one."}` | More than `OTP_EXPIRY_SECONDS` elapsed before verifying. | Increase `OTP_EXPIRY_SECONDS` in `.env` for testing; keep it short (3–5 min) in production. |
| `429 {"error": "Too many OTP requests. Try again later."}` | More than 5 OTP requests for the same number within 15 minutes. | Wait for the window to reset, or adjust the limiter constants in `server.js`. |
| `{"message": "Too many failed attempts. Request a new OTP."}` | 3 incorrect verification attempts were made for the same OTP. | Request a new OTP via `/auth/request-otp` and try again. |
| OTP SMS never arrives | `TELNYX_PHONE_NUMBER` is not SMS-enabled, or the account lacks credit. | Confirm the number has messaging enabled in the [Portal](https://portal.telnyx.com) and the account is funded. |

## Related Examples

- [sms-two-factor-auth-python](../sms-two-factor-auth-python/) — same OTP 2FA flow in Python
- [verify-phone-number-otp-flow-python](../verify-phone-number-otp-flow-python/) — OTP using the Telnyx Verify API
- [send-sms-nodejs](../send-sms-nodejs/) — minimal outbound SMS in Node.js
- [receive-sms-webhook-nodejs](../receive-sms-webhook-nodejs/) — handle inbound SMS webhooks

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Send a Message — API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
