/*
 * LC-3 Virtual Machine — Browser/WASM build
 *
 * Adapted from https://www.jmeiners.com/lc3-vm/ for Emscripten.
 * Platform-specific I/O (termios, signals) removed; all I/O uses
 * in-memory buffers so the JS host can drive input/output.
 */

#include <stdint.h>
#include <string.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif

/* ── memory & registers ─────────────────────────────────────────── */

#define MEMORY_MAX (1 << 16)          /* 65 536 words */

static uint16_t memory[MEMORY_MAX];

enum {
    R_R0 = 0, R_R1, R_R2, R_R3, R_R4, R_R5, R_R6, R_R7,
    R_PC,     /* program counter */
    R_COND,   /* condition flags */
    R_COUNT
};

static uint16_t reg[R_COUNT];

/* condition flags */
enum { FL_POS = 1 << 0, FL_ZRO = 1 << 1, FL_NEG = 1 << 2 };

/* opcodes */
enum {
    OP_BR = 0, OP_ADD, OP_LD, OP_ST,
    OP_JSR,    OP_AND, OP_LDR, OP_STR,
    OP_RTI,    OP_NOT, OP_LDI, OP_STI,
    OP_JMP,    OP_RES, OP_LEA, OP_TRAP
};

/* trap codes */
enum {
    TRAP_GETC  = 0x20,
    TRAP_OUT   = 0x21,
    TRAP_PUTS  = 0x22,
    TRAP_IN    = 0x23,
    TRAP_PUTSP = 0x24,
    TRAP_HALT  = 0x25
};

/* ── state flags ────────────────────────────────────────────────── */

static int halted;

/* ── output buffer ──────────────────────────────────────────────── */

#define OUTPUT_BUF_SIZE 4096
static char output_buf[OUTPUT_BUF_SIZE];
static int  output_len;

static void buf_putc(char c) {
    if (output_len < OUTPUT_BUF_SIZE - 1) {
        output_buf[output_len++] = c;
        output_buf[output_len]   = '\0';
    }
}

/* ── input queue (ring buffer) ──────────────────────────────────── */

#define INPUT_BUF_SIZE 256
static char input_buf[INPUT_BUF_SIZE];
static int  input_head;
static int  input_tail;

static int input_available(void) {
    return input_head != input_tail;
}

static char input_read(void) {
    if (!input_available()) return '\0';
    char c = input_buf[input_head];
    input_head = (input_head + 1) % INPUT_BUF_SIZE;
    return c;
}

/* ── helpers ────────────────────────────────────────────────────── */

static uint16_t sign_extend(uint16_t x, int bit_count) {
    if ((x >> (bit_count - 1)) & 1)
        x |= (0xFFFF << bit_count);
    return x;
}

static void update_flags(uint16_t r) {
    if      (reg[r] == 0)        reg[R_COND] = FL_ZRO;
    else if (reg[r] >> 15)       reg[R_COND] = FL_NEG;
    else                         reg[R_COND] = FL_POS;
}

static uint16_t mem_read(uint16_t addr) {
    /* KBSR — keyboard status register */
    if (addr == 0xFE00) {
        if (input_available()) {
            memory[0xFE00] = (1 << 15);
            memory[0xFE02] = (uint16_t)input_buf[input_head];
        } else {
            memory[0xFE00] = 0;
        }
    }
    return memory[addr];
}

static void mem_write(uint16_t addr, uint16_t val) {
    memory[addr] = val;
}

/* ── public API ─────────────────────────────────────────────────── */

EXPORT void vm_init(void) {
    memset(memory, 0, sizeof(memory));
    memset(reg, 0, sizeof(reg));
    reg[R_PC]   = 0x3000;
    reg[R_COND] = FL_ZRO;
    halted      = 0;
    output_len  = 0;
    output_buf[0] = '\0';
    input_head  = 0;
    input_tail  = 0;
}

EXPORT void vm_load_program(uint16_t *program, int length) {
    for (int i = 0; i < length && (0x3000 + i) < MEMORY_MAX; i++)
        memory[0x3000 + i] = program[i];
}

EXPORT int vm_step(void) {
    if (halted) return -1;

    uint16_t instr = mem_read(reg[R_PC]++);
    uint16_t op    = instr >> 12;

    switch (op) {

    /* ── BR ───────────────────────────────────────────────────── */
    case OP_BR: {
        uint16_t cond = (instr >> 9) & 0x7;
        if (cond & reg[R_COND]) {
            uint16_t offset = sign_extend(instr & 0x1FF, 9);
            reg[R_PC] += offset;
        }
        break;
    }

    /* ── ADD ──────────────────────────────────────────────────── */
    case OP_ADD: {
        uint16_t dr  = (instr >> 9) & 0x7;
        uint16_t sr1 = (instr >> 6) & 0x7;
        if ((instr >> 5) & 0x1) {
            uint16_t imm5 = sign_extend(instr & 0x1F, 5);
            reg[dr] = reg[sr1] + imm5;
        } else {
            uint16_t sr2 = instr & 0x7;
            reg[dr] = reg[sr1] + reg[sr2];
        }
        update_flags(dr);
        break;
    }

    /* ── LD ───────────────────────────────────────────────────── */
    case OP_LD: {
        uint16_t dr     = (instr >> 9) & 0x7;
        uint16_t offset = sign_extend(instr & 0x1FF, 9);
        reg[dr] = mem_read(reg[R_PC] + offset);
        update_flags(dr);
        break;
    }

    /* ── ST ───────────────────────────────────────────────────── */
    case OP_ST: {
        uint16_t sr     = (instr >> 9) & 0x7;
        uint16_t offset = sign_extend(instr & 0x1FF, 9);
        mem_write(reg[R_PC] + offset, reg[sr]);
        break;
    }

    /* ── JSR / JSRR ──────────────────────────────────────────── */
    case OP_JSR: {
        reg[R_R7] = reg[R_PC];
        if ((instr >> 11) & 1) {
            uint16_t offset = sign_extend(instr & 0x7FF, 11);
            reg[R_PC] += offset;
        } else {
            uint16_t base = (instr >> 6) & 0x7;
            reg[R_PC] = reg[base];
        }
        break;
    }

    /* ── AND ──────────────────────────────────────────────────── */
    case OP_AND: {
        uint16_t dr  = (instr >> 9) & 0x7;
        uint16_t sr1 = (instr >> 6) & 0x7;
        if ((instr >> 5) & 0x1) {
            uint16_t imm5 = sign_extend(instr & 0x1F, 5);
            reg[dr] = reg[sr1] & imm5;
        } else {
            uint16_t sr2 = instr & 0x7;
            reg[dr] = reg[sr1] & reg[sr2];
        }
        update_flags(dr);
        break;
    }

    /* ── LDR ──────────────────────────────────────────────────── */
    case OP_LDR: {
        uint16_t dr     = (instr >> 9) & 0x7;
        uint16_t base   = (instr >> 6) & 0x7;
        uint16_t offset = sign_extend(instr & 0x3F, 6);
        reg[dr] = mem_read(reg[base] + offset);
        update_flags(dr);
        break;
    }

    /* ── STR ──────────────────────────────────────────────────── */
    case OP_STR: {
        uint16_t sr     = (instr >> 9) & 0x7;
        uint16_t base   = (instr >> 6) & 0x7;
        uint16_t offset = sign_extend(instr & 0x3F, 6);
        mem_write(reg[base] + offset, reg[sr]);
        break;
    }

    /* ── RTI (unused in user mode) ────────────────────────────── */
    case OP_RTI:
        break;

    /* ── NOT ──────────────────────────────────────────────────── */
    case OP_NOT: {
        uint16_t dr  = (instr >> 9) & 0x7;
        uint16_t sr  = (instr >> 6) & 0x7;
        reg[dr] = ~reg[sr];
        update_flags(dr);
        break;
    }

    /* ── LDI ──────────────────────────────────────────────────── */
    case OP_LDI: {
        uint16_t dr     = (instr >> 9) & 0x7;
        uint16_t offset = sign_extend(instr & 0x1FF, 9);
        reg[dr] = mem_read(mem_read(reg[R_PC] + offset));
        update_flags(dr);
        break;
    }

    /* ── STI ──────────────────────────────────────────────────── */
    case OP_STI: {
        uint16_t sr     = (instr >> 9) & 0x7;
        uint16_t offset = sign_extend(instr & 0x1FF, 9);
        mem_write(mem_read(reg[R_PC] + offset), reg[sr]);
        break;
    }

    /* ── JMP / RET ────────────────────────────────────────────── */
    case OP_JMP: {
        uint16_t base = (instr >> 6) & 0x7;
        reg[R_PC] = reg[base];
        break;
    }

    /* ── RES (reserved) ──────────────────────────────────────── */
    case OP_RES:
        break;

    /* ── LEA ──────────────────────────────────────────────────── */
    case OP_LEA: {
        uint16_t dr     = (instr >> 9) & 0x7;
        uint16_t offset = sign_extend(instr & 0x1FF, 9);
        reg[dr] = reg[R_PC] + offset;
        update_flags(dr);
        break;
    }

    /* ── TRAP ─────────────────────────────────────────────────── */
    case OP_TRAP:
        reg[R_R7] = reg[R_PC];
        switch (instr & 0xFF) {

        case TRAP_GETC:
            reg[R_R0] = (uint16_t)input_read();
            update_flags(R_R0);
            break;

        case TRAP_OUT:
            buf_putc((char)(reg[R_R0] & 0xFF));
            break;

        case TRAP_PUTS: {
            uint16_t *c = memory + reg[R_R0];
            while (*c) {
                buf_putc((char)(*c & 0xFF));
                c++;
            }
            break;
        }

        case TRAP_IN:
            buf_putc('>');
            buf_putc(' ');
            if (input_available()) {
                char ch = input_read();
                reg[R_R0] = (uint16_t)ch;
                buf_putc(ch);
            } else {
                reg[R_R0] = 0;
            }
            update_flags(R_R0);
            break;

        case TRAP_PUTSP: {
            uint16_t *c = memory + reg[R_R0];
            while (*c) {
                char c1 = (*c) & 0xFF;
                buf_putc(c1);
                char c2 = (*c) >> 8;
                if (c2) buf_putc(c2);
                c++;
            }
            break;
        }

        case TRAP_HALT:
            halted = 1;
            break;

        default:
            break;
        }
        break;

    default:
        break;
    }

    return (int)op;
}

EXPORT uint16_t vm_get_register(int r) {
    if (r < 0 || r >= R_COUNT) return 0;
    return reg[r];
}

EXPORT uint16_t vm_get_memory(uint16_t addr) {
    return memory[addr];
}

EXPORT int vm_is_halted(void) {
    return halted;
}

EXPORT const char* vm_get_output(void) {
    return output_buf;
}

EXPORT void vm_clear_output(void) {
    output_len    = 0;
    output_buf[0] = '\0';
}

EXPORT void vm_queue_input(char c) {
    int next = (input_tail + 1) % INPUT_BUF_SIZE;
    if (next != input_head) {
        input_buf[input_tail] = c;
        input_tail = next;
    }
}
