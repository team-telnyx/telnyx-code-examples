# Guide: Live Support Coach Room

This guide walks you through the `live-support-coach-room` sample: a Telnyx Edge Agent that streams a live AI support call's conversation events to a supervisor dashboard, injects coaching nudges mid-call, and escalates to a human WebRTC softphone when needed.

## What you'll build

The actor IS the supervisor room for one support conversation. The assistant streams every event to the room over the **conversation event stream** (`websocket_settings`); supervisors watch the live transcript, and the room watches the feed for coaching triggers and injects nudges via `conversation.item.create`. When a human is needed, the room dials the supervisor and joins that leg into the running AI conversation with `ai_assistant_join`.

## Prerequisites

- [Telnyx Edge CLI](https://github.com/team-telnyx/edge-compute/releases) v0.2.2+
- Node.js 18+
- A [Telnyx API key](https://portal.telnyx.com/api-keys)
- A Call Control connection + outbound voice profile (for escalation)
- A supervisor device (WebRTC softphone credential or a plain phone number)

## Step 1 — Deploy the edge function

```bash
npm install
telnyx-edge auth api-key set <your_telnyx_api_key>
telnyx-edge new-func -l ts -n live-support-coach-room --from-dir .
telnyx-edge secrets add TELNYX_API_KEY "<your_key>"
telnyx-edge secrets add COACH_AUTH "<integration-secret-value>"
telnyx-edge secrets add CALL_CONTROL_CONNECTION_ID "<conn-id>"
telnyx-edge secrets add TELNYX_NUMBER "+1555XXXXXXXX"
telnyx-edge secrets add SUPERVISOR_DEVICE "+1555XXXXXXXX"
telnyx-edge types
telnyx-edge ship
```

`ship` prints the function URL — call it `<fn-url>` below.

## Step 2 — Point an assistant's event stream at the room

Configure `websocket_settings` on your AI assistant. The URL is static; Telnyx opens one socket per conversation to it:

```bash
curl -X POST https://api.telnyx.com/v2/ai/assistants/{assistant_id} \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "websocket_settings": {
      "enabled": true,
      "url": "wss://<fn-host>/agents/assist/livewire",
      "auth_ref": "<your COACH_AUTH integration secret>"
    }
  }'
```

Telnyx sends the secret as `Authorization: Bearer <value>` on the upgrade request. The `livewire` id segment is required — the agent mount addresses one actor per path id. When a call starts, you'll see `session.created` land in the relay and a new room appear under `GET /rooms`.

## Step 3 — Run the demo (no telephony needed)

Two browser tabs:

1. `<fn-url>/caller` — the **caller simulator**. Start a simulated call, send caller turns. The same event shapes flow through the room as a real call.
2. `<fn-url>/dashboard` — the **supervisor dashboard**. Enter the `COACH_AUTH` value, pick the room, watch the transcript and flags update live.

Demo the triggers:

- **Identity loop**: send a caller turn containing "account number" (or 4+ digits) twice → the room injects the DOB nudge; it appears as a coach turn in both tabs.
- **Refund promise**: mention "refund" once → a `refund_promise` flag appears.
- **Silence**: `SILENCE_SECS` (default 90) after the last frame → a check-in nudge fires (only while the room is live).
- **Escalation**: click **Escalate to supervisor** in the dashboard. The room dials `SUPERVISOR_DEVICE` via Call Control, then joins that leg into the AI conversation with `ai_assistant_join`. The supervisor speaks with the caller in the same conversation.
- **Side-channel proof**: kill the coach server mid-call (`telnyx-edge deploy` a bad build, or restart the function). The live call is untouched — the socket is a side channel. Telnyx reconnects with exponential backoff (1s → 30s); the dashboard resyncs from the room snapshot without replaying backlog.
- **Audit trail**: end the call → `session.ended` files a `coach_log` row (conversation id, flags, nudge count, takeover, duration) to per-actor SQL and the room resets. `GET /rooms/{id}/log` shows the rows.

## How the pieces fit

| Piece | Role |
|---|---|
| `AssistRelay` | Fixed sink for the static `websocket_settings.url`; verifies the Bearer auth, binds each socket to its conversation at `session.created`, routes frames to the room, writes inject frames back |
| `CoachRoom` | One durable actor per conversation (`idFromName(conversation_id)`): transcript, policy flags, nudge budget, silence watcher, `coach_log`, `@rpc joinCall` |
| `CoachRegistry` | The shift's room list for the dashboard picker and `GET /rooms` |
| Supervisor desk | `AgentSocketServer` on the room: snapshot on connect + merge-patch on every state change — the live view, no backlog replay |

## Why the socket can't hurt the call

Per the [event-stream docs](https://developers.telnyx.com/docs/inference/ai-assistants/conversation-event-stream): events are dropped, not queued, while the socket is down; no socket failure reaches the call; Telnyx reconnects with exponential backoff. That is what makes coach-first support safe — the coach observes and injects, it is never in the call path.

## Going live

- Point the assistant's `websocket_settings` at your deployed function (Step 2) and place a real call to the assistant.
- Set `SUPERVISOR_DEVICE` to the supervisor's actual device; register the [Telnyx WebRTC](https://developers.telnyx.com/docs/development/webrtc/js-sdk/tutorials/make-your-first-call) credential's login token in the dashboard's softphone panel. The softphone auto-answers muted and unmutes once the leg joins the AI conversation.
- Tune `NUDGE_MAX_PER_CALL` and `SILENCE_SECS` with `telnyx-edge secrets add` — no redeploy needed.
