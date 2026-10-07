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

When explaining, be concise and reference the student's actual code and VM state. Use hex values where appropriate.`;

interface ExplainRequest {
  question: string;
  vm_state?: Record<string, unknown>;
}

function buildUserMessage(req: ExplainRequest): string {
  const parts: string[] = [];
  if (req.vm_state) {
    const s = req.vm_state;
    parts.push('Current VM state:');
    if (s.registers) {
      const regs = Object.entries(s.registers as Record<string, number>)
        .map(([k, v]) => `${k}=x${v.toString(16).toUpperCase().padStart(4, '0')}`)
        .join(', ');
      parts.push(`  Registers: ${regs}`);
    }
    if (s.pc) parts.push(`  PC: ${s.pc}`);
    if (s.flags) {
      const active = Object.entries(s.flags as Record<string, boolean>)
        .filter(([, v]) => v)
        .map(([k]) => k);
      parts.push(`  Flags: ${active.join('') || 'none'}`);
    }
    if (s.currentInstruction) parts.push(`  Next instruction: ${s.currentInstruction}`);
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

  // Landing page
  if ((req.url === '/' || req.url === '') && req.method === 'GET') {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LC-3 AI Assembly Tutor API</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
         background: #0a0e17; color: #c9d1d9; min-height: 100vh;
         display: flex; align-items: center; justify-content: center; }
  .container { max-width: 640px; padding: 2rem; }
  h1 { color: #58a6ff; font-size: 1.6rem; margin-bottom: 0.5rem; }
  .subtitle { color: #8b949e; margin-bottom: 2rem; }
  .badge { display: inline-block; background: #1a3a2a; color: #3fb950;
           padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.8rem;
           margin-bottom: 1.5rem; }
  h2 { color: #c9d1d9; font-size: 1.1rem; margin: 1.5rem 0 0.5rem; }
  pre { background: #161b22; border: 1px solid #30363d; border-radius: 6px;
        padding: 1rem; overflow-x: auto; font-size: 0.85rem; line-height: 1.5; }
  code { color: #e6edf3; }
  .key { color: #7ee787; } .str { color: #a5d6ff; } .com { color: #8b949e; }
  p { color: #8b949e; line-height: 1.6; margin: 0.5rem 0; }
  a { color: #58a6ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #21262d;
            font-size: 0.85rem; color: #484f58; }
</style>
</head>
<body>
<div class="container">
  <h1>LC-3 AI Assembly Tutor</h1>
  <p class="subtitle">AI-powered LC-3 assembly language tutor, running on Telnyx Edge Compute + Inference.</p>
  <span class="badge">deploy_ok</span>

  <h2>POST /api/explain</h2>
  <p>Ask questions about LC-3 assembly with optional VM state context.</p>
  <pre><code>curl -X POST ${escapeHtml(req.headers.host ? 'https://' + req.headers.host : '')}/api/explain \\
  -H <span class="str">"Content-Type: application/json"</span> \\
  -d <span class="str">'{
    "question": "What does ADD R2, R0, #5 do?",
    "vm_state": {
      "registers": {"R0": 10, "R2": 0},
      "flags": {"N": false, "Z": true, "P": false}
    }
  }'</span></code></pre>

  <h2>GET /health</h2>
  <p>Health check endpoint. Returns 200 when the service is running.</p>

  <div class="footer">
    Powered by <a href="https://telnyx.com">Telnyx</a> Edge Compute &amp; Inference &bull;
    Model: ${INFERENCE_MODEL}
  </div>
</div>
</body>
</html>`;
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html),
    });
    res.end(html);
    return;
  }

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

  sendJson(res, { error: 'Not found' }, 404);
});

const port = process.env.PORT || 8080;
server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
