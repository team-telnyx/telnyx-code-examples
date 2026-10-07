// index.ts — Telnyx Edge Compute: LC-3 AI Assembly Tutor (full-stack)
//
// Serves the complete 3-panel web app AND the AI tutor API from a single Edge function.
// All frontend assets (HTML, CSS, JS, WASM, examples) are embedded as constants.

import * as http from 'node:http';
import * as https from 'node:https';

// ═══════════════════════════════════════════════════════════════════════
// AI Tutor API
// ═══════════════════════════════════════════════════════════════════════

const TELNYX_HOST = 'api.telnyx.com';
const INFERENCE_PATH = '/v2/ai/openai/chat/completions';
const INFERENCE_MODEL = 'deepseek-ai/DeepSeek-V4.1-Flash';

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
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function httpsPost(
  host: string, path: string, headers: Record<string, string>, payload: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const opts: https.RequestOptions = {
      hostname: host, port: 443, path, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(payload).toString() },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 500, body: data }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Embedded static assets
// ═══════════════════════════════════════════════════════════════════════

const ASSETS: Record<string, { content: string | Buffer; type: string }> = {};

// ── index.html ──────────────────────────────────────────────────────

ASSETS['/'] = { type: 'text/html; charset=utf-8', content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>LC-3 AI Assembly Tutor \u2014 Telnyx</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>

<header>
  <h1>LC-3 AI Assembly Tutor</h1>
  <span id="status">Loading...</span>
</header>

<main>
  <!-- Left: Code Editor -->
  <section id="panel-editor" class="panel">
    <div class="panel-header">
      <h2>Code</h2>
      <select id="example-select">
        <option value="">— load example —</option>
        <option value="hello-world">Hello World</option>
        <option value="add-numbers">Add Numbers</option>
        <option value="countdown">Countdown</option>
        <option value="fibonacci">Fibonacci</option>
        <option value="calculator">Calculator</option>
      </select>
    </div>
    <textarea id="editor" spellcheck="false" placeholder="; Write LC-3 assembly here...
.ORIG x3000
  LEA R0, HELLO
  PUTS
  HALT
HELLO .STRINGZ &quot;Hello, world!&quot;
.END"></textarea>
    <pre id="errors"></pre>
    <div class="toolbar">
      <button id="btn-assemble">Assemble</button>
      <button id="btn-step">Step</button>
      <button id="btn-run">Run</button>
      <button id="btn-reset">Reset VM</button>
      <button id="btn-clear-code">Clear Code</button>
    </div>
  </section>

  <!-- Center: VM State -->
  <section id="panel-state" class="panel">
    <h2>VM State</h2>
    <div id="flags"></div>
    <div id="registers"></div>
    <h3>Memory</h3>
    <div id="memory"></div>
    <h3>Output</h3>
    <pre id="output"></pre>
  </section>

  <!-- Right: AI Tutor -->
  <section id="panel-tutor" class="panel">
    <div class="panel-header">
      <h2>AI Tutor</h2>
      <button id="btn-clear-chat">Clear Chat</button>
    </div>
    <div id="chat-messages"></div>
    <div class="quick-asks">
      <button class="quick-ask" data-question="What does this instruction do?">What does this do?</button>
      <button class="quick-ask" data-question="Why did the condition flags change?">Why did flags change?</button>
      <button class="quick-ask" data-question="What will happen on the next step?">What happens next?</button>
    </div>
    <div class="chat-input-row">
      <input id="chat-input" type="text" placeholder="Ask about this code..." />
      <button id="chat-send">Send</button>
    </div>
  </section>
</main>

<script src="wasm/lc3.js"></script>
<script type="module" src="js/app.js"></script>
</body>
</html>` };

// ── style.css ───────────────────────────────────────────────────────

ASSETS['/style.css'] = { type: 'text/css; charset=utf-8', content: `:root {
  --bg: #0f1117;
  --surface: #1a1d27;
  --border: #2a2d3a;
  --text: #e0e0e6;
  --muted: #888;
  --accent: #00c48f;
  --accent-dim: #00c48f33;
  --error: #ff5c5c;
  --changed: #ffd966;
  --pc-bg: #00c48f22;
  --font-mono: 'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: var(--font-mono); font-size: 13px;
  background: var(--bg); color: var(--text);
  height: 100vh; display: flex; flex-direction: column;
}
header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 16px; background: var(--surface); border-bottom: 1px solid var(--border);
}
header h1 { font-size: 15px; font-weight: 600; color: var(--accent); }
#status { color: var(--muted); font-size: 12px; }
main { flex: 1; display: flex; overflow: hidden; }
.panel {
  flex: 1; display: flex; flex-direction: column;
  border-right: 1px solid var(--border); overflow: hidden;
}
.panel:last-child { border-right: none; }
.panel h2 {
  padding: 8px 12px; font-size: 12px; text-transform: uppercase;
  letter-spacing: 1px; color: var(--muted); border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.panel h3 {
  padding: 6px 12px; font-size: 11px; text-transform: uppercase;
  letter-spacing: 1px; color: var(--muted); border-top: 1px solid var(--border); flex-shrink: 0;
}
.panel-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 12px; border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.panel-header h2 { padding: 0; border: none; }
#example-select {
  font-family: var(--font-mono); font-size: 11px;
  background: var(--bg); color: var(--text);
  border: 1px solid var(--border); padding: 4px 8px; border-radius: 4px;
}
#editor {
  flex: 1; resize: none; background: var(--bg); color: var(--text); border: none;
  padding: 12px; font-family: var(--font-mono); font-size: 13px;
  line-height: 1.5; tab-size: 2; outline: none;
}
#errors {
  display: none; background: #2a1515; color: var(--error);
  padding: 8px 12px; font-size: 12px; max-height: 80px; overflow-y: auto; flex-shrink: 0;
}
.toolbar {
  display: flex; gap: 6px; padding: 8px 12px;
  border-top: 1px solid var(--border); flex-shrink: 0;
}
button {
  font-family: var(--font-mono); font-size: 12px; padding: 6px 14px;
  border: 1px solid var(--border); background: var(--surface); color: var(--text);
  border-radius: 4px; cursor: pointer; transition: background 0.15s;
}
button:hover { background: var(--border); }
button:active { background: var(--accent-dim); }
#btn-assemble {
  background: var(--accent); color: var(--bg);
  border-color: var(--accent); font-weight: 600;
}
#btn-assemble:hover { opacity: 0.9; }
#flags { padding: 8px 12px; display: flex; gap: 8px; flex-shrink: 0; }
.flag {
  display: inline-block; width: 28px; text-align: center; padding: 4px 0;
  border-radius: 4px; font-weight: 600; background: var(--bg);
  color: var(--muted); border: 1px solid var(--border);
}
.flag.active { background: var(--accent-dim); color: var(--accent); border-color: var(--accent); }
#registers { padding: 0 12px; flex-shrink: 0; }
#registers table { width: 100%; border-collapse: collapse; }
#registers th, #registers td {
  padding: 3px 6px; text-align: left; font-size: 12px; border-bottom: 1px solid var(--border);
}
#registers th { color: var(--muted); font-weight: normal; }
#registers tr.changed td { color: var(--changed); }
#memory { flex: 1; overflow-y: auto; padding: 0 12px; }
#memory table { width: 100%; border-collapse: collapse; }
#memory th, #memory td {
  padding: 2px 6px; font-size: 11px; border-bottom: 1px solid var(--border); white-space: nowrap;
}
#memory th { color: var(--muted); font-weight: normal; text-align: left; }
#memory tr.current-pc { background: var(--pc-bg); }
#output {
  height: 80px; overflow-y: auto; padding: 8px 12px;
  background: var(--bg); font-size: 12px; flex-shrink: 0;
}
#chat-messages { flex: 1; overflow-y: auto; padding: 12px; }
.message { margin-bottom: 12px; }
.message-label {
  display: block; font-size: 10px; text-transform: uppercase;
  letter-spacing: 1px; color: var(--muted); margin-bottom: 4px;
}
.message-content {
  background: var(--bg); padding: 8px 12px; border-radius: 6px;
  font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word;
}
.message.user .message-content { background: var(--accent-dim); border: 1px solid var(--accent); }
.quick-asks { display: flex; gap: 4px; padding: 4px 12px; flex-wrap: wrap; flex-shrink: 0; }
.quick-ask { font-size: 10px; padding: 4px 8px; border-radius: 12px; }
.chat-input-row {
  display: flex; gap: 6px; padding: 8px 12px;
  border-top: 1px solid var(--border); flex-shrink: 0;
}
#chat-input {
  flex: 1; font-family: var(--font-mono); font-size: 12px; padding: 6px 10px;
  background: var(--bg); color: var(--text); border: 1px solid var(--border);
  border-radius: 4px; outline: none;
}
#chat-input:focus { border-color: var(--accent); }
#chat-send { background: var(--accent); color: var(--bg); border-color: var(--accent); font-weight: 600; }
#btn-clear-chat {
  font-family: var(--font-mono); font-size: 11px;
  background: var(--bg); color: var(--muted);
  border: 1px solid var(--border); padding: 4px 10px; border-radius: 4px; cursor: pointer;
}
#btn-clear-chat:hover { color: var(--text); border-color: var(--text); }
#btn-clear-code {
  background: transparent; color: var(--muted); border-color: var(--border);
}
#btn-clear-code:hover { color: var(--text); border-color: var(--text); }
` };

// ── JS modules ──────────────────────────────────────────────────────

ASSETS['/js/tutor.js'] = { type: 'application/javascript; charset=utf-8', content: `let edgeUrl = '';
export function setEdgeUrl(url) { edgeUrl = url.replace(/\\/+$/, ''); }
export async function ask(question, vmContext, onChunk, onDone) {
  const body = { question, vm_state: vmContext };
  try {
    const res = await fetch(edgeUrl + '/api/explain', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) { const text = await res.text(); onChunk('Error: ' + res.status + ' — ' + text); onDone(); return; }
    const data = await res.json();
    if (data.response) onChunk(data.response);
    else if (data.error) onChunk('Error: ' + data.error);
    else onChunk('(No response — try rephrasing your question)');
  } catch (err) { onChunk('\\nNetwork error: ' + err.message); }
  onDone();
}
export function addMessage(role, text) {
  const chat = document.getElementById('chat-messages');
  const bubble = document.createElement('div');
  bubble.className = 'message ' + role;
  const label = document.createElement('span');
  label.className = 'message-label';
  label.textContent = role === 'user' ? 'You' : 'AI Tutor';
  const content = document.createElement('div');
  content.className = 'message-content';
  content.textContent = text;
  bubble.appendChild(label); bubble.appendChild(content);
  chat.appendChild(bubble); chat.scrollTop = chat.scrollHeight;
  return content;
}` };

ASSETS['/js/vm-wrapper.js'] = { type: 'application/javascript; charset=utf-8', content: `let Module = null;
let vmInit, vmLoadProgram, vmStep, vmGetRegister, vmGetMemory;
let vmIsHalted, vmGetOutput, vmClearOutput, vmQueueInput;
export async function loadVM() {
  Module = await LC3Module();
  vmInit = Module.cwrap('vm_init', null, []);
  vmLoadProgram = Module.cwrap('vm_load_program', null, ['number', 'number']);
  vmStep = Module.cwrap('vm_step', 'number', []);
  vmGetRegister = Module.cwrap('vm_get_register', 'number', ['number']);
  vmGetMemory = Module.cwrap('vm_get_memory', 'number', ['number']);
  vmIsHalted = Module.cwrap('vm_is_halted', 'number', []);
  vmGetOutput = Module.cwrap('vm_get_output', 'string', []);
  vmClearOutput = Module.cwrap('vm_clear_output', null, []);
  vmQueueInput = Module.cwrap('vm_queue_input', null, ['number']);
}
export function init() { vmInit(); }
export function loadProgram(uint16Arr) {
  const buf = new Uint8Array(uint16Arr.length * 2);
  for (let i = 0; i < uint16Arr.length; i++) { buf[i*2] = uint16Arr[i] & 0xFF; buf[i*2+1] = (uint16Arr[i] >> 8) & 0xFF; }
  Module.ccall('vm_load_program', null, ['array', 'number'], [buf, uint16Arr.length]);
}
export function step() { return vmStep(); }
export function getRegister(r) { return vmGetRegister(r); }
export function getMemory(addr) { return vmGetMemory(addr); }
export function isHalted() { return !!vmIsHalted(); }
export function flushOutput() { const s = vmGetOutput(); vmClearOutput(); return s; }
export function queueInput(ch) { vmQueueInput(ch.charCodeAt(0)); }
export const OP_NAMES = ['BR','ADD','LD','ST','JSR','AND','LDR','STR','RTI','NOT','LDI','STI','JMP','RES','LEA','TRAP'];` };

ASSETS['/js/assembler.js'] = { type: 'application/javascript; charset=utf-8', content: `const OPCODES={BR:0,BRn:0,BRz:0,BRp:0,BRnz:0,BRnp:0,BRzp:0,BRnzp:0,ADD:1,LD:2,ST:3,JSR:4,JSRR:4,AND:5,LDR:6,STR:7,RTI:8,NOT:9,LDI:10,STI:11,JMP:12,RET:12,LEA:14,TRAP:15};
const TRAP_VECTORS={GETC:0x20,OUT:0x21,PUTS:0x22,IN:0x23,PUTSP:0x24,HALT:0x25};
const OP_JMP=12;
function parseRegister(tok){const m=tok.match(/^[Rr]([0-7])$/);return m?parseInt(m[1],10):-1;}
function parseImmediate(tok){tok=tok.replace(/^#/,'');if(tok.startsWith('x')||tok.startsWith('X'))return parseInt(tok.slice(1),16);if(tok.startsWith('0x')||tok.startsWith('0X'))return parseInt(tok,16);return parseInt(tok,10);}
function toSigned16(val){if(val>0x7FFF)val-=0x10000;return val;}
function fitBits(val,bits){return val&((1<<bits)-1);}
function tokenize(line){const noComment=line.replace(/;.*$/,'').trim();if(!noComment)return[];const tokens=[];let current='';let inQuote=false;for(let i=0;i<noComment.length;i++){const ch=noComment[i];if(ch==='"'){inQuote=!inQuote;current+=ch;}else if(!inQuote&&(ch===','||ch===' '||ch==='\\t')){if(current){tokens.push(current);current='';}}else{current+=ch;}}if(current)tokens.push(current);return tokens;}
function resolveLabel(tok,symbols,pc,lineNum,errors){if(!tok){errors.push({line:lineNum,message:'Missing operand'});return 0;}const upper=tok.toUpperCase();if(upper in symbols)return symbols[upper]-pc;const val=parseImmediate(tok);if(isNaN(val)){errors.push({line:lineNum,message:'Undefined label: '+tok});return 0;}return val;}
export function assemble(source){const lines=source.split('\\n');const errors=[];const symbols={};let origin=0x3000;let started=false;let addr=origin;
for(let i=0;i<lines.length;i++){const tokens=tokenize(lines[i]);if(tokens.length===0)continue;const first=tokens[0].toUpperCase();if(first==='.ORIG'){origin=parseImmediate(tokens[1]);addr=origin;started=true;continue;}if(!started)continue;if(first==='.END')break;if(!(first in OPCODES)&&!first.startsWith('.')&&!(first in TRAP_VECTORS)&&first!=='RET'){symbols[tokens[0].toUpperCase()]=addr;tokens.shift();if(tokens.length===0)continue;}const op=tokens[0].toUpperCase();if(op==='.FILL'){addr++;continue;}if(op==='.BLKW'){addr+=parseImmediate(tokens[1]);continue;}if(op==='.STRINGZ'){const str=lines[i].match(/"([^"]*)"/);addr+=(str?str[1].length:0)+1;continue;}addr++;}
if(!started){errors.push({line:1,message:'Missing .ORIG directive'});return{program:new Uint16Array(0),errors};}
const output=[];addr=origin;started=false;
for(let i=0;i<lines.length;i++){const lineNum=i+1;let tokens=tokenize(lines[i]);if(tokens.length===0)continue;const first=tokens[0].toUpperCase();if(first==='.ORIG'){started=true;continue;}if(!started)continue;if(first==='.END')break;if(!(first in OPCODES)&&!first.startsWith('.')&&!(first in TRAP_VECTORS)&&first!=='RET'){tokens.shift();if(tokens.length===0)continue;}const op=tokens[0].toUpperCase();
try{if(op==='.FILL'){let val=parseImmediate(tokens[1]);if(isNaN(val)&&tokens[1].toUpperCase()in symbols)val=symbols[tokens[1].toUpperCase()];output.push(val&0xFFFF);addr++;continue;}
if(op==='.BLKW'){const count=parseImmediate(tokens[1]);for(let j=0;j<count;j++)output.push(0);addr+=count;continue;}
if(op==='.STRINGZ'){const str=lines[i].match(/"([^"]*)"/);const s=str?str[1]:'';for(let j=0;j<s.length;j++)output.push(s.charCodeAt(j));output.push(0);addr+=s.length+1;continue;}
let instr=0;
if(op in TRAP_VECTORS){instr=(0xF<<12)|TRAP_VECTORS[op];output.push(instr);addr++;continue;}
if(op==='RET'){instr=(OP_JMP<<12)|(7<<6);output.push(instr);addr++;continue;}
const opcode=OPCODES[op];if(opcode===undefined){errors.push({line:lineNum,message:'Unknown opcode: '+op});output.push(0);addr++;continue;}
instr=opcode<<12;
switch(opcode){case 1:case 5:{const dr=parseRegister(tokens[1]);const sr1=parseRegister(tokens[2]);instr|=(dr<<9)|(sr1<<6);const sr2=parseRegister(tokens[3]);if(sr2>=0)instr|=sr2;else{const imm=parseImmediate(tokens[3]);instr|=(1<<5)|fitBits(imm,5);}break;}
case 9:{const dr=parseRegister(tokens[1]);const sr=parseRegister(tokens[2]);instr|=(dr<<9)|(sr<<6)|0x3F;break;}
case 0:{let nzp=0;const variant=op.slice(2).toLowerCase();if(variant===''||variant==='nzp')nzp=7;else{if(variant.includes('n'))nzp|=4;if(variant.includes('z'))nzp|=2;if(variant.includes('p'))nzp|=1;}instr|=(nzp<<9);const target=resolveLabel(tokens[1],symbols,addr+1,lineNum,errors);instr|=fitBits(target,9);break;}
case 2:case 10:case 14:case 3:case 11:{const r=parseRegister(tokens[1]);instr|=(r<<9);const offset=resolveLabel(tokens[2],symbols,addr+1,lineNum,errors);instr|=fitBits(offset,9);break;}
case 6:case 7:{const r=parseRegister(tokens[1]);const base=parseRegister(tokens[2]);const off=parseImmediate(tokens[3]);instr|=(r<<9)|(base<<6)|fitBits(off,6);break;}
case 4:{if(op==='JSRR'){const base=parseRegister(tokens[1]);instr|=(base<<6);}else{instr|=(1<<11);const target=resolveLabel(tokens[1],symbols,addr+1,lineNum,errors);instr|=fitBits(target,11);}break;}
case 12:{const base=parseRegister(tokens[1]);instr|=(base<<6);break;}
case 15:{const vec=parseImmediate(tokens[1]);instr|=fitBits(vec,8);break;}
default:break;}
output.push(instr&0xFFFF);addr++;
}catch(e){errors.push({line:lineNum,message:e.message||String(e)});output.push(0);addr++;}}
return{program:new Uint16Array(output),errors};}
export function disassemble(word,addr){const op=(word>>12)&0xF;const names=['BR','ADD','LD','ST','JSR','AND','LDR','STR','RTI','NOT','LDI','STI','JMP','RES','LEA','TRAP'];const opName=names[op];
switch(op){case 0:{let flags='';if((word>>11)&1)flags+='n';if((word>>10)&1)flags+='z';if((word>>9)&1)flags+='p';const off=toSigned16(fitBits(word,9)|((word&0x100)?0xFE00:0));return 'BR'+flags+' '+(off>=0?'+':'')+off;}
case 1:case 5:{const dr=(word>>9)&7;const sr1=(word>>6)&7;if((word>>5)&1){let imm=word&0x1F;if(imm&0x10)imm|=0xFFE0;return opName+' R'+dr+', R'+sr1+', #'+toSigned16(imm&0xFFFF);}return opName+' R'+dr+', R'+sr1+', R'+(word&7);}
case 9:return 'NOT R'+((word>>9)&7)+', R'+((word>>6)&7);
case 2:case 3:case 10:case 11:case 14:{const r=(word>>9)&7;let off=word&0x1FF;if(off&0x100)off|=0xFE00;return opName+' R'+r+', '+(toSigned16(off&0xFFFF)>=0?'+':'')+toSigned16(off&0xFFFF);}
case 6:case 7:{const r=(word>>9)&7;const base=(word>>6)&7;let off=word&0x3F;if(off&0x20)off|=0xFFC0;return opName+' R'+r+', R'+base+', #'+toSigned16(off&0xFFFF);}
case 4:{if((word>>11)&1){let off=word&0x7FF;if(off&0x400)off|=0xF800;return 'JSR '+(toSigned16(off&0xFFFF)>=0?'+':'')+toSigned16(off&0xFFFF);}return 'JSRR R'+((word>>6)&7);}
case 12:{const base=(word>>6)&7;return base===7?'RET':'JMP R'+base;}
case 15:{const vec=word&0xFF;const tn={0x20:'GETC',0x21:'OUT',0x22:'PUTS',0x23:'IN',0x24:'PUTSP',0x25:'HALT'};return tn[vec]?'TRAP '+tn[vec]:'TRAP x'+vec.toString(16);}
default:return opName+' x'+((word&0xFFF).toString(16).padStart(3,'0'));}
}` };

ASSETS['/js/ui.js'] = { type: 'application/javascript; charset=utf-8', content: `import * as vm from './vm-wrapper.js';
import { disassemble } from './assembler.js';
const REG_NAMES=['R0','R1','R2','R3','R4','R5','R6','R7','PC','COND'];
let lastRegs=new Uint16Array(10);
function hex(v){return 'x'+(v&0xFFFF).toString(16).toUpperCase().padStart(4,'0');}
export function renderRegisters(){const el=document.getElementById('registers');let html='<table><tr><th>Reg</th><th>Hex</th><th>Dec</th></tr>';for(let i=0;i<=7;i++){const val=vm.getRegister(i);const changed=val!==lastRegs[i];const cls=changed?' class="changed"':'';const signed=val>0x7FFF?val-0x10000:val;html+='<tr'+cls+'><td>'+REG_NAMES[i]+'</td><td>'+hex(val)+'</td><td>'+signed+'</td></tr>';lastRegs[i]=val;}const pc=vm.getRegister(8);const pcChanged=pc!==lastRegs[8];html+='<tr'+(pcChanged?' class="changed"':'')+'><td>PC</td><td>'+hex(pc)+'</td><td>'+pc+'</td></tr>';lastRegs[8]=pc;html+='</table>';el.innerHTML=html;}
export function renderFlags(){const cond=vm.getRegister(9);lastRegs[9]=cond;const el=document.getElementById('flags');el.innerHTML=['N','Z','P'].map(f=>{const bit=f==='N'?4:f==='Z'?2:1;const active=(cond&bit)?'active':'';return '<span class="flag '+active+'">'+f+'</span>';}).join(' ');}
export function renderMemory(){const el=document.getElementById('memory');const pc=vm.getRegister(8);const start=Math.max(0x3000,pc-8);const end=Math.min(0xFFFF,pc+24);let html='<table><tr><th>Addr</th><th>Hex</th><th>Instruction</th></tr>';for(let a=start;a<=end;a++){const word=vm.getMemory(a);const cls=a===pc?' class="current-pc"':'';const arrow=a===pc?'&#9654; ':'';html+='<tr'+cls+'><td>'+arrow+hex(a)+'</td><td>'+hex(word)+'</td><td>'+disassemble(word,a)+'</td></tr>';}html+='</table>';el.innerHTML=html;}
export function appendOutput(text){if(!text)return;const el=document.getElementById('output');el.textContent+=text;el.scrollTop=el.scrollHeight;}
export function clearOutput(){document.getElementById('output').textContent='';}
export function refresh(){renderRegisters();renderFlags();renderMemory();const out=vm.flushOutput();appendOutput(out);}
export function showErrors(errors){const el=document.getElementById('errors');if(!errors||errors.length===0){el.textContent='';el.style.display='none';return;}el.style.display='block';el.textContent=errors.map(e=>'Line '+e.line+': '+e.message).join('\\n');}
export function setStatus(msg){document.getElementById('status').textContent=msg;}
export function buildVMContext(code,lastOpcode){const regs={};for(let i=0;i<=7;i++)regs['R'+i]=vm.getRegister(i);const pc=vm.getRegister(8);const cond=vm.getRegister(9);const flags={N:!!(cond&4),Z:!!(cond&2),P:!!(cond&1)};const currentWord=vm.getMemory(pc);return{registers:regs,pc:hex(pc),flags,halted:vm.isHalted(),currentInstruction:disassemble(currentWord,pc),currentWord:hex(currentWord),lastOpcode:lastOpcode>=0?vm.OP_NAMES[lastOpcode]:null,code};}` };

ASSETS['/js/app.js'] = { type: 'application/javascript; charset=utf-8', content: `import * as vm from './vm-wrapper.js';
import { assemble } from './assembler.js';
import * as ui from './ui.js';
import * as tutor from './tutor.js';
const EXAMPLES={'hello-world':null,'add-numbers':null,'countdown':null,'fibonacci':null,'calculator':null};
let lastOpcode=-1;let runTimer=null;
document.addEventListener('DOMContentLoaded',async()=>{
  ui.setStatus('Loading VM...');
  try{await vm.loadVM();}catch(err){ui.setStatus('WASM load failed');console.error(err);return;}
  vm.init();ui.refresh();ui.setStatus('Ready');
  tutor.setEdgeUrl(window.location.origin);
  await loadExampleSources();wireButtons();wireChat();wireExampleSelector();
  const selector=document.getElementById('example-select');
  if(selector.value)loadExample(selector.value);
});
async function loadExampleSources(){const names=Object.keys(EXAMPLES);await Promise.all(names.map(async(name)=>{try{const res=await fetch('examples/'+name+'.asm');if(res.ok)EXAMPLES[name]=await res.text();}catch{}}));}
function loadExample(name){const src=EXAMPLES[name];if(!src)return;document.getElementById('editor').value=src;doReset();}
function wireButtons(){document.getElementById('btn-assemble').addEventListener('click',doAssemble);document.getElementById('btn-step').addEventListener('click',doStep);document.getElementById('btn-run').addEventListener('click',doRun);document.getElementById('btn-reset').addEventListener('click',doReset);document.getElementById('btn-clear-code').addEventListener('click',doClearCode);document.getElementById('btn-clear-chat').addEventListener('click',doClearChat);}
function wireExampleSelector(){const sel=document.getElementById('example-select');sel.addEventListener('change',()=>loadExample(sel.value));}
function wireChat(){const input=document.getElementById('chat-input');const send=document.getElementById('chat-send');send.addEventListener('click',()=>sendQuestion(input.value.trim()));input.addEventListener('keydown',(e)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendQuestion(input.value.trim());}});document.querySelectorAll('.quick-ask').forEach(btn=>{btn.addEventListener('click',()=>sendQuestion(btn.dataset.question));});}
function doAssemble(){stopRun();const src=document.getElementById('editor').value;const{program,errors}=assemble(src);ui.showErrors(errors);if(errors.length>0){ui.setStatus('Assembly failed — '+errors.length+' error(s)');return;}vm.init();vm.loadProgram(program);ui.clearOutput();ui.refresh();lastOpcode=-1;ui.setStatus('Assembled '+program.length+' words');}
function doStep(){if(vm.isHalted()){ui.setStatus('Halted');return;}lastOpcode=vm.step();ui.refresh();ui.setStatus(vm.isHalted()?'Halted':'Stepped: '+vm.OP_NAMES[lastOpcode]);}
function doRun(){if(runTimer){stopRun();return;}const btn=document.getElementById('btn-run');btn.textContent='Pause';runTimer=setInterval(()=>{if(vm.isHalted()){stopRun();return;}for(let i=0;i<100&&!vm.isHalted();i++){lastOpcode=vm.step();}ui.refresh();if(vm.isHalted()){stopRun();ui.setStatus('Halted');}},16);ui.setStatus('Running...');}
function stopRun(){if(runTimer){clearInterval(runTimer);runTimer=null;}document.getElementById('btn-run').textContent='Run';}
function doReset(){stopRun();vm.init();ui.clearOutput();ui.showErrors([]);ui.refresh();lastOpcode=-1;ui.setStatus('Reset');}
function doClearCode(){stopRun();document.getElementById('editor').value='';document.getElementById('example-select').value='';vm.init();ui.clearOutput();ui.showErrors([]);ui.refresh();lastOpcode=-1;ui.setStatus('Code cleared');}
function doClearChat(){document.getElementById('chat-messages').innerHTML='';}
function sendQuestion(question){if(!question)return;const input=document.getElementById('chat-input');input.value='';tutor.addMessage('user',question);const code=document.getElementById('editor').value;const ctx=ui.buildVMContext(code,lastOpcode);const contentEl=tutor.addMessage('assistant','');tutor.ask(question,ctx,(chunk)=>{contentEl.textContent+=chunk;const chat=document.getElementById('chat-messages');chat.scrollTop=chat.scrollHeight;},()=>{});}` };

// ── Example programs ────────────────────────────────────────────────

ASSETS['/examples/hello-world.asm'] = { type: 'text/plain; charset=utf-8', content: `; Hello World — PUTS trap outputs a string
; Demonstrates: LEA, PUTS, HALT, .STRINGZ

.ORIG x3000

  LEA R0, HELLO       ; R0 = address of the string
  PUTS                ; print the string at R0
  HALT                ; stop the machine

HELLO .STRINGZ "Hello, world!"

.END` };

ASSETS['/examples/add-numbers.asm'] = { type: 'text/plain; charset=utf-8', content: `; Add Numbers — basic arithmetic with ADD
; Demonstrates: AND (clear), ADD immediate, ADD register, HALT

.ORIG x3000

  AND R0, R0, #0      ; R0 = 0  (clear register)
  ADD R0, R0, #7      ; R0 = 7
  AND R1, R1, #0      ; R1 = 0
  ADD R1, R1, #3      ; R1 = 3
  ADD R2, R0, R1      ; R2 = R0 + R1 = 10
  HALT

.END` };

ASSETS['/examples/countdown.asm'] = { type: 'text/plain; charset=utf-8', content: `; Countdown — loop with branch
; Demonstrates: ADD, BRp (branch if positive), OUT, HALT

.ORIG x3000

  AND R0, R0, #0      ; clear R0
  ADD R0, R0, #9      ; R0 = 9 (start counter)

LOOP
  ADD R1, R0, #0      ; R1 = R0 (copy counter)
  LD  R2, ASCII       ; R2 = ASCII '0'
  ADD R1, R1, R2      ; R1 = counter + '0' = ASCII digit
  ; Use OUT trick: move to R0, print, restore
  ADD R3, R0, #0      ; save counter in R3
  ADD R0, R1, #0      ; R0 = ASCII digit
  OUT                 ; print the digit
  LD  R0, NEWLINE     ; R0 = newline character
  OUT                 ; print newline
  ADD R0, R3, #0      ; restore counter
  ADD R0, R0, #-1     ; decrement counter
  BRp LOOP            ; loop while R0 > 0

  HALT

ASCII   .FILL x0030   ; '0' = 0x30
NEWLINE .FILL x000A   ; '\\n'

.END` };

ASSETS['/examples/fibonacci.asm'] = { type: 'text/plain; charset=utf-8', content: `; Fibonacci — compute first N Fibonacci numbers
; Demonstrates: register manipulation, loops, ADD, ST, LD

.ORIG x3000

  AND R0, R0, #0      ; R0 = fib(n-2) = 0
  ADD R1, R0, #1      ; R1 = fib(n-1) = 1
  AND R3, R3, #0
  ADD R3, R3, #10     ; R3 = counter (compute 10 values)

FIBLOOP
  ADD R2, R0, R1      ; R2 = fib(n) = fib(n-2) + fib(n-1)
  ADD R0, R1, #0      ; shift: fib(n-2) = old fib(n-1)
  ADD R1, R2, #0      ; shift: fib(n-1) = fib(n)
  ADD R3, R3, #-1     ; decrement counter
  BRp FIBLOOP         ; loop while counter > 0

  ; R1 now holds fib(12) = 144 (x0090)
  HALT

.END` };

ASSETS['/examples/calculator.asm'] = { type: 'text/plain; charset=utf-8', content: `; Calculator — add two single-digit numbers from keyboard input
; Demonstrates: GETC, OUT, ADD, PUTS, IN traps, I/O

.ORIG x3000

  LEA R0, PROMPT1     ; print "Enter first digit: "
  PUTS
  GETC                ; read character into R0
  OUT                 ; echo it
  LD R3, NEGASCII     ; R3 = -48 (negate ASCII '0')
  ADD R1, R0, R3      ; R1 = numeric value of first digit

  LD R0, NEWLINE
  OUT                 ; print newline

  LEA R0, PROMPT2     ; print "Enter second digit: "
  PUTS
  GETC                ; read character into R0
  OUT                 ; echo it
  ADD R2, R0, R3      ; R2 = numeric value of second digit

  LD R0, NEWLINE
  OUT

  ADD R0, R1, R2      ; R0 = sum
  ST  R0, RESULT      ; store the result

  LEA R0, MSG         ; print "Sum = "
  PUTS

  LD R0, RESULT       ; load sum
  LD R3, POSASCII     ; R3 = 48 (ASCII '0')
  ADD R0, R0, R3      ; convert to ASCII
  OUT                 ; print sum digit

  LD R0, NEWLINE
  OUT

  HALT

PROMPT1  .STRINGZ "Enter first digit: "
PROMPT2  .STRINGZ "Enter second digit: "
MSG      .STRINGZ "Sum = "
NEGASCII .FILL xFFD0  ; -48
POSASCII .FILL x0030  ; 48
NEWLINE  .FILL x000A
RESULT   .BLKW 1

.END` };

// ── WASM binary (base64) ────────────────────────────────────────────

const WASM_B64 = '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';
const WASM_BUF = Buffer.from(WASM_B64, 'base64');

// ── Emscripten glue JS ──────────────────────────────────────────────

ASSETS['/wasm/lc3.js'] = { type: 'application/javascript; charset=utf-8', content: `var LC3Module=(()=>{var _scriptName=globalThis.document?.currentScript?.src;return async function(moduleArg={}){var Module=moduleArg;var ENVIRONMENT_IS_WEB=!!globalThis.window;var ENVIRONMENT_IS_WORKER=!!globalThis.WorkerGlobalScope;var ENVIRONMENT_IS_NODE=globalThis.process?.versions?.node&&globalThis.process?.type!="renderer";var programArgs=[];var thisProgram="./this.program";var quit_=(status,toThrow)=>{throw toThrow};if(typeof __filename!="undefined"){_scriptName=__filename}else if(ENVIRONMENT_IS_WORKER){_scriptName=self.location.href}var scriptDirectory="";function locateFile(path){if(Module["locateFile"]){return Module["locateFile"](path,scriptDirectory)}return scriptDirectory+path}var readAsync,readBinary;if(ENVIRONMENT_IS_NODE){var fs=require("node:fs");scriptDirectory=__dirname+"/";readBinary=filename=>{filename=isFileURI(filename)?new URL(filename):filename;var ret=fs.readFileSync(filename);return ret};readAsync=async(filename,binary=true)=>{filename=isFileURI(filename)?new URL(filename):filename;var ret=fs.readFileSync(filename,binary?undefined:"utf8");return ret};if(process.argv.length>1){thisProgram=process.argv[1].replace(/\\\\/g,"/")}programArgs=process.argv.slice(2);quit_=(status,toThrow)=>{process.exitCode=status;throw toThrow}}else if(ENVIRONMENT_IS_WEB||ENVIRONMENT_IS_WORKER){try{scriptDirectory=new URL(".",_scriptName).href}catch{}{if(ENVIRONMENT_IS_WORKER){readBinary=url=>{var xhr=new XMLHttpRequest;xhr.open("GET",url,false);xhr.responseType="arraybuffer";xhr.send(null);return new Uint8Array(xhr.response)}}readAsync=async url=>{if(isFileURI(url)){return new Promise((resolve,reject)=>{var xhr=new XMLHttpRequest;xhr.open("GET",url,true);xhr.responseType="arraybuffer";xhr.onload=()=>{if(xhr.status==200||xhr.status==0&&xhr.response){resolve(xhr.response);return}reject(xhr.status)};xhr.onerror=reject;xhr.send(null)})}var response=await fetch(url,{credentials:"same-origin"});if(response.ok){return response.arrayBuffer()}throw new Error(response.status+" : "+response.url)}}}else{}var out=console.log.bind(console);var err=console.error.bind(console);var wasmBinary;var ABORT=false;var isFileURI=filename=>filename.startsWith("file://");class EmscriptenEH{}class EmscriptenSjLj extends EmscriptenEH{}var runtimeInitialized=false;function getMemoryBuffer(){return wasmMemory.buffer}function updateMemoryViews(){if(HEAP8?.buffer?.resizable)return;var b=getMemoryBuffer();HEAP8=new Int8Array(b);HEAP16=new Int16Array(b);HEAPU8=new Uint8Array(b);HEAP32=new Int32Array(b);HEAPU32=new Uint32Array(b);HEAPF32=new Float32Array(b);HEAPF64=new Float64Array(b);HEAP64=new BigInt64Array(b)}function preRun(){var preRun=Module["preRun"];if(preRun){if(typeof preRun=="function")preRun=[preRun];onPreRuns.push(...preRun)}callRuntimeCallbacks(onPreRuns)}function initRuntime(){runtimeInitialized=true;wasmExports["__wasm_call_ctors"]()}function postRun(){var postRun=Module["postRun"];if(postRun){if(typeof postRun=="function")postRun=[postRun];onPostRuns.push(...postRun)}callRuntimeCallbacks(onPostRuns)}function abort(what){Module["onAbort"]?.(what);what=\`Aborted(\${what})\`;err(what);ABORT=true;what+=". Build with -sASSERTIONS for more info.";var e=new WebAssembly.RuntimeError(what);throw e}var wasmBinaryFile;function findWasmBinary(){return locateFile("lc3.wasm")}function getBinarySync(file){if(readBinary){return readBinary(file)}throw"both async and sync fetching of the wasm failed"}async function getWasmBinary(binaryFile){if(!wasmBinary){try{var response=await readAsync(binaryFile);return new Uint8Array(response)}catch{}}return getBinarySync(binaryFile)}async function instantiateArrayBuffer(binaryFile,imports){try{var binary=await getWasmBinary(binaryFile);var instance=await WebAssembly.instantiate(binary,imports);return instance}catch(reason){err(\`failed to asynchronously prepare wasm: \${reason}\`);abort(reason)}}async function instantiateAsync(binary,binaryFile,imports){if(!binary&&!isFileURI(binaryFile)&&!ENVIRONMENT_IS_NODE){try{var response=fetch(binaryFile,{credentials:"same-origin"});var instantiationResult=await WebAssembly.instantiateStreaming(response,imports);return instantiationResult}catch(reason){err(\`wasm streaming compile failed: \${reason}\`);err("falling back to ArrayBuffer instantiation")}}return instantiateArrayBuffer(binaryFile,imports)}function getWasmImports(){var imports={env:wasmImports,wasi_snapshot_preview1:wasmImports};return imports}async function createWasm(){function receiveInstance(instance){wasmExports=instance.exports;assignWasmExports(wasmExports);updateMemoryViews();return wasmExports}function receiveInstantiationResult(result){return receiveInstance(result["instance"])}var info=getWasmImports();var instantiateWasm=Module["instantiateWasm"];if(instantiateWasm){return new Promise(resolve=>{instantiateWasm(info,inst=>resolve(receiveInstance(inst)))})}wasmBinaryFile??=findWasmBinary();var result=await instantiateAsync(wasmBinary,wasmBinaryFile,info);var exports=receiveInstantiationResult(result);return exports}class ExitStatus{name="ExitStatus";constructor(status){this.message=\`Program terminated with exit(\${status})\`;this.status=status}}var HEAP8;var callRuntimeCallbacks=callbacks=>{while(callbacks.length>0){callbacks.shift()(Module)}};var onPostRuns=[];var onPreRuns=[];var noExitRuntime=true;var stackRestore=val=>__emscripten_stack_restore(val);var stackSave=()=>_emscripten_stack_get_current();var getCFunc=ident=>{var func=Module["_"+ident];return func};var writeArrayToMemory=(array,buffer)=>{HEAP8.set(array,buffer)};var lengthBytesUTF8=str=>{var len=0;for(var i=0;i<str.length;++i){var c=str.charCodeAt(i);if(c<=127){len++}else if(c<=2047){len+=2}else if(c>=55296&&c<=57343){len+=4;++i}else{len+=3}}return len};var stringToUTF8Array=(str,heap,outIdx,maxBytesToWrite)=>{if(!(maxBytesToWrite>0))return 0;var startIdx=outIdx;var endIdx=outIdx+maxBytesToWrite-1;for(var i=0;i<str.length;++i){var u=str.codePointAt(i);if(u<=127){if(outIdx>=endIdx)break;heap[outIdx++]=u}else if(u<=2047){if(outIdx+1>=endIdx)break;heap[outIdx++]=192|u>>6;heap[outIdx++]=128|u&63}else if(u<=65535){if(outIdx+2>=endIdx)break;heap[outIdx++]=224|u>>12;heap[outIdx++]=128|u>>6&63;heap[outIdx++]=128|u&63}else{if(outIdx+3>=endIdx)break;heap[outIdx++]=240|u>>18;heap[outIdx++]=128|u>>12&63;heap[outIdx++]=128|u>>6&63;heap[outIdx++]=128|u&63;i++}}heap[outIdx]=0;return outIdx-startIdx};var HEAPU8;var stringToUTF8=(str,outPtr,maxBytesToWrite)=>stringToUTF8Array(str,HEAPU8,outPtr,maxBytesToWrite);var stackAlloc=sz=>__emscripten_stack_alloc(sz);var stringToUTF8OnStack=str=>{var size=lengthBytesUTF8(str)+1;var ret=stackAlloc(size);stringToUTF8(str,ret,size);return ret};var UTF8Decoder=globalThis.TextDecoder&&new TextDecoder;var findStringEnd=(heapOrArray,idx,maxBytesToRead,ignoreNul)=>{var maxIdx=idx+maxBytesToRead;if(ignoreNul)return maxIdx;while(heapOrArray[idx]&&!(idx>=maxIdx))++idx;return idx};var UTF8ArrayToString=(heapOrArray,idx=0,maxBytesToRead,ignoreNul)=>{var endPtr=findStringEnd(heapOrArray,idx,maxBytesToRead,ignoreNul);if(endPtr-idx>16&&heapOrArray.buffer&&UTF8Decoder){return UTF8Decoder.decode(heapOrArray.subarray(idx,endPtr))}var str="";while(idx<endPtr){var u0=heapOrArray[idx++];if(!(u0&128)){str+=String.fromCharCode(u0);continue}var u1=heapOrArray[idx++]&63;if((u0&224)==192){str+=String.fromCharCode((u0&31)<<6|u1);continue}var u2=heapOrArray[idx++]&63;if((u0&240)==224){u0=(u0&15)<<12|u1<<6|u2}else{u0=(u0&7)<<18|u1<<12|u2<<6|heapOrArray[idx++]&63}if(u0<65536){str+=String.fromCharCode(u0)}else{var ch=u0-65536;str+=String.fromCharCode(55296|ch>>10,56320|ch&1023)}}return str};var UTF8ToString=(ptr,maxBytesToRead,ignoreNul)=>ptr?UTF8ArrayToString(HEAPU8,ptr,maxBytesToRead,ignoreNul):"";var ccall=(ident,returnType,argTypes,args,opts)=>{var toC={string:str=>{var ret=0;if(str!==null&&str!==undefined&&str!==0){ret=stringToUTF8OnStack(str)}return ret},array:arr=>{var ret=stackAlloc(arr.length);writeArrayToMemory(arr,ret);return ret}};function convertReturnValue(ret){if(returnType==="string"){return UTF8ToString(ret)}if(returnType==="boolean")return Boolean(ret);return ret}var func=getCFunc(ident);var cArgs=[];var stack=0;if(args){for(var i=0;i<args.length;i++){var converter=toC[argTypes[i]];if(converter){if(!stack)stack=stackSave();cArgs[i]=converter(args[i])}else{cArgs[i]=args[i]}}}var ret=func(...cArgs);function onDone(ret){if(stack)stackRestore(stack);return convertReturnValue(ret)}ret=onDone(ret);return ret};var cwrap=(ident,returnType,argTypes,opts)=>{var numericArgs=!argTypes||argTypes.every(type=>type==="number"||type==="boolean");var numericRet=returnType!=="string";if(numericRet&&numericArgs&&!opts){return getCFunc(ident)}return(...args)=>ccall(ident,returnType,argTypes,args,opts)};var HEAP16;var HEAP32;var HEAPU32;var HEAPF32;var HEAPF64;var HEAP64;function getValue(ptr,type="i8"){if(type.endsWith("*"))type="*";switch(type){case"i1":return HEAP8[ptr];case"i8":return HEAP8[ptr];case"i16":return HEAP16[ptr>>1];case"i32":return HEAP32[ptr>>2];case"i64":return HEAP64[ptr>>3];case"float":return HEAPF32[ptr>>2];case"double":return HEAPF64[ptr>>3];case"*":return HEAPU32[ptr>>2];default:abort(\`invalid type for getValue: \${type}\`)}}function setValue(ptr,value,type="i8"){if(type.endsWith("*"))type="*";switch(type){case"i1":HEAP8[ptr]=value;break;case"i8":HEAP8[ptr]=value;break;case"i16":HEAP16[ptr>>1]=value;break;case"i32":HEAP32[ptr>>2]=value;break;case"i64":HEAP64[ptr>>3]=BigInt(value);break;case"float":HEAPF32[ptr>>2]=value;break;case"double":HEAPF64[ptr>>3]=value;break;case"*":HEAPU32[ptr>>2]=value;break;default:abort(\`invalid type for setValue: \${type}\`)}}{if(Module["noExitRuntime"])noExitRuntime=Module["noExitRuntime"];if(Module["print"])out=Module["print"];if(Module["printErr"])err=Module["printErr"];if(Module["arguments"])programArgs=Module["arguments"];if(Module["thisProgram"])thisProgram=Module["thisProgram"];var preInit=Module["preInit"];if(preInit){if(typeof preInit=="function")Module["preInit"]=preInit=[preInit];while(preInit.length>0){preInit.shift()()}}}Module["ccall"]=ccall;Module["cwrap"]=cwrap;Module["setValue"]=setValue;Module["getValue"]=getValue;Module["UTF8ToString"]=UTF8ToString;var _vm_init,_vm_load_program,_vm_step,_vm_get_register,_vm_get_memory,_vm_is_halted,_vm_get_output,_vm_clear_output,_vm_queue_input,_setThrew,__emscripten_stack_restore,__emscripten_stack_alloc,_emscripten_stack_get_current,memory,__indirect_function_table,wasmMemory;function assignWasmExports(wasmExports){_vm_init=Module["_vm_init"]=wasmExports["vm_init"];_vm_load_program=Module["_vm_load_program"]=wasmExports["vm_load_program"];_vm_step=Module["_vm_step"]=wasmExports["vm_step"];_vm_get_register=Module["_vm_get_register"]=wasmExports["vm_get_register"];_vm_get_memory=Module["_vm_get_memory"]=wasmExports["vm_get_memory"];_vm_is_halted=Module["_vm_is_halted"]=wasmExports["vm_is_halted"];_vm_get_output=Module["_vm_get_output"]=wasmExports["vm_get_output"];_vm_clear_output=Module["_vm_clear_output"]=wasmExports["vm_clear_output"];_vm_queue_input=Module["_vm_queue_input"]=wasmExports["vm_queue_input"];_setThrew=wasmExports["setThrew"];__emscripten_stack_restore=wasmExports["_emscripten_stack_restore"];__emscripten_stack_alloc=wasmExports["_emscripten_stack_alloc"];_emscripten_stack_get_current=wasmExports["emscripten_stack_get_current"];memory=wasmMemory=wasmExports["memory"];__indirect_function_table=wasmExports["__indirect_function_table"]}var wasmImports={};async function run(){preRun();var setStatus=Module["setStatus"];if(setStatus){setStatus("Running...");await new Promise(resolve=>setTimeout(resolve,1));setTimeout(setStatus,1,"")}if(ABORT)return;initRuntime();Module["onRuntimeInitialized"]?.();postRun()}var wasmExports;wasmExports=await createWasm();await run();
;return Module}})();if(typeof exports==="object"&&typeof module==="object"){module.exports=LC3Module;module.exports.default=LC3Module}else if(typeof define==="function"&&define["amd"])define([],()=>LC3Module);` };

// ═══════════════════════════════════════════════════════════════════════
// HTTP Server
// ═══════════════════════════════════════════════════════════════════════

function sendJson(res: http.ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
  const url = req.url || '/';

  // Health check
  if (url === '/health' || url.startsWith('/health/')) {
    res.writeHead(200);
    res.end();
    return;
  }

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── API endpoint ──────────────────────────────────────────────────
  if (url === '/api/explain' && req.method === 'POST') {
    let body: ExplainRequest;
    try { body = JSON.parse(await readBody(req)); }
    catch { sendJson(res, { error: 'Invalid JSON' }, 400); return; }
    if (!body.question) { sendJson(res, { error: 'question is required' }, 400); return; }
    const apiKey = process.env.TELNYX_API_KEY;
    if (!apiKey) { sendJson(res, { error: 'TELNYX_API_KEY not configured' }, 500); return; }
    try {
      const payload = JSON.stringify({
        model: INFERENCE_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(body) },
        ],
        max_tokens: 4096, temperature: 0.3,
      });
      // Retry up to 2 times if model returns empty
      let content = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        const resp = await httpsPost(
          TELNYX_HOST, INFERENCE_PATH,
          { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          payload,
        );
        if (resp.status !== 200) { sendJson(res, { error: resp.body.slice(0, 500) }, resp.status); return; }
        const data = JSON.parse(resp.body);
        content = data?.choices?.[0]?.message?.content ?? '';
        if (content) break;
      }
      sendJson(res, { response: content || '(The model returned an empty response — please try again)', model: INFERENCE_MODEL });
    } catch { sendJson(res, { error: 'Inference request failed' }, 500); }
    return;
  }

  // ── WASM binary (served from buffer) ──────────────────────────────
  if (url === '/wasm/lc3.wasm') {
    res.writeHead(200, {
      'Content-Type': 'application/wasm',
      'Content-Length': WASM_BUF.length,
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(WASM_BUF);
    return;
  }

  // ── Static assets ─────────────────────────────────────────────────
  const asset = ASSETS[url];
  if (asset && req.method === 'GET') {
    const buf = typeof asset.content === 'string' ? Buffer.from(asset.content) : asset.content;
    res.writeHead(200, {
      'Content-Type': asset.type,
      'Content-Length': buf.length,
      'Cache-Control': url === '/' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(buf);
    return;
  }

  sendJson(res, { error: 'Not found' }, 404);
});

const port = process.env.PORT || 8080;
server.listen(port, () => {
  console.log(`AI Assembly Tutor running on port ${port}`);
});
