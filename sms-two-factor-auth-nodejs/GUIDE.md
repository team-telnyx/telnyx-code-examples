# Build SMS Two-Factor Authentication with Telnyx and Node.js

Build a production-ready OTP 2FA system with Node.js and Express. Generate one-time passwords, deliver them over SMS via the Telnyx Messaging API, and verify them with expiration, attempt limits, and rate limiting.

## How It Works

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

## Telnyx Products Used

- **Messaging** — send the OTP code as an outbound SMS with delivery tracking

## API Endpoints

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)

## Prerequisites

- Node.js 18+ (Node.js 20 LTS recommended)
- npm
- [Telnyx account](https://portal.telnyx.com/sign-up) with a funded balance
- [API key](https://portal.telnyx.com/api-keys)
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) enabled for outbound SMS
- curl or Postman for testing the endpoints

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-two-factor-auth-nodejs
cp .env.example .env
npm install
```

Edit `.env` with your Telnyx credentials:

| Variable | What to set |
|----------|-------------|
| `TELNYX_API_KEY` | Your API v2 key from the [Portal](https://portal.telnyx.com/api-keys) |
| `TELNYX_PHONE_NUMBER` | Your SMS-enabled Telnyx number in E.164 format |
| `OTP_EXPIRY_SECONDS` | OTP lifetime in seconds (default `300`) |
| `OTP_LENGTH` | Number of digits in the OTP (default `6`) |
| `PORT` | Port for the Express server (default `3000`) |

## Step 2: Understand the Code

Everything lives in `server.js`. Here is what each piece does.

### Helper Functions

- **`generateOTP(length)`** — produces a random numeric code of the configured length.
- **`sendOTPSMS(toNumber, otp)`** — validates the destination is E.164, then sends the code via `client.messages.send()` and returns the serializable `message_id`, `status`, and `to`.
- **`storeOTP(phoneNumber, otp)`** — saves the code in the in-memory `otpStore` with an expiry timestamp and an attempt counter.
- **`verifyOTP(phoneNumber, otp)`** — checks the stored code: returns failure if missing, expired, over the 3-attempt limit, or mismatched; on a match it deletes the entry and returns success.
- **`checkOTPRateLimit(phoneNumber)`** — a sliding-window limiter allowing 5 OTP requests per number per 15 minutes.

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/auth/request-otp` | Generate, send, and store an OTP |
| `POST` | `/auth/verify-otp` | Verify a user-supplied OTP and issue a session token |
| `GET` | `/health` | Liveness check |

The request endpoint generates the code, sends it, and stores it:

```javascript
app.post("/auth/request-otp", async (req, res) => {
  const { phone_number } = req.body;

  if (!phone_number) {
    return res.status(400).json({ error: "Missing required field: 'phone_number'" });
  }

  if (!checkOTPRateLimit(phone_number)) {
    return res.status(429).json({ error: "Too many OTP requests. Try again later." });
  }

  const otp = generateOTP(parseInt(process.env.OTP_LENGTH || "6", 10));
  const smsResult = await sendOTPSMS(phone_number, otp);
  storeOTP(phone_number, otp);

  return res.status(200).json({
    message: "OTP sent successfully",
    message_id: smsResult.message_id,
    expires_in_seconds: parseInt(process.env.OTP_EXPIRY_SECONDS || "300", 10),
  });
});
```

The verify endpoint checks the code and, on success, returns a session token:

```javascript
app.post("/auth/verify-otp", (req, res) => {
  const { phone_number, otp } = req.body;
  const result = verifyOTP(phone_number, otp);

  if (result.success) {
    return res.status(200).json({
      message: result.message,
      authenticated: true,
      session_token: `session_${Date.now()}`,
    });
  }

  return res.status(401).json({ message: result.message, authenticated: false });
});
```

## Step 3: Run It

```bash
node server.js
```

The server starts on `http://localhost:5000` (or whatever `PORT` you set).

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Request an OTP** (sends an SMS to your phone):

```bash
curl -X POST http://localhost:5000/auth/request-otp \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+12125551234"}'
```

**Verify the OTP** using the code from the SMS:

```bash
curl -X POST http://localhost:5000/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+12125551234", "otp": "123456"}'
```

A correct code returns `"authenticated": true` and a `session_token`.

## Going to Production

This example uses in-memory storage for simplicity. For production:

- **Persistent store** — replace the in-memory `Map` for OTPs and the rate limiter with Redis so codes survive restarts and work across multiple instances.
- **Real sessions** — swap the placeholder `session_${Date.now()}` for a signed JWT or server-side session.
- **Authentication & abuse protection** — keep the per-number rate limit, and consider per-IP limits and CAPTCHA on the request endpoint.
- **Monitoring** — add structured logging and alerting on the `/health` endpoint and OTP failure rates.

## Run

```bash
npm install
node server.js
```

## Resources

- [Source code and reference](./README.md)
- [Typed endpoint reference](./API.md)
- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send a Message — API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx Portal](https://portal.telnyx.com)
