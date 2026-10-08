# API

## `POST /webhooks/voice`

The Call Control webhook. Events handled:

| Event | Behavior |
|---|---|
| `call.initiated` (incoming) | Records the caller (`CALLSTART` row, ccid attached), injects `routing_history` from the durable log, answers with the line's assistant persona |
| `call.initiated` (outgoing) | Ignored |
| `call.answered` (on-call nurse's leg) | Speaks the escalation briefing to the nurse ("You have an urgent patient on the line: …"), then transfers the live patient call onto the nurse's leg |
| `call.speak.failed` | Logged for diagnosis |
| `call.hangup` | Acknowledged |

## `POST /log/{caller}/{intent}`

Called by the assistants' `log_*` webhook tools. `{caller}` may arrive as a dynamic-variable template — when it does, the function falls back to the current caller from the latest `CALLSTART` row. Writes a routing-log row.

Response: `{"ok":true,"logged":"billing","caller":"+1…"}`

## `POST /escalate/{caller}?ccid=…&conv=…`

Called by the `escalate_urgent` tool. Sequence:

1. Fetches the conversation transcript (`GET /ai/conversations/{conv}/messages`) — best effort
2. Sends the on-call SMS: caller, what was said, context (`→ call the caller back now`)
3. Dials the on-call nurse live (the caller's phone sees the clinic's caller ID)
4. Logs an `ESCALATED 🚨` row

When the nurse answers, `call.answered` speaks the briefing and bridges the patient. Response: `{"ok":true,"escalated":true,"sms_sent":true}`

## `GET /escalations`

The care-team view: every escalation with caller, timestamp, what the patient said, and the conversation context. Rendered from the durable routing log — no external database.

## `GET /` and `GET /healthz`

Status page (recent routing rows) and health probe.

## Notes

- Caller identity is function-owned: the tools carry no caller identity — the function resolves the current caller from its `CALLSTART` log. This avoids relying on dynamic-variable substitution in tool URLs and on LLM tool-argument filling.
- All assistant-driven logging is intent-in-URL (`/log/{caller}/billing`): the model picks the tool, the function attaches the identity.
