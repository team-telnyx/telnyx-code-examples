# Provisional Agents with Telnyx Voice API

Use one reusable Telnyx AI Assistant for many businesses by applying runtime configuration when each Telnyx Voice API call is answered.

## How It Works

The base AI Assistant owns stable setup:

- model
- voice
- tools
- general appointment scheduling behavior

Runtime configuration owns call-specific behavior:

- business name
- greeting
- appointment services
- business hours
- tone

On every Telnyx Voice API call, the webhook chooses a config and sends those details to `ai_assistant_start` as runtime `assistant.instructions` and `assistant.greeting`.

## Project Files

| File | Purpose |
|------|---------|
| `server.js` | Express webhook server, preview command, and optional outbound call helper |
| `examples/number-routing.json` | Maps called Telnyx numbers to business config slugs |
| `examples/*.json` | Runtime business configs |
| `prompts/appointment-scheduling-assistant.md` | Prompt template rendered for the active call |
| `.env.example` | Required environment variable names |

## Step 1: Install

Prerequisite: Node.js 18 or newer.

```bash
cd telnyx-code-examples/provisional-telnyx-voice-api-agents-nodejs
cp .env.example .env
npm install
```

## Step 2: Create a Base Assistant

Create a Telnyx AI Assistant in the Telnyx Portal. Keep the assistant generic.

Good base-assistant content:

- appointment scheduling behavior
- concise voice style
- any shared tools or stable settings

Do not put business-specific details in the base assistant:

- no clinic name
- no location-specific hours
- no fixed greeting
- no location-specific service list

Add the assistant id to `.env`:

```bash
BASE_ASSISTANT_ID=assistant-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

## Step 3: Preview a Provisional Agent with Telnyx Voice API

Run:

```bash
npm run preview -- smile-dental
```

The Telnyx Voice API provisional-agent preview prints:

- selected business
- runtime greeting
- rendered instructions
- `ai_assistant_start` payload

This is the fastest way to confirm that the config and prompt template produce the expected behavior before making live Telnyx Voice API calls.

## Step 4: Configure Number Routing

Edit `examples/number-routing.json` and map each Telnyx number to a config:

```json
{
  "+15551111111": "smile-dental",
  "+15552222222": "northside-medical",
  "+15553333333": "brightcare-physical-therapy"
}
```

The called number must match the number format sent by the Telnyx webhook. Use E.164 format.

## Step 5: Run the Server

```bash
npm start
```

Expose it publicly:

```bash
ngrok http 5000
```

Set your Telnyx Voice API application webhook URL to:

```text
https://<id>.ngrok.io/webhooks/voice
```

Assign your Telnyx phone number to that Voice API application.

## Step 6: Call the Telnyx Voice API Number

When the call arrives:

1. `call.initiated` is received.
2. The server calls the Answer Call endpoint.
3. `call.answered` is received.
4. The called number selects a business config.
5. The prompt template is rendered with that business config.
6. The server calls `ai_assistant_start`.
7. The caller speaks with the base Telnyx AI Assistant configured for that business on the Telnyx Voice API call.

## Optional Telnyx Voice API Outbound Test

Use the Telnyx Voice API outbound helper when you want to test one business config without relying on called-number routing:

```bash
npm run call -- brightcare-physical-therapy
```

This helper requires:

- `TELNYX_CONNECTION_ID`
- `TELNYX_FROM_NUMBER`
- `TEST_TO_NUMBER`

The Telnyx Voice API helper sends `client_state` with the selected business config. The webhook checks `client_state` before called-number routing.

## Local Webhook Testing

For local cURL tests, leave `TELNYX_PUBLIC_KEY` unset. Then start the server and post a sample `call.answered` event:

```bash
curl -X POST http://localhost:5000/webhooks/voice \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "event_type": "call.answered",
      "payload": {
        "call_control_id": "v3:demo-call-control-id",
        "to": { "number": "+15551111111" }
      }
    }
  }'
```

This request still attempts the live Telnyx Voice API `ai_assistant_start` command, so it requires valid Telnyx credentials and a real `call_control_id` to succeed. Use `npm run preview` when you only want to inspect the generated payload.

## Production Notes

- Set `TELNYX_PUBLIC_KEY` and reject unsigned webhooks.
- Store routing and business configs in a database if they change at runtime.
- Add idempotency for retried webhooks before issuing call commands.
- Keep `BASE_ASSISTANT_ID` business-agnostic.
- Treat runtime config as user-facing prompt content and review it before production use.
- Add calendar, CRM, or scheduling tools to the base assistant when the demo needs real booking behavior.
