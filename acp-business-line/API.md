# API Reference — acp-business-line

This example is configuration-only: it ships no HTTP server. The surface below is what the Agent Control Plane exposes for the agent once you run `telnyx-acp dev` (local) or `telnyx-acp deploy` (deployed).

> **Beta.** The Agent Control Plane is in beta. See [beta limitations](https://developers.telnyx.com/docs/agents/beta-limitations).

## Conversation address

One conversation is one instance of the agent, named by the last segment of its address.

| Environment | Address |
|-------------|---------|
| `dev` | `http://127.0.0.1:8787/agents/acp-business-line/<conversation>` |
| Deployed | `https://<function>.telnyxcompute.com/agents/acp-business-line/<conversation>` |

Every conversation answers over WebSocket, Server-Sent Events, and RPC.

Conversation identity:

| Inbound | `<conversation>` |
|---------|------------------|
| A text | the sender's number — one instance per phone |
| A call | the call's id — one instance per call |
| `invoke`, `chat`, `rpc` | the `--conversation` value |

## CLI verbs

| Verb | Purpose |
|------|---------|
| `telnyx-acp validate` | Check `agent.json`; every problem names the field and the fix |
| `telnyx-acp dev` | Run the agent on this machine; watches `instructions.md` and `agent.json` |
| `telnyx-acp chat [--local]` | Interactive conversation; `--local` targets `dev` |
| `telnyx-acp invoke acp-business-line --conversation <id> [--local] [--stream] "<text>"` | One text turn; `--stream` prints each assistant message as it lands |
| `telnyx-acp text "<message>"` | One SMS to the agent's number from one of the account's own numbers; both are Telnyx's, so no 10DLC registration is needed |
| `telnyx-acp add phone <E.164>` / `remove phone <E.164>` | Edit the numbers the agent answers on (applied on the next `deploy`) |
| `telnyx-acp set voice.<knob> <value>` | Change one `voice` knob, e.g. `set voice.greeting "Hello, how can I help?"` |
| `telnyx-acp deploy [--dry-run] [--yes]` | Generate `.telnyx/`, ship it, wire numbers and webhooks; every deploy is a new revision |
| `telnyx-acp status` | Function state, revision, numbers, webhook health, mount address |
| `telnyx-acp logs [--since <dur>] [--tail] [--type invocations]` | One JSON line per runtime event |
| `telnyx-acp traces <conversation> [run]` | Run list, or one run's waterfall: model calls (tokens, finish reason), tool calls, delivery, timings |
| `telnyx-acp versions acp-business-line` | Every revision, with the git short SHA at ship time |
| `telnyx-acp delete acp-business-line` | Tear down everything `deploy` created; webhooks restored, numbers released |

## Example turns

```bash
$ telnyx-acp invoke acp-business-line --conversation intake-demo-1 --local "Hi, I'd like to make an appointment"
Of course, I'd be happy to help! Can I get your name, and a quick word on your appointment?

$ telnyx-acp invoke acp-business-line --conversation intake-demo-1 --local "My name is Jordan Reyes, and I need a checkup. Tuesday afternoon works."
Perfect, Jordan! So that's Jordan Reyes, a checkup, and Tuesday afternoon — I'll pass that to the front desk and they'll follow up to lock in your exact time. Thanks for calling!
```

## Runtime log lines

| Line | Meaning |
|------|---------|
| `voiceCall` | Call lifecycle; `streaming.failed` carries the platform's reason if audio never reaches the agent |
| `voiceWake` | The instance was woken while the phone rang (placement takes 1–3 s) |
| `voiceTurn` | One turn on a call; carries `toFirstAudioMs` and per-stage timings |
| `voiceFiller` | A short "One moment." phrase spoken while the model starts (spoken only, never logged to memory) |
| `modelStream` | Model output streaming; errors name the stage |

Traces hold no message text — they show what the agent did, not what was said. Phone calls are not traced in the beta; use `logs` for call-side detail and `traces` for text/invoke interactions.

## Model and memory

| Field | Value |
|-------|-------|
| Model | `zai-org/GLM-5.3-Flash` (hosted by Telnyx; no key needed) |
| Memory | `agent_memory` in namespace `default`, profile `{{conversation}}` — one profile per conversation, written after turns and read before the next reply |
| Voice | Default Telnyx STT; TTS voice `Telnyx.Ultra.00967b2f-…` (change with `set voice.tts.voice`) |
