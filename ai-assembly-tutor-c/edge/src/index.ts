/**
 * Telnyx Edge Compute function — AI Assembly Tutor backend.
 * POST /api/explain  →  streams an LC-3 explanation via Telnyx Inference.
 */

import OpenAI from "openai";

const SYSTEM_PROMPT = `You are an expert LC-3 assembly language tutor. You help students understand the LC-3 instruction set architecture by explaining what each instruction does, how registers and memory change, and why condition flags are set.

LC-3 Architecture Summary:
- 8 general-purpose registers: R0-R7 (16-bit)
- Program Counter (PC): points to the next instruction
- Condition flags: N (negative), Z (zero), P (positive) — set after every register write
- Memory: 16-bit address space (0x0000-0xFFFF), programs start at 0x3000
- 16 opcodes: BR (branch), ADD, LD, ST, JSR, AND, LDR, STR, RTI, NOT, LDI, STI, JMP, RES, LEA, TRAP
- ADD/AND have two modes: register (ADD R0, R1, R2) and immediate (ADD R0, R1, #5)
- Branch (BR) checks condition flags: BRn, BRz, BRp, BRnz, BRnzp, etc.
- TRAP routines: GETC (x20), OUT (x21), PUTS (x22), IN (x23), PUTSP (x24), HALT (x25)
- LEA loads an address (not memory contents) into a register
- LD/ST use PC-relative addressing; LDR/STR use base+offset; LDI/STI use indirect addressing

When explaining, be concise and reference the student's actual code and VM state. Use hex values where appropriate. If the student asks "what happens next?", describe the effect the instruction at PC will have.`;

const client = new OpenAI({
  apiKey: process.env.TELNYX_API_KEY,
  baseURL: "https://api.telnyx.com/v2/ai/openai",
});

interface VMState {
  registers?: Record<string, number>;
  pc?: string;
  flags?: { N: boolean; Z: boolean; P: boolean };
  halted?: boolean;
  currentInstruction?: string;
  currentWord?: string;
  lastOpcode?: string | null;
  code?: string;
}

interface ExplainRequest {
  question: string;
  vm_state?: VMState;
}

function buildUserMessage(req: ExplainRequest): string {
  const parts: string[] = [];

  if (req.vm_state) {
    const s = req.vm_state;
    parts.push("Current VM state:");
    if (s.registers) {
      const regs = Object.entries(s.registers)
        .map(([k, v]) => `${k}=${typeof v === "number" ? "x" + v.toString(16).toUpperCase().padStart(4, "0") : v}`)
        .join(", ");
      parts.push(`  Registers: ${regs}`);
    }
    if (s.pc) parts.push(`  PC: ${s.pc}`);
    if (s.flags) {
      const active = Object.entries(s.flags).filter(([, v]) => v).map(([k]) => k);
      parts.push(`  Flags: ${active.join("") || "none"}`);
    }
    if (s.currentInstruction) parts.push(`  Next instruction: ${s.currentInstruction} (${s.currentWord})`);
    if (s.lastOpcode) parts.push(`  Last executed opcode: ${s.lastOpcode}`);
    if (s.halted) parts.push("  VM is HALTED.");
    if (s.code) parts.push(`\nSource code:\n${s.code}`);
  }

  parts.push(`\nQuestion: ${req.question}`);
  return parts.join("\n");
}

export default async function handler(request: Request): Promise<Response> {
  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  const url = new URL(request.url);

  if (url.pathname === "/api/explain" && request.method === "POST") {
    const body: ExplainRequest = await request.json();

    if (!body.question) {
      return new Response(JSON.stringify({ error: "question is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const stream = await client.chat.completions.create({
      model: "zai-org/GLM-5.3-Flash",
      stream: true,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(body) },
      ],
      max_tokens: 1024,
      temperature: 0.3,
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          const data = JSON.stringify(chunk);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
