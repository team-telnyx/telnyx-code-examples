/**
 * UI rendering — registers, memory, flags, output console.
 */

import * as vm from './vm-wrapper.js';
import { disassemble } from './assembler.js';

const REG_NAMES = ['R0','R1','R2','R3','R4','R5','R6','R7','PC','COND'];
const FLAG_LABELS = { 1: 'P', 2: 'Z', 4: 'N' };

let lastRegs = new Uint16Array(10);

/** Hex-format a 16-bit value. */
function hex(v) { return 'x' + (v & 0xFFFF).toString(16).toUpperCase().padStart(4, '0'); }

/** Render registers into #registers. */
export function renderRegisters() {
  const el = document.getElementById('registers');
  let html = '<table><tr><th>Reg</th><th>Hex</th><th>Dec</th></tr>';
  for (let i = 0; i <= 7; i++) {
    const val = vm.getRegister(i);
    const changed = val !== lastRegs[i];
    const cls = changed ? ' class="changed"' : '';
    const signed = val > 0x7FFF ? val - 0x10000 : val;
    html += `<tr${cls}><td>${REG_NAMES[i]}</td><td>${hex(val)}</td><td>${signed}</td></tr>`;
    lastRegs[i] = val;
  }
  // PC
  const pc = vm.getRegister(8);
  const pcChanged = pc !== lastRegs[8];
  html += `<tr${pcChanged ? ' class="changed"' : ''}><td>PC</td><td>${hex(pc)}</td><td>${pc}</td></tr>`;
  lastRegs[8] = pc;
  html += '</table>';
  el.innerHTML = html;
}

/** Render condition flags into #flags. */
export function renderFlags() {
  const cond = vm.getRegister(9);
  lastRegs[9] = cond;
  const el = document.getElementById('flags');
  el.innerHTML = ['N','Z','P'].map(f => {
    const bit = f === 'N' ? 4 : f === 'Z' ? 2 : 1;
    const active = (cond & bit) ? 'active' : '';
    return `<span class="flag ${active}">${f}</span>`;
  }).join(' ');
}

/** Render memory viewer around PC into #memory. */
export function renderMemory() {
  const el = document.getElementById('memory');
  const pc = vm.getRegister(8);
  const start = Math.max(0x3000, pc - 8);
  const end   = Math.min(0xFFFF, pc + 24);
  let html = '<table><tr><th>Addr</th><th>Hex</th><th>Instruction</th></tr>';
  for (let a = start; a <= end; a++) {
    const word = vm.getMemory(a);
    const cls = a === pc ? ' class="current-pc"' : '';
    const arrow = a === pc ? '&#9654; ' : '';
    html += `<tr${cls}><td>${arrow}${hex(a)}</td><td>${hex(word)}</td><td>${disassemble(word, a)}</td></tr>`;
  }
  html += '</table>';
  el.innerHTML = html;
}

/** Append text to the output console. */
export function appendOutput(text) {
  if (!text) return;
  const el = document.getElementById('output');
  el.textContent += text;
  el.scrollTop = el.scrollHeight;
}

/** Clear the output console. */
export function clearOutput() {
  document.getElementById('output').textContent = '';
}

/** Full UI refresh. */
export function refresh() {
  renderRegisters();
  renderFlags();
  renderMemory();
  const out = vm.flushOutput();
  appendOutput(out);
}

/** Show assembler errors in the error display area. */
export function showErrors(errors) {
  const el = document.getElementById('errors');
  if (!errors || errors.length === 0) {
    el.textContent = '';
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  el.textContent = errors.map(e => `Line ${e.line}: ${e.message}`).join('\n');
}

/** Update status bar. */
export function setStatus(msg) {
  document.getElementById('status').textContent = msg;
}

/**
 * Build a context object describing the current VM state for the AI tutor.
 * @param {string} code — current editor source
 * @param {number} lastOpcode — opcode of the last executed instruction
 * @returns {object}
 */
export function buildVMContext(code, lastOpcode) {
  const regs = {};
  for (let i = 0; i <= 7; i++) regs[`R${i}`] = vm.getRegister(i);
  const pc   = vm.getRegister(8);
  const cond = vm.getRegister(9);
  const flags = { N: !!(cond & 4), Z: !!(cond & 2), P: !!(cond & 1) };
  const currentWord = vm.getMemory(pc);
  return {
    registers: regs,
    pc: hex(pc),
    flags,
    halted: vm.isHalted(),
    currentInstruction: disassemble(currentWord, pc),
    currentWord: hex(currentWord),
    lastOpcode: lastOpcode >= 0 ? vm.OP_NAMES[lastOpcode] : null,
    code
  };
}
