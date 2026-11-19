# Demo Script: Bring Your Framework ACP

## Core message

“You already have a loop. Keep it. We are putting two existing frameworks on the Telnyx runtime.”

The shared interaction is intentionally small: ask the agent where order `ORD-10042` is and show the model/tool execution that produces the answer.

## 0:00–0:30 — Setup

- Open the project directory.
- Show `pipecat-edge/` and `langgraph-acp/`.
- Say: “The business logic is deliberately simple. The point is the framework boundary and the runtime.”

## 0:30–3:30 — Pipecat

- Open `pipecat-edge/function/bot.py` and show the upstream loop is unchanged.
- Highlight the Pipecat imports: `Pipeline`, `create_transport`,
  `LLMContextAggregatorPair`, `PipelineWorker`, and `WorkerRunner`.
- Show the pipeline list: `transport.input()` → `stt` → `llm` → `tts` →
  `transport.output()`.
- Say: “This is the Pipecat voice pipeline. Telnyx supplies the call transport,
  STT, model endpoint, and TTS services around it; Pipecat still orchestrates
  the loop.”
- Briefly show the separate deployment copy's demo prompt, explaining that only the business scenario is narrowed; the Pipecat pipeline remains unchanged.
- Run the documented Edge deployment flow.
- Show the TeXML application and number configuration.
- Call the number.
- Ask: “Where is order ORD-10042?”
- Confirm: “It has shipped via Telnyx Logistics and is expected Friday.”
- Show the answer and the native ACP trace surface with `telnyx-acp traces`.

Fallback: pre-ship before recording and show the call plus the deployment configuration if the build is slow.

## 3:30–7:00 — LangGraph

- Open `langgraph-acp/src/index.ts`.
- Show `receive()` adding the message and queueing `process()`.
- Open `src/graph.ts` and show `createReactAgent` plus `lookup_order`.
- Run `telnyx-acp deploy` or play the prepared screencast.
- Send: `where is my order ORD-10042?`
- Show the answer.
- Run `telnyx-acp traces <conversation> <run>` and show the native model, tool,
  and delivery steps. Use `telnyx-acp logs --since 5m` only if you want to
  show detailed framework arguments and results.

## 7:00–8:00 — Close

| Concern | Pipecat | LangGraph |
| --- | --- | --- |
| Framework loop | Existing Python loop | Existing TypeScript/LangGraph loop |
| Telnyx runtime | Telnyx Edge | Agent Runtime via ACP |
| Channel | Phone call | SMS |
| Business tool | Order lookup | Order lookup |
| Deployment | `telnyx-edge ship` | `telnyx-acp deploy` |
| Claim | Framework runs on Telnyx | Framework runs on Telnyx |

Close with: “The framework stays yours. Telnyx provides the runtime, communications, models, and operational surface.”

## Trace validation gate

Before recording, verify that the native trace surface visibly exposes:

1. Conversation invocation
2. Model request
3. Tool call
4. Tool timing/status

Show the final assistant response separately in the Edge web page or CLI
response. Native ACP traces intentionally omit message text, tool arguments,
tool results, and final assistant text.

The trace-enabled code agent exposes `trace` and `traces` methods. The active
Edge revision returns the run, model, and `lookup_order` tool steps. A revision
deployed before trace support can report no traces, so verify the active
revision before recording.

## Recording-ready version

### The message

> “You already have a loop. Keep it. I’m putting two existing frameworks around
> the same small order-status scenario and showing what Telnyx adds around
> them.”

Use the same prompt in both cuts:

```text
Where is order ORD-10042?
```

Expected answer:

```text
Order ORD-10042 has shipped via Telnyx Logistics and is expected to arrive on Friday.
```

### Before recording

Open these primary windows:

1. `pipecat-edge/function/bot.py` — the unchanged Pipecat loop.
2. `langgraph-acp/src/index.ts` and `langgraph-acp/src/graph.ts` — the ACP
   glue and LangGraph loop.
3. A terminal for `telnyx-acp invoke` and `telnyx-acp traces`.

Open the Edge-hosted ACP web page from the deployed revision:

```text
https://<your-acp-mount-url>/web
```

This is the primary browser UI and is served by the same ACP deployment as the
persistent `Conversation` actor. The base Edge URL is only a function mount;
do not open it expecting a page.

If the web revision is still deploying, start the local control room from the
project root as a temporary fallback:

```bash
node ui/server.mjs
```

The local UI at `http://127.0.0.1:4173` can combine the conversation, native ACP
trace, and framework logs into one recording screen. It is not part of the
deployed architecture and should not be presented as the runtime.

The headline remains “bring your framework.” The live setup uses one number
with two channel attachments: Pipecat is attached to the TeXML voice
application, while ACP receives SMS through the existing messaging profile.
This is one Telnyx platform and one number, with two independent framework
cuts.

## Eight-minute recording script

### 0:00–0:30 — Setup

**Show:** the project folder with `pipecat-edge/`, `langgraph-acp/`, and `ui/`.

**Say:**

> “The business logic is deliberately small. The point is the framework
> boundary: the existing loop remains yours while Telnyx provides the runtime,
> communications, models, and operational surface around it.”

### 0:30–3:30 — Pipecat on Telnyx Edge

**0:30–1:10 — Show the loop.** Open `pipecat-edge/function/bot.py`.

> “This is the Pipecat loop. We are not rewriting the pipeline for Telnyx. The
> deployment wrapper is separate from the bot implementation.”

Highlight the actual framework proof:

```text
Pipecat transport input
  → Telnyx STT service
  → Pipecat context aggregator
  → OpenAI-compatible LLM service
  → Telnyx TTS service
  → Pipecat transport output
```

> “You can see Pipecat doing the orchestration: transport, context, model, and
> speech output are framework components. Telnyx is the runtime and service
> layer underneath it.”

If showing the demo deployment copy, add:

> “Only the demo prompt is narrowed to order status so both cuts tell the same
> story. The Pipecat transport and pipeline stay intact.”

**1:10–1:50 — Ship it.** Show the documented commands:

```bash
telnyx-edge new-func -l python --from-dir pipecat-edge
telnyx-edge secrets add <required-secret> <value>
telnyx-edge ship
```

> “This is the existing Edge deployment path. The framework project becomes an
> Edge function; it does not become a Telnyx-specific agent.”

**1:50–2:50 — Call it.** Show the TeXML application and voice number, then ask:

> “Where is order ORD-10042?”

After the answer:

> “That was the Pipecat loop handling the same order-status conversation on the
> Telnyx voice path.”

The combination of the Pipecat imports, the pipeline list, the `telnyx-edge`
deployment, and the live phone call proves that this is a Pipecat voice agent.
The phone call alone would not prove which framework handled it.

Do not add an unrelated everyday-assistant question; it weakens the comparison.

**2:50–3:30 — Transition.**

> “Now I’ll keep the same scenario, but connect a different existing framework
> to the Agent SDK boundary.”

### 3:30–7:00 — LangGraph through ACP

**3:30–4:20 — Show the glue.** Open `langgraph-acp/src/index.ts` and highlight:

```ts
await this.messages.add("user", text);
await this.queue("process");
```

> “`receive()` records the message and queues work. The framework loop runs in
> `process()`, so ACP is providing the boundary and runtime, not replacing
> LangGraph.”

**4:20–5:00 — Show the framework.** Open `src/graph.ts` and point to
`createReactAgent`, the Telnyx-compatible model endpoint, and `lookup_order`.

> “The graph has one visible tool. It returns deterministic demo data so the
> audience can see the tool step without introducing a fake CRM or database.”

**5:00–5:35 — Deploy.** Show:

```bash
telnyx-acp deploy --dry-run
telnyx-acp deploy
```

> “This uses the Agent Control Plane deployment path. The agent keeps its
> LangGraph loop and gains the managed runtime and messaging route.”

**5:35–6:20 — Invoke.** Use the deployed ACP CLI as the reliable primary path
for this existing-messaging-profile configuration:

```bash
telnyx-acp invoke bring-your-framework-langgraph \
  --conversation demo \
  "Where is my order ORD-10042?"
```

You can also send the same message from the Edge-hosted `/web` page or from a
real handset over SMS. The CLI `text` shortcut is for ACP phone mode and is not
the primary command here because this project preserves Pipecat's existing
TeXML voice attachment.

**6:20–7:00 — Show the native ACP trace.** Use the run id from the invocation:

```bash
telnyx-acp traces <conversation> <run>
```

Read the sequence shown by ACP:

> “This is the persistent actor's native ACP trace: the model step and the
> LangGraph tool step for the conversation we just ran. The reply is shown in
> the Edge UI; ACP deliberately keeps message text out of this trace view.”

Then be precise:

> “The native trace shows execution steps and timings. Message text and tool
> details are intentionally not exposed in this trace view.”

### 7:00–8:00 — Close

Show this comparison:

| Concern | Pipecat | LangGraph |
|---|---|---|
| Existing loop | Python Pipecat pipeline | TypeScript LangGraph ReAct graph |
| Telnyx surface | Telnyx Edge | Agent Runtime via ACP |
| Channel | Voice call | SMS/ACP text invocation |
| Business tool | Order lookup behavior | `lookup_order` |
| Deployment | `telnyx-edge ship` | `telnyx-acp deploy` |
| Claim | This framework runs on Telnyx | This framework runs on Telnyx |

Close with:

> “The framework stays yours. Telnyx provides the runtime, communications,
> model access, and operational surface around it.”

### Fallbacks

- Pre-ship Pipecat and show the call if the Edge build is slow.
- Use the LangGraph screencast if the beta ACP CLI surface changes.
- If the deployed revision predates trace support, deploy once more before the
  recording. The trace-enabled path is `telnyx-acp traces <conversation> <run>`.
  Use framework logs only as the detailed fallback.
- If handset SMS is unavailable, use `telnyx-acp text` or the local control room;
  do not imply that a handset reply was demonstrated.

### Claims to avoid

- Framework parity beyond the two cuts actually run on stage.
- Python support for the ACP managed harness.
- ACP-native spans for LangGraph’s internal model/tool calls.
- A shared phone number when the channel attachments are separate.
- A production order system, CRM, calendar, or business workflow.

