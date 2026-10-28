/**
 * JS ↔ WASM bridge for the LC-3 VM.
 * Wraps the Emscripten module with a friendlier API.
 */

let Module = null;
let vmInit, vmLoadProgram, vmStep, vmGetRegister, vmGetMemory;
let vmIsHalted, vmGetOutput, vmClearOutput, vmQueueInput;

/**
 * Initialise the WASM module.
 * @returns {Promise<void>}
 */
export async function loadVM() {
  // LC3Module is the Emscripten factory set via EXPORT_NAME
  Module = await LC3Module();

  vmInit         = Module.cwrap('vm_init',         null,       []);
  vmLoadProgram  = Module.cwrap('vm_load_program', null,       ['number', 'number']);
  vmStep         = Module.cwrap('vm_step',         'number',   []);
  vmGetRegister  = Module.cwrap('vm_get_register', 'number',   ['number']);
  vmGetMemory    = Module.cwrap('vm_get_memory',   'number',   ['number']);
  vmIsHalted     = Module.cwrap('vm_is_halted',    'number',   []);
  vmGetOutput    = Module.cwrap('vm_get_output',   'string',   []);
  vmClearOutput  = Module.cwrap('vm_clear_output', null,       []);
  vmQueueInput   = Module.cwrap('vm_queue_input',  null,       ['number']);
}

export function init() { vmInit(); }

/**
 * Load a Uint16Array program into VM memory starting at 0x3000.
 */
export function loadProgram(uint16Arr) {
  const bytes = uint16Arr.length * 2;
  const ptr   = Module._malloc(bytes);
  for (let i = 0; i < uint16Arr.length; i++) {
    Module.setValue(ptr + i * 2, uint16Arr[i], 'i16');
  }
  vmLoadProgram(ptr, uint16Arr.length);
  Module._free(ptr);
}

/** Execute one instruction; returns the opcode (0-15) or -1 if halted. */
export function step() { return vmStep(); }

/** Read register r (0-9: R0-R7, PC, COND). */
export function getRegister(r) { return vmGetRegister(r); }

/** Read a memory word. */
export function getMemory(addr) { return vmGetMemory(addr); }

/** True when HALT trap has fired. */
export function isHalted() { return !!vmIsHalted(); }

/** Return buffered output string and clear it. */
export function flushOutput() {
  const s = vmGetOutput();
  vmClearOutput();
  return s;
}

/** Queue a character for GETC/IN traps. */
export function queueInput(ch) { vmQueueInput(ch.charCodeAt(0)); }

/** Opcode name table. */
export const OP_NAMES = [
  'BR','ADD','LD','ST','JSR','AND','LDR','STR',
  'RTI','NOT','LDI','STI','JMP','RES','LEA','TRAP'
];
