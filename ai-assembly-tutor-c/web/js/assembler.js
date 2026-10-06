/**
 * LC-3 two-pass assembler.
 * Converts LC-3 assembly text into a Uint16Array ready for the VM.
 */

const OPCODES = {
  BR:  0, BRn: 0, BRz: 0, BRp: 0, BRnz: 0, BRnp: 0, BRzp: 0, BRnzp: 0,
  ADD: 1, LD:  2, ST:  3, JSR: 4, JSRR: 4,
  AND: 5, LDR: 6, STR: 7, RTI: 8, NOT: 9,
  LDI: 10, STI: 11, JMP: 12, RET: 12, LEA: 14, TRAP: 15
};

const TRAP_VECTORS = {
  GETC: 0x20, OUT: 0x21, PUTS: 0x22, IN: 0x23, PUTSP: 0x24, HALT: 0x25
};

function parseRegister(tok) {
  const m = tok.match(/^[Rr]([0-7])$/);
  if (!m) return -1;
  return parseInt(m[1], 10);
}

function parseImmediate(tok) {
  tok = tok.replace(/^#/, '');
  if (tok.startsWith('x') || tok.startsWith('X'))
    return parseInt(tok.slice(1), 16);
  if (tok.startsWith('0x') || tok.startsWith('0X'))
    return parseInt(tok, 16);
  return parseInt(tok, 10);
}

function toSigned16(val) {
  if (val > 0x7FFF) val -= 0x10000;
  return val;
}

function fitBits(val, bits) {
  const mask = (1 << bits) - 1;
  return val & mask;
}

function tokenize(line) {
  // Remove comments
  const noComment = line.replace(/;.*$/, '').trim();
  if (!noComment) return [];
  // Split on commas and whitespace, preserving quoted strings
  const tokens = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < noComment.length; i++) {
    const ch = noComment[i];
    if (ch === '"') {
      inQuote = !inQuote;
      current += ch;
    } else if (!inQuote && (ch === ',' || ch === ' ' || ch === '\t')) {
      if (current) { tokens.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/**
 * Assemble LC-3 source text.
 * @param {string} source
 * @returns {{ program: Uint16Array, errors: Array<{line: number, message: string}> }}
 */
export function assemble(source) {
  const lines = source.split('\n');
  const errors = [];
  const symbols = {};
  let origin = 0x3000;
  let started = false;
  let ended = false;

  /* ── Pass 1 — build symbol table ─────────────────────────────── */
  let addr = origin;
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const tokens = tokenize(lines[i]);
    if (tokens.length === 0) continue;

    const first = tokens[0].toUpperCase();

    if (first === '.ORIG') {
      origin = parseImmediate(tokens[1]);
      addr = origin;
      started = true;
      continue;
    }
    if (!started) continue;
    if (first === '.END') { ended = true; break; }

    // Check if first token is a label
    if (!(first in OPCODES) && !first.startsWith('.') &&
        !(first in TRAP_VECTORS) && first !== 'RET') {
      const label = tokens[0]; // preserve case for symbol name
      symbols[label.toUpperCase()] = addr;
      tokens.shift();
      if (tokens.length === 0) continue;
    }

    const op = tokens[0].toUpperCase();

    if (op === '.FILL') { addr++; continue; }
    if (op === '.BLKW') { addr += parseImmediate(tokens[1]); continue; }
    if (op === '.STRINGZ') {
      // Count characters in the quoted string + null terminator
      const str = lines[i].match(/"([^"]*)"/);
      addr += (str ? str[1].length : 0) + 1;
      continue;
    }
    addr++;
  }

  if (!started) {
    errors.push({ line: 1, message: 'Missing .ORIG directive' });
    return { program: new Uint16Array(0), errors };
  }

  /* ── Pass 2 — encode instructions ────────────────────────────── */
  const output = [];
  addr = origin;
  started = false;
  ended = false;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    let tokens = tokenize(lines[i]);
    if (tokens.length === 0) continue;

    const first = tokens[0].toUpperCase();

    if (first === '.ORIG') { started = true; continue; }
    if (!started) continue;
    if (first === '.END') { ended = true; break; }

    // Strip label
    if (!(first in OPCODES) && !first.startsWith('.') &&
        !(first in TRAP_VECTORS) && first !== 'RET') {
      tokens.shift();
      if (tokens.length === 0) continue;
    }

    const op = tokens[0].toUpperCase();

    try {
      if (op === '.FILL') {
        let val = parseImmediate(tokens[1]);
        if (isNaN(val) && tokens[1].toUpperCase() in symbols)
          val = symbols[tokens[1].toUpperCase()];
        output.push(val & 0xFFFF);
        addr++;
        continue;
      }

      if (op === '.BLKW') {
        const count = parseImmediate(tokens[1]);
        for (let j = 0; j < count; j++) output.push(0);
        addr += count;
        continue;
      }

      if (op === '.STRINGZ') {
        const str = lines[i].match(/"([^"]*)"/);
        const s = str ? str[1] : '';
        for (let j = 0; j < s.length; j++) output.push(s.charCodeAt(j));
        output.push(0); // null terminator
        addr += s.length + 1;
        continue;
      }

      let instr = 0;

      // Trap aliases
      if (op in TRAP_VECTORS) {
        instr = (0xF << 12) | TRAP_VECTORS[op];
        output.push(instr);
        addr++;
        continue;
      }

      if (op === 'RET') {
        instr = (OP_JMP << 12) | (7 << 6);
        output.push(instr);
        addr++;
        continue;
      }

      const opcode = OPCODES[op];
      if (opcode === undefined) {
        errors.push({ line: lineNum, message: `Unknown opcode: ${op}` });
        output.push(0);
        addr++;
        continue;
      }

      instr = opcode << 12;

      switch (opcode) {

      /* ADD / AND — register or immediate mode */
      case 1: case 5: {
        const dr  = parseRegister(tokens[1]);
        const sr1 = parseRegister(tokens[2]);
        instr |= (dr << 9) | (sr1 << 6);
        const sr2 = parseRegister(tokens[3]);
        if (sr2 >= 0) {
          instr |= sr2;
        } else {
          const imm = parseImmediate(tokens[3]);
          instr |= (1 << 5) | fitBits(imm, 5);
        }
        break;
      }

      /* NOT */
      case 9: {
        const dr = parseRegister(tokens[1]);
        const sr = parseRegister(tokens[2]);
        instr |= (dr << 9) | (sr << 6) | 0x3F;
        break;
      }

      /* BR variants */
      case 0: {
        let nzp = 0;
        const variant = op.slice(2).toLowerCase();
        if (variant === '' || variant === 'nzp') nzp = 7;
        else {
          if (variant.includes('n')) nzp |= 4;
          if (variant.includes('z')) nzp |= 2;
          if (variant.includes('p')) nzp |= 1;
        }
        instr |= (nzp << 9);
        const target = resolveLabel(tokens[1], symbols, addr + 1, lineNum, errors);
        instr |= fitBits(target, 9);
        break;
      }

      /* LD, LDI, LEA, ST, STI */
      case 2: case 10: case 14: case 3: case 11: {
        const r = parseRegister(tokens[1]);
        instr |= (r << 9);
        const offset = resolveLabel(tokens[2], symbols, addr + 1, lineNum, errors);
        instr |= fitBits(offset, 9);
        break;
      }

      /* LDR, STR */
      case 6: case 7: {
        const r    = parseRegister(tokens[1]);
        const base = parseRegister(tokens[2]);
        const off  = parseImmediate(tokens[3]);
        instr |= (r << 9) | (base << 6) | fitBits(off, 6);
        break;
      }

      /* JSR / JSRR */
      case 4: {
        if (op === 'JSRR') {
          const base = parseRegister(tokens[1]);
          instr |= (base << 6);
        } else {
          instr |= (1 << 11);
          const target = resolveLabel(tokens[1], symbols, addr + 1, lineNum, errors);
          instr |= fitBits(target, 11);
        }
        break;
      }

      /* JMP */
      case 12: {
        const base = parseRegister(tokens[1]);
        instr |= (base << 6);
        break;
      }

      /* TRAP */
      case 15: {
        const vec = parseImmediate(tokens[1]);
        instr |= fitBits(vec, 8);
        break;
      }

      default:
        break;
      }

      output.push(instr & 0xFFFF);
      addr++;

    } catch (e) {
      errors.push({ line: lineNum, message: e.message || String(e) });
      output.push(0);
      addr++;
    }
  }

  return { program: new Uint16Array(output), errors };
}

function resolveLabel(tok, symbols, pc, lineNum, errors) {
  if (!tok) { errors.push({ line: lineNum, message: 'Missing operand' }); return 0; }
  const upper = tok.toUpperCase();
  if (upper in symbols) {
    return symbols[upper] - pc;
  }
  // Might be a numeric offset
  const val = parseImmediate(tok);
  if (isNaN(val)) {
    errors.push({ line: lineNum, message: `Undefined label: ${tok}` });
    return 0;
  }
  return val;
}

/**
 * Disassemble a single 16-bit instruction word.
 * @param {number} word
 * @param {number} addr — address of this instruction (for PC-relative display)
 * @returns {string}
 */
export function disassemble(word, addr) {
  const op = (word >> 12) & 0xF;
  const names = ['BR','ADD','LD','ST','JSR','AND','LDR','STR','RTI','NOT','LDI','STI','JMP','RES','LEA','TRAP'];
  const opName = names[op];

  switch (op) {
    case 0: { // BR
      let flags = '';
      if ((word >> 11) & 1) flags += 'n';
      if ((word >> 10) & 1) flags += 'z';
      if ((word >> 9) & 1)  flags += 'p';
      const off = toSigned16(fitBits(word, 9) | ((word & 0x100) ? 0xFE00 : 0));
      return `BR${flags} ${off >= 0 ? '+' : ''}${off}`;
    }
    case 1: case 5: { // ADD / AND
      const dr  = (word >> 9) & 7;
      const sr1 = (word >> 6) & 7;
      if ((word >> 5) & 1) {
        let imm = word & 0x1F;
        if (imm & 0x10) imm |= 0xFFE0;
        return `${opName} R${dr}, R${sr1}, #${toSigned16(imm & 0xFFFF)}`;
      }
      return `${opName} R${dr}, R${sr1}, R${word & 7}`;
    }
    case 9: { // NOT
      return `NOT R${(word >> 9) & 7}, R${(word >> 6) & 7}`;
    }
    case 2: case 3: case 10: case 11: case 14: { // LD/ST/LDI/STI/LEA
      const r = (word >> 9) & 7;
      let off = word & 0x1FF;
      if (off & 0x100) off |= 0xFE00;
      return `${opName} R${r}, ${toSigned16(off & 0xFFFF) >= 0 ? '+' : ''}${toSigned16(off & 0xFFFF)}`;
    }
    case 6: case 7: { // LDR / STR
      const r    = (word >> 9) & 7;
      const base = (word >> 6) & 7;
      let off = word & 0x3F;
      if (off & 0x20) off |= 0xFFC0;
      return `${opName} R${r}, R${base}, #${toSigned16(off & 0xFFFF)}`;
    }
    case 4: { // JSR / JSRR
      if ((word >> 11) & 1) {
        let off = word & 0x7FF;
        if (off & 0x400) off |= 0xF800;
        return `JSR ${toSigned16(off & 0xFFFF) >= 0 ? '+' : ''}${toSigned16(off & 0xFFFF)}`;
      }
      return `JSRR R${(word >> 6) & 7}`;
    }
    case 12: { // JMP / RET
      const base = (word >> 6) & 7;
      return base === 7 ? 'RET' : `JMP R${base}`;
    }
    case 15: { // TRAP
      const vec = word & 0xFF;
      const names = { 0x20: 'GETC', 0x21: 'OUT', 0x22: 'PUTS', 0x23: 'IN', 0x24: 'PUTSP', 0x25: 'HALT' };
      return names[vec] ? `TRAP ${names[vec]}` : `TRAP x${vec.toString(16)}`;
    }
    default:
      return `${opName} x${(word & 0xFFF).toString(16).padStart(3, '0')}`;
  }
}

const OP_JMP = 12;
