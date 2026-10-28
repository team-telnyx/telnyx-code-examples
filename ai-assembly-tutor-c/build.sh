#!/usr/bin/env bash
# Build the LC-3 VM C source to WebAssembly via Emscripten.
# Requires: emsdk installed and activated (https://emscripten.org/docs/getting_started/)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$SCRIPT_DIR/web/wasm"

mkdir -p "$OUT_DIR"

emcc "$SCRIPT_DIR/app.c" -o "$OUT_DIR/lc3.js" \
  -s EXPORTED_FUNCTIONS='["_vm_init","_vm_load_program","_vm_step","_vm_get_register","_vm_get_memory","_vm_is_halted","_vm_get_output","_vm_clear_output","_vm_queue_input"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","getValue","setValue","UTF8ToString"]' \
  -s MODULARIZE=1 \
  -s EXPORT_NAME="LC3Module" \
  -s ALLOW_MEMORY_GROWTH=1 \
  -O2

echo "Build complete: $OUT_DIR/lc3.js + lc3.wasm"
