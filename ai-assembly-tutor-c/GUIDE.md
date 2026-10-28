# Build an AI-Powered LC-3 Assembly Tutor with Telnyx

Learn how to build an interactive LC-3 assembly language tutor that runs a virtual machine in the browser via WebAssembly, with Telnyx Inference providing real-time AI explanations.

## How It Works

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

## Telnyx Products Used

- **AI Inference** — LLM chat completions via OpenAI-compatible API
- **Edge Compute** — serverless function hosting for the AI backend

## API Endpoints

- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Prerequisites

- [Emscripten SDK](https://emscripten.org/docs/getting_started/) (for compiling C to WASM)
- Node.js 18+ (for Edge function dependencies)
- [Telnyx account](https://portal.telnyx.com/sign-up) with an API key
- [Telnyx Edge CLI](https://developers.telnyx.com/docs/edge) (`telnyx-edge`)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-assembly-tutor-c
cp .env.example .env
```

Edit `.env` and add your Telnyx API key from the [Telnyx Portal](https://portal.telnyx.com/api-keys).

## Step 2: Understand the LC-3 VM

The LC-3 (Little Computer 3) is a teaching architecture with:

- **8 registers** (R0-R7), a program counter (PC), and condition flags (N/Z/P)
- **16-bit memory** — programs load at address `0x3000`
- **16 opcodes** — ADD, AND, NOT, BR, LD, ST, LEA, LDR, STR, LDI, STI, JSR, JMP, TRAP, RTI, RES

The VM is implemented in `app.c` with these exported functions:

| Function | Purpose |
|----------|---------|
| `vm_init()` | Reset all registers and memory, set PC to 0x3000 |
| `vm_load_program(ptr, len)` | Load a binary program into memory |
| `vm_step()` | Execute one instruction, return the opcode |
| `vm_get_register(r)` | Read a register (0-9) |
| `vm_get_memory(addr)` | Read a memory location |
| `vm_is_halted()` | Check if HALT trap was executed |
| `vm_get_output()` | Get buffered character output |
| `vm_clear_output()` | Clear the output buffer |
| `vm_queue_input(c)` | Feed a character for GETC/IN traps |

## Step 3: Build the WASM Module

The build script uses Emscripten to compile `app.c`:

```bash
bash build.sh
```

This produces `web/wasm/lc3.js` (Emscripten glue) and `web/wasm/lc3.wasm` (the compiled VM).

The key Emscripten flags:

- `MODULARIZE=1` + `EXPORT_NAME="LC3Module"` — creates a factory function
- `EXPORTED_FUNCTIONS` — lists the C functions accessible from JS
- `EXPORTED_RUNTIME_METHODS` — enables `cwrap` for type-safe JS bindings

## Step 4: Understand the Assembler

`web/js/assembler.js` implements a two-pass LC-3 assembler:

**Pass 1** — Scan for labels and build a symbol table mapping label names to memory addresses.

**Pass 2** — Encode each instruction to a 16-bit binary word, resolving label references using the symbol table.

Supported directives: `.ORIG`, `.END`, `.FILL`, `.BLKW`, `.STRINGZ`

The assembler returns a `Uint16Array` ready to load into the VM, plus any errors with line numbers.

## Step 5: Build the AI Tutor Backend

The Edge function in `edge/src/index.ts` handles `POST /api/explain`:

1. Receives the student's question + current VM state
2. Builds a context message with registers, PC, flags, and code
3. Calls Telnyx Inference (`zai-org/GLM-5.3-Flash`) with a system prompt that describes the LC-3 architecture
4. Streams the response back as Server-Sent Events

Deploy it:

```bash
cd edge
npm install
telnyx-edge ship
```

The system prompt gives the model deep LC-3 knowledge — opcodes, addressing modes, trap routines — so it can explain any instruction in context.

## Step 6: Wire Up the Frontend

The web frontend (`web/index.html`) has three panels:

| Panel | Purpose |
|-------|---------|
| **Left — Editor** | Textarea for LC-3 assembly + controls (Assemble, Step, Run, Reset) |
| **Center — VM State** | Registers, condition flags, memory viewer, output console |
| **Right — AI Tutor** | Chat interface with quick-ask buttons |

Key JS modules:

- `vm-wrapper.js` — wraps Emscripten `cwrap` calls into a clean API
- `assembler.js` — two-pass assembler with error reporting
- `ui.js` — renders registers, memory, flags; builds VM context for the tutor
- `tutor.js` — sends questions to the Edge backend and streams responses
- `app.js` — orchestrates everything: wires buttons, manages run/step/reset

## Step 7: Try It Out

1. Open `http://localhost:8080` in your browser
2. Select "Hello World" from the example dropdown
3. Click **Assemble** — the VM loads the program
4. Click **Step** repeatedly to execute one instruction at a time
5. Watch registers and memory update in the center panel
6. Click "What does this do?" to ask the AI tutor about the current instruction
7. Try **Run** to execute at full speed until HALT

## All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/explain` | AI tutor — explain LC-3 instructions and VM state |

## Next Steps

- Add more example programs to the `examples/` folder
- Extend the assembler with macro support
- Add breakpoint support to the VM stepper
- Connect the tutor to conversation history for multi-turn explanations
