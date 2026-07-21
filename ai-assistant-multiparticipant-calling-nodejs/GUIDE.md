# Build AI Assistant Multiparticipant Calling With Node.js

This guide walks through a Telnyx Voice AI pattern where an AI Assistant answers an inbound call, calls a backend tool, and your backend adds a human specialist to the same live AI conversation.

## Flow

1. Caller dials your Telnyx number.
2. Telnyx sends `call.initiated` to `/webhooks/voice`.
3. The app answers with an inline AI Assistant.
4. AI events include a `conversation_id`; the app stores it.
5. The assistant classifies the issue and asks for consent.
6. The assistant calls `dial_specialist`.
7. The backend dials the specialist with `POST /v2/calls`.
8. Telnyx sends `call.answered` for the specialist leg.
9. The backend calls `ai_assistant_join` with the existing `conversation_id`.
10. Caller, AI, and specialist continue in one live conversation.

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-assistant-multiparticipant-calling-nodejs
cp .env.example .env
npm install
npm test
```

Fill in `.env`:

- `TELNYX_API_KEY`
- `CONNECTION_ID`
- `TELNYX_NUMBER`
- `SPECIALIST_NUMBER`
- `PUBLIC_URL`

Expose the app:

```bash
ngrok http 8787
```

Set `PUBLIC_URL` to the HTTPS ngrok URL and restart the server:

```bash
npm start
```

## Portal Configuration

In the Telnyx Portal:

1. Create or open a Programmable Voice / Voice API application.
2. Set the webhook URL to `https://<your-ngrok-domain>/webhooks/voice`.
3. Assign your Telnyx number to that application.
4. Call the number from a phone.

This example answers the call with an inline assistant config, so you do not need to pre-create an assistant in the Portal to try the basic version.

## Core Join Step

The key API call happens after the specialist answers:

```js
await telnyxPost(`/calls/${specialistCallControlId}/actions/ai_assistant_join`, {
  conversation_id: session.conversationId,
  participant: {
    id: specialistCallControlId,
    role: "user",
    name: "support specialist",
    on_hangup: "continue_conversation",
  },
});
```

That `conversation_id` is what ties the second call leg to the live AI conversation.

## Production Notes

- Verify Telnyx webhook signatures before trusting inbound webhook payloads.
- Store sessions in Redis or a database instead of memory.
- Add retry handling around outbound dialing and join failures.
- Add assistant instructions or a Skip Turn tool so the AI stays quiet while humans are talking.
- Log consent before dialing a human participant.
