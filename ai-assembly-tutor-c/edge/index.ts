// index.ts — Telnyx Edge Compute HTTP handler for the AI Assembly Tutor
//
// Routes:
//   POST /api/explain   — Ask the AI tutor about LC-3 assembly
//   GET  /health        — Health check

import * as http from 'node:http';
import * as https from 'node:https';

const TELNYX_HOST = 'api.telnyx.com';
const INFERENCE_PATH = '/v2/ai/chat/completions';
const INFERENCE_MODEL = 'zai-org/GLM-5.3-Flash';

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
    parts.push('Current VM state:');
    if (s.registers) {
      const regs = Object.entries(s.registers)
        .map(
          ([k, v]) =>
            `${k}=${typeof v === 'number' ? 'x' + v.toString(16).toUpperCase().padStart(4, '0') : v}`,
        )
        .join(', ');
      parts.push(`  Registers: ${regs}`);
    }
    if (s.pc) parts.push(`  PC: ${s.pc}`);
    if (s.flags) {
      const active = Object.entries(s.flags)
        .filter(([, v]) => v)
        .map(([k]) => k);
      parts.push(`  Flags: ${active.join('') || 'none'}`);
    }
    if (s.currentInstruction)
      parts.push(`  Next instruction: ${s.currentInstruction} (${s.currentWord})`);
    if (s.lastOpcode) parts.push(`  Last executed opcode: ${s.lastOpcode}`);
    if (s.halted) parts.push('  VM is HALTED.');
    if (s.code) parts.push(`\nSource code:\n${s.code}`);
  }

  parts.push(`\nQuestion: ${req.question}`);
  return parts.join('\n');
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function httpsPost(
  host: string,
  path: string,
  headers: Record<string, string>,
  payload: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const opts: https.RequestOptions = {
      hostname: host,
      port: 443,
      path,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(payload).toString() },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 500, body: data }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function sendJson(res: http.ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
  if (req.url === '/health' || req.url?.startsWith('/health/')) {
    res.writeHead(200);
    res.end();
    return;
  }

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // POST /api/explain
  if (req.url === '/api/explain' && req.method === 'POST') {
    let body: ExplainRequest;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, { error: 'Invalid JSON' }, 400);
      return;
    }

    if (!body.question) {
      sendJson(res, { error: 'question is required' }, 400);
      return;
    }

    const apiKey = process.env.TELNYX_API_KEY;
    if (!apiKey) {
      sendJson(res, { error: 'TELNYX_API_KEY not configured' }, 500);
      return;
    }

    try {
      const payload = JSON.stringify({
        model: INFERENCE_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(body) },
        ],
        max_tokens: 1024,
        temperature: 0.3,
      });

      const resp = await httpsPost(
        TELNYX_HOST,
        INFERENCE_PATH,
        { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        payload,
      );

      if (resp.status !== 200) {
        sendJson(res, { error: resp.body.slice(0, 500) }, resp.status);
        return;
      }

      const data = JSON.parse(resp.body);
      const content = data?.choices?.[0]?.message?.content ?? '(no response)';
      sendJson(res, { response: content, model: INFERENCE_MODEL });
    } catch {
      sendJson(res, { error: 'Inference request failed' }, 500);
    }
    return;
  }

  // 404
  sendJson(res, { error: 'Not found' }, 404);
});

const port = process.env.PORT || 8080;
server.listen(port, () => {
  console.log(`AI Assembly Tutor running on port ${port}`);
});
