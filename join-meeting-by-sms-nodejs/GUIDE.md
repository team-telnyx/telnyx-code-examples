# Send a Bot to Your Meeting by Text Message

You double-booked, or you are on a train. Text a meeting link to a number, and a bot joins as you, tells everyone you are out, takes notes, and texts you a TL;DR afterwards. This guide builds that with Telnyx Messaging and Telnyx Meeting Bot in about 200 lines of Node.js.

## What you need

- A Telnyx account and API key
- An SMS-enabled Telnyx number on a Messaging Profile
- Node.js 18+ and a way to expose localhost (ngrok works)

## 1. Receive the text, and verify it

Telnyx posts every inbound SMS to your webhook. Anyone can post to a public URL, so verify the Ed25519 signature before trusting the body. That needs the raw bytes, so the route uses `express.raw` rather than a JSON parser:

```js
app.post("/webhooks/sms", express.raw({ type: "*/*" }), async (req, res) => {
  const event = await client.webhooks.unwrap(req.body.toString(), { headers: req.headers });
  res.status(200).json({ received: true }); // acknowledge fast
  // ...handle event
});
```

## 2. Only listen to yourself

Anyone who finds your number could otherwise send a bot into any meeting. The handler compares the sender with `OWNER_PHONE_NUMBER` and ignores everyone else.

## 3. Send the bot in

A regex pulls the meeting URL out of your text. Then one call creates the session:

```js
await client.meetingSessions.create({
  meeting_url: meetingUrl,
  bot_name: "Your Bot",
  chat_on_enter: "Hi all - I am a bot attending on behalf of a teammate...",
  summarize_on_end: true,
  idempotency_key: `join-meeting-by-sms:${messageId}`,
});
```

Two details matter here:

- **Idempotency key.** Telnyx retries webhooks that do not get a fast `2xx`. Keying the session on the inbound message ID means a retry replays the same session instead of adding a second bot.
- **Active-session check.** If you text the same link twice, the server finds the running session and tells you the bot is already there.

## 4. Keep you posted

`watchSession` polls the session every five seconds and texts you once per status change: waiting room, then in the meeting. Polling keeps the sample runnable on localhost with one webhook URL. If you want to avoid polling, create the session with a `webhook_url` and handle its lifecycle callbacks instead.

## 5. Text the TL;DR

With `summarize_on_end: true`, Telnyx generates a `summary` artifact from the transcript when the meeting ends. The server waits for it to complete (up to 90 seconds) and texts it to you. If it fails, you get a fallback message rather than silence.

## Optional: let the bot talk

Set `ASSISTANT_ID` to attach a Telnyx AI Assistant. The bot can then answer questions in the meeting, for example "what is my teammate working on?". Use `chat_on_enter` to announce it, because `speak_on_enter` is not spoken when an assistant is attached.

## Run it

```bash
cp .env.example .env
npm install
npm start
```

Point your Messaging Profile's webhook at `https://<your-tunnel>/webhooks/sms`, then text your number a meeting link.

## Before you ship this

- **Persist state.** Watched sessions live in memory; a restart stops the status texts. Store session IDs in a database and resume on boot.
- **Disclose the bot.** Keep a clear `chat_on_enter` message. People in the meeting should know a bot is recording.
- **Register your sender.** US SMS needs 10DLC or toll-free verification before replies are reliably delivered.
