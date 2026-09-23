# Guide

This guide walks through the end-to-end flow for the local Email API dashboard.

## 1. Configure the environment

Copy the example environment file:

```bash
cp .env.example .env
```

Fill in:

```bash
TELNYX_API_KEY=KEY_your_telnyx_api_key_here
FROM_EMAIL=sender@example.com
TO_EMAIL=you@example.com
```

`FROM_EMAIL` must be a sender that your Telnyx account can use.

## 2. Start the app

```bash
npm start
```

Open:

```text
http://localhost:3000
```

## 3. Send a test email

Click **Send test email**. The server calls:

```text
POST /v2/email_messages
```

The request enables open and click tracking for this specific send with `tracking_settings`.

## 4. Watch events update

The dashboard polls events every 10 seconds. After the email is delivered, open it and click the link. The event log should update as Telnyx returns delivery and engagement events.

## 5. Build from here

You can extend this sample by adding:

- scheduled sends
- templates
- suppressions
- webhook subscriptions
- persistent storage instead of local `data/sent.json`
