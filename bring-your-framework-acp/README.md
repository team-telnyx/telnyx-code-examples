# Bring Your Framework ACP

Two small agents, two existing framework loops, one Telnyx platform story.

This is a standalone demo project for the message:

> You already have a loop. Keep it.

It demonstrates the same order-status interaction in two cuts:

1. A Pipecat voice agent deployed to Telnyx Edge.
2. A LangGraph ReAct agent implemented as a TypeScript `Agent` subclass and deployed with `telnyx-acp`.

The existing examples in this repository are references only. This project does not modify them.

## Why use this example?

This is for a team that already has a working agent loop and wants to put it on
Telnyx without rewriting the framework. The business logic is intentionally
small so the important parts are visible: framework glue, deployment, channel
attachment, durable conversation state, and native ACP traces.

It is also suitable for trying from a coding agent such as Codex or Cline:
ask the agent to read this README and the official Telnyx documentation, run
the checks, explain the `Agent` boundary, and replace `lookup_order` with a
real application tool. Never paste API keys into the coding agent or commit a
local `.env` file.

## Prerequisites

- Node.js 22.13 or later for the ACP cut.
- `telnyx-edge` 0.5.7 or later on `PATH`.
- A Telnyx account with a voice/messaging-capable number for the live demo.
- A local clone of the Pipecat Edge sample in `pipecat-edge/`.
- `@telnyx/acp`, installed globally for the ACP cut.

The Agent Control Plane and Agent SDK are beta. The ACP CLI is a pre-release, so keep the recorded fallback described in [DEMO_SCRIPT.md](./DEMO_SCRIPT.md).

## LangGraph ACP cut

The LangGraph project is in [`langgraph-acp/`](./langgraph-acp/). It uses the documented framework glue shape:

```text
receive() → durable message log → queue("process")
process() → LangGraph ReAct loop → assistant message
```

The graph has one visible tool, `lookup_order`, with deterministic data for
`ORD-10042`. The ACP actor can also resolve a configured demo sender number to
a demo customer profile; unknown senders are asked for an order ID.

```bash
cd langgraph-acp
npm install
npm run typecheck
npm test
```

For an ACP-managed deployment, install and sign in to the CLI, then configure
your own messaging profile and secrets for this directory:

```bash
npm install -g @telnyx/acp
telnyx-acp login
telnyx-acp models
telnyx-acp dev
telnyx-acp deploy --dry-run
telnyx-acp deploy
telnyx-acp add web
telnyx-acp add channel messaging_profile:<your-profile-id>
telnyx-acp add secret DEMO_CUSTOMER_PHONE
telnyx-acp add secret DEMO_CUSTOMER_NAME
telnyx-acp logs --tail
```

The checked-in `agent.json` deliberately contains no account-specific channel,
function, number, or revision IDs. `telnyx-acp add channel` attaches the
messaging profile you own; the Pipecat voice connection can remain attached to
the TeXML application separately.

For local development, create a local env file from the example and set the key used by the LangChain OpenAI-compatible client:

```bash
cp .env.example .env
# edit .env and set TELNYX_API_KEY
telnyx-acp dev
telnyx-acp invoke bring-your-framework-langgraph --conversation demo --local "where is my order ORD-10042?"
```

The framework client uses `TELNYX_API_KEY` for its own OpenAI-compatible model request. Do not commit that value. The exact generated ACP package/configuration should be kept in `.telnyx/`, which is ignored by this project. See the [ACP deployment guide](https://developers.telnyx.com/docs/agents/get-started) and [Bring Your Own Framework example](https://developers.telnyx.com/docs/agent-sdk/examples/bring-your-own-framework) for the current beta contract.

## Pipecat cut

The official Pipecat source is now checked into [`pipecat-edge/`](./pipecat-edge/). Its unchanged bot entrypoint is `pipecat-edge/function/bot.py`.

The official Pipecat source remains unchanged in this project. For the recorded
order-status cut, create a deployment copy and change only the business prompt
and greeting; keep the Pipecat transport and pipeline intact. The local working
copy used for this recording lives outside the public example directory so the
upstream reference stays pristine.

The documented deployment shape is:

```bash
telnyx-edge new-func -l python --from-dir pipecat-edge
telnyx-edge secrets add <NAME> <VALUE>
telnyx-edge ship
```

Then attach the deployed function to the TeXML application and Telnyx number. The Pipecat-specific setup is intentionally documented in [`pipecat-edge/README.md`](./pipecat-edge/README.md) rather than copied into this repository without the source clone.

## Demo

Use [DEMO_SCRIPT.md](./DEMO_SCRIPT.md) for the eight-minute recording. Run the non-destructive checks first:

```bash
./scripts/check-prereqs.sh
./scripts/verify-demo.sh
```

## Browser view: Edge first, local helper optional

When the web-enabled ACP revision is active, use the Edge-hosted browser page:

```text
https://<your-acp-mount-url>/web
```

This page and the persistent `Conversation` actor are part of the ACP
deployment. The base function URL is an Edge mount, not a page, so `/` can
correctly return `404`. The actor API route is:

```text
https://<your-acp-mount-url>/agents/bring-your-framework-langgraph/<conversation>
```

The local UI below is only a fallback recording helper while the Edge web
revision is deploying or when a custom combined view is useful.

## Local UI

The project includes an optional recording helper at [`ui/index.html`](./ui/index.html). It is not the agent and it is not required in production: it calls the deployed persistent ACP actor through a local Node proxy, then reads the native trace and recent framework logs so the browser can show the conversation and execution trail in one screen. The primary demo path is the Edge-hosted `/web` page plus `telnyx-acp traces`; `telnyx-acp invoke` is the reliable CLI fallback:

```bash
node ui/server.mjs
# open http://127.0.0.1:4173
```

The deployed LangGraph agent is the persistent actor. The local UI is only a
client used to make that actor easier to record; it does not run LangGraph,
hold the conversation state, or replace ACP.

Set `ACP_AGENT_URL` before starting the server if the deployed function URL changes.

The trace acceptance gate is explicit: run `telnyx-acp traces <conversation>
<run>` after an invocation and show the native ACP run, model, and tool steps.
Native traces intentionally omit message text, tool arguments, tool results, and
the final assistant text; show the reply in the Edge web page or CLI response.

The live recording setup uses one Telnyx number with two channel attachments:
Pipecat owns the TeXML voice connection and ACP owns SMS through the existing
messaging profile. They are two framework cuts, not two copies of the agent.

The custom code agent now exposes the ACP trace methods, and the active Edge
revision returns the run, model, and `lookup_order` tool steps. An older
revision can report “deployed by a CLI from before traces,” so verify the active
revision before recording.
