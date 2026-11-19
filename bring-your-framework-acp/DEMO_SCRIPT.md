# Demo Script: Bring Your Framework ACP

## Message

> You already have a loop. Keep it.

This demo shows two independent framework cuts using the same small order-status
scenario. The order data is only a visible tool fixture; the reusable part is
the framework boundary and Telnyx runtime integration.

## Before recording

Open these windows:

1. `pipecat-edge/function/bot.py`
2. `langgraph-acp/src/index.ts`, `src/graph.ts`, and `src/tools.ts`
3. The Edge-hosted ACP web page
4. A terminal for deployment and native traces
5. A phone for the Pipecat call

Do not show `.env`, API keys, ACP secrets, or account-specific deployment
configuration.

Run the checks before recording:

```bash
cd langgraph-acp
npm run typecheck
npm test
telnyx-acp status
```

## 0:00–0:30 — Opening

**Show:** the project folders.

**Say:**

> “You already have an agent loop. Keep it. I’m showing two existing
> frameworks running on Telnyx: Pipecat for voice and LangGraph through ACP for
> messaging. The order-status example is deliberately small so the framework
> boundary, deployment, persistence, and trace are easy to see.”

## 0:30–3:00 — Pipecat voice cut

**Show:** `pipecat-edge/function/bot.py`.

Highlight the Pipecat imports and this pipeline:

```python
pipeline = Pipeline([
    transport.input(),
    stt,
    user_aggregator,
    llm,
    tts,
    transport.output(),
    assistant_aggregator,
])
```

**Say:**

> “This is the existing Pipecat loop. Pipecat owns the orchestration: audio
> input, speech recognition, context, model response, speech synthesis, and
> audio output. Telnyx provides the phone transport and speech/model services
> around that loop.”

Show the prepared Edge deployment or briefly show:

```bash
telnyx-edge ship
```

**Say:**

> “The framework project is deployed to Telnyx Edge. I did not replace the
> Pipecat orchestration with a Telnyx-specific agent framework.”

Call the Telnyx number and say:

> “Hi, where is my order ORD-10042?”

If the agent answers with the status, ask:

> “Thanks. What was the order number again?”

Then say:

> “The second question is answered from the conversation context. I’m keeping
> this interaction small so the framework behavior stays visible.”

**Transition:**

> “Now I’ll keep the scenario, but connect a different existing framework to
> the Agent SDK boundary.”

## 3:00–5:00 — LangGraph through ACP

**Show:** `langgraph-acp/src/index.ts`.

Highlight:

```ts
await this.messages.add("user", text);
await this.queue("process");
```

**Say:**

> “`receive()` records the message and queues work. ACP provides the persistent
> actor boundary; the framework loop runs later in `process()`.”

Show `src/graph.ts` and highlight `createReactAgent`. Then show
`src/tools.ts` and `lookup_order`.

**Say:**

> “LangGraph still owns the reasoning loop. `lookup_order` is the replaceable
> application-tool boundary. In a real project, this could call a database,
> CRM, or order service.”

## 5:00–6:15 — Run the LangGraph actor

Show the Edge ACP web page and send:

```text
Where is order ORD-10042?
```

Then send:

```text
What was the order number again?
```

**Say:**

> “The first turn invokes the order tool. The follow-up does not need the order
> ID repeated because the actor has durable conversation history.”

For a terminal-based fallback:

```bash
telnyx-acp invoke bring-your-framework-langgraph \
  --conversation demo-recording \
  "Where is order ORD-10042?"
```

## 6:15–7:15 — Native ACP trace

Show the recent runs:

```bash
telnyx-acp traces demo-recording --limit 5
```

Then show the latest run:

```bash
telnyx-acp traces demo-recording <run-id>
```

Point to:

```text
model  langgraph model
tool   lookup_order ok
```

**Say:**

> “This is the native ACP trace for the persistent actor. It shows the model
> step and the LangGraph tool step that produced the response.”

Then be precise:

> “The trace view shows execution steps and timing. It intentionally does not
> display message text, tool arguments, or tool results. The response is shown
> in the Edge web page.”

## 7:15–8:00 — Close

Show:

| | Pipecat | LangGraph |
|---|---|---|
| Framework | Python/Pipecat | TypeScript/LangGraph |
| Channel | Phone | Web/SMS |
| Runtime | Telnyx Edge | ACP actor on Telnyx Edge |
| Deployment | `telnyx-edge ship` | `telnyx-acp deploy` |
| Tool | Order lookup | Order lookup |

**Say:**

> “These are two independent framework cuts. Pipecat remains Pipecat, and
> LangGraph remains LangGraph. Telnyx provides the runtime, communications,
> model access, persistence, deployment, and operational traces around the
> loops you already own.”

## Claims to avoid

- Do not claim Pipecat and LangGraph are one combined agent.
- Do not claim the two framework cuts automatically share conversation state.
- Do not claim native traces display full message text or tool arguments.
- Do not claim Python support for the ACP managed harness.
- Do not present the deterministic order fixture as a production database.

## Fallbacks

- Pre-ship the Pipecat function and show the live call if Edge build time is
  unpredictable.
- Use the LangGraph recording as a screencast if the beta ACP CLI changes.
- If the web page is unavailable, use `telnyx-acp invoke` and then
  `telnyx-acp traces` in the terminal.
