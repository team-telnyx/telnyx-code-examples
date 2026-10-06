/**
 * Orchestration — wires editor, VM, UI, and AI tutor together.
 */

import * as vm from './vm-wrapper.js';
import { assemble } from './assembler.js';
import * as ui from './ui.js';
import * as tutor from './tutor.js';

/* ── Example programs ───────────────────────────────────────────── */

const EXAMPLES = {
  'hello-world': null,
  'add-numbers': null,
  'countdown': null,
  'fibonacci': null,
  'calculator': null
};

let lastOpcode = -1;
let runTimer = null;

/* ── Boot ───────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', async () => {
  ui.setStatus('Loading VM...');

  try {
    await vm.loadVM();
  } catch (err) {
    ui.setStatus('WASM load failed — see console');
    console.error(err);
    return;
  }

  vm.init();
  ui.refresh();
  ui.setStatus('Ready');

  // Configure Edge backend URL from data attribute or default
  const root = document.documentElement;
  const edgeUrl = root.dataset.edgeUrl || window.location.origin;
  tutor.setEdgeUrl(edgeUrl);

  // Load example programs
  await loadExampleSources();
  wireButtons();
  wireChat();
  wireExampleSelector();

  // Load the hello-world example by default
  const selector = document.getElementById('example-select');
  if (selector.value) loadExample(selector.value);
});

/* ── Load example .asm sources ──────────────────────────────────── */

async function loadExampleSources() {
  const names = Object.keys(EXAMPLES);
  await Promise.all(names.map(async (name) => {
    try {
      const res = await fetch(`../examples/${name}.asm`);
      if (res.ok) EXAMPLES[name] = await res.text();
    } catch { /* ignore — example just won't load */ }
  }));
}

function loadExample(name) {
  const src = EXAMPLES[name];
  if (!src) return;
  document.getElementById('editor').value = src;
  doReset();
}

/* ── Wire UI controls ───────────────────────────────────────────── */

function wireButtons() {
  document.getElementById('btn-assemble').addEventListener('click', doAssemble);
  document.getElementById('btn-step').addEventListener('click', doStep);
  document.getElementById('btn-run').addEventListener('click', doRun);
  document.getElementById('btn-reset').addEventListener('click', doReset);
}

function wireExampleSelector() {
  const sel = document.getElementById('example-select');
  sel.addEventListener('change', () => loadExample(sel.value));
}

function wireChat() {
  const input = document.getElementById('chat-input');
  const send  = document.getElementById('chat-send');

  send.addEventListener('click', () => sendQuestion(input.value.trim()));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendQuestion(input.value.trim());
    }
  });

  // Quick-ask buttons
  document.querySelectorAll('.quick-ask').forEach(btn => {
    btn.addEventListener('click', () => sendQuestion(btn.dataset.question));
  });
}

/* ── Actions ────────────────────────────────────────────────────── */

function doAssemble() {
  stopRun();
  const src = document.getElementById('editor').value;
  const { program, errors } = assemble(src);
  ui.showErrors(errors);

  if (errors.length > 0) {
    ui.setStatus(`Assembly failed — ${errors.length} error(s)`);
    return;
  }

  vm.init();
  vm.loadProgram(program);
  ui.clearOutput();
  ui.refresh();
  lastOpcode = -1;
  ui.setStatus(`Assembled ${program.length} words`);
}

function doStep() {
  if (vm.isHalted()) {
    ui.setStatus('Halted');
    return;
  }
  lastOpcode = vm.step();
  ui.refresh();
  ui.setStatus(vm.isHalted() ? 'Halted' : `Stepped: ${vm.OP_NAMES[lastOpcode]}`);
}

function doRun() {
  if (runTimer) { stopRun(); return; }
  const btn = document.getElementById('btn-run');
  btn.textContent = 'Pause';

  runTimer = setInterval(() => {
    if (vm.isHalted()) { stopRun(); return; }
    // Execute a batch of instructions per tick for performance
    for (let i = 0; i < 100 && !vm.isHalted(); i++) {
      lastOpcode = vm.step();
    }
    ui.refresh();
    if (vm.isHalted()) {
      stopRun();
      ui.setStatus('Halted');
    }
  }, 16);

  ui.setStatus('Running...');
}

function stopRun() {
  if (runTimer) { clearInterval(runTimer); runTimer = null; }
  document.getElementById('btn-run').textContent = 'Run';
}

function doReset() {
  stopRun();
  vm.init();
  ui.clearOutput();
  ui.showErrors([]);
  ui.refresh();
  lastOpcode = -1;
  ui.setStatus('Reset');
}

/* ── AI Tutor ───────────────────────────────────────────────────── */

function sendQuestion(question) {
  if (!question) return;
  const input = document.getElementById('chat-input');
  input.value = '';

  tutor.addMessage('user', question);

  const code = document.getElementById('editor').value;
  const ctx  = ui.buildVMContext(code, lastOpcode);
  const contentEl = tutor.addMessage('assistant', '');

  tutor.ask(question, ctx, (chunk) => {
    contentEl.textContent += chunk;
    const chat = document.getElementById('chat-messages');
    chat.scrollTop = chat.scrollHeight;
  }, () => {
    /* stream done */
  });
}
