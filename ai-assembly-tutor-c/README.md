---
name: ai-assembly-tutor
title: "AI Assembly Tutor"
description: "Interactive LC-3 assembly tutor with a WebAssembly VM and Telnyx Inference-powered AI explanations."
language: c
framework: emscripten
telnyx_products: [AI Inference, Edge Compute]
---

# LC-3 AI Assembly Tutor — learn assembly with an AI-powered debugger in the browser.

Interactive browser-based LC-3 virtual machine (C compiled to WebAssembly) with a Telnyx Inference AI tutor that explains each instruction as you step through code.

## Telnyx API Endpoints Used

- **AI Inference**: `POST /v2/ai/chat/completions` - [API reference](https://developers.telnyx.com/api/inference/chat-completions)
- **Edge Compute**: Serverless function hosting - [Edge Compute docs](https://developers.telnyx.com/docs/edge)

## Architecture

```
Browser                          Telnyx Edge Compute
┌─────────────────────┐         ┌──────────────────┐
│  Editor  │ VM State │   HTTP  │  /api/explain     │
│  (asm)   │ (regs,   │ ──────► │                    │
│          │  mem, PC) │         │  Calls Telnyx     │
│──────────┤          │ ◄────── │  Inference API     │
│  AI Chat │          │   JSON  │  (chat/completions)│
└─────────────────────┘         └──────────────────┘
     │
     │ WASM
     ▼
┌─────────────┐
│ LC-3 VM     │
│ (C → WASM)  │
└─────────────┘
```

The VM runs entirely client-side via WebAssembly. Only the AI tutor explanation calls go to the Telnyx Edge backend, which forwards them to Telnyx Inference.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-assembly-tutor-c
cp .env.example .env    # ← fill in your TELNYX_API_KEY
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>

### 1. Build the WASM VM

Install [Emscripten](https://emscripten.org/docs/getting_started/) and activate it, then:

```bash
bash build.sh
```

This compiles `app.c` to `web/wasm/lc3.js` + `lc3.wasm`.

### 2. Deploy the Edge backend

```bash
cd edge
npm install
telnyx-edge ship
```

Set the returned Edge URL as the `data-edge-url` attribute on the `<html>` element in `web/index.html`, or serve the frontend from the same origin.

### 3. Serve the frontend

```bash
cd web
python3 -m http.server 8080    # or any static file server
```

Open `http://localhost:8080` — load an example program, assemble, step through, and ask the AI tutor questions.

## API Reference

### `POST /api/explain`

Send a question about the current VM state to the AI tutor. Returns a streaming SSE response.

```bash
curl -X POST https://<edge-url>/api/explain \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What does the PUTS instruction do?",
    "vm_state": {
      "registers": {"R0": 12289, "R1": 0},
      "pc": "x3002",
      "flags": {"N": false, "Z": false, "P": true},
      "currentInstruction": "TRAP PUTS",
      "code": ".ORIG x3000\n  LEA R0, HELLO\n  PUTS\n  HALT\nHELLO .STRINGZ \"Hello!\"\n.END"
    }
  }'
```

**Response:** Server-Sent Events stream with `data:` lines containing chat completion deltas.

See [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-assembly-tutor-c/API.md) for the full typed reference.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` from Edge | Invalid or missing API key | Verify `TELNYX_API_KEY` in `.env` matches your key in the [Portal](https://portal.telnyx.com/api-keys) |
| WASM fails to load | `lc3.js`/`lc3.wasm` not found | Run `bash build.sh` to compile the VM |
| Assembler errors | Syntax mistakes in LC-3 source | Check error messages — they include line numbers |
| AI tutor not responding | Edge function not deployed or wrong URL | Deploy with `telnyx-edge ship` and update the frontend URL |
| `emcc` not found | Emscripten not installed/activated | Follow [Emscripten setup](https://emscripten.org/docs/getting_started/) |

## Related Examples

- [Run LLM Inference (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/run-llm-inference-python/README.md)
- [Run LLM Inference (Node.js)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/run-llm-inference-nodejs/README.md)

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [AI Inference Models](https://developers.telnyx.com/docs/inference/models)
- [Edge Compute Guide](https://developers.telnyx.com/docs/edge)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
- [LC-3 VM Tutorial (jmeiners.com)](https://www.jmeiners.com/lc3-vm/)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network. This example uses Telnyx Inference for real-time AI tutoring and Edge Compute for low-latency serverless hosting.
