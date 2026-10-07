## `POST /api/explain`

AI tutor explanation endpoint. Accepts a question and optional VM state context, returns a streaming SSE response powered by Telnyx Inference.

### Request

```json
{
  "question": "What does the PUTS instruction do?",
  "vm_state": {
    "registers": { "R0": 12289, "R1": 0, "R2": 0, "R3": 0, "R4": 0, "R5": 0, "R6": 0, "R7": 0 },
    "pc": "x3002",
    "flags": { "N": false, "Z": false, "P": true },
    "halted": false,
    "currentInstruction": "TRAP PUTS",
    "currentWord": "xF022",
    "lastOpcode": "LEA",
    "code": ".ORIG x3000\n  LEA R0, HELLO\n  PUTS\n  HALT\nHELLO .STRINGZ \"Hello!\"\n.END"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `question` | `string` | **yes** | The student's question about the current instruction or VM state |
| `vm_state` | `object` | no | Current VM state for contextual answers |
| `vm_state.registers` | `object` | no | R0-R7 register values (decimal) |
| `vm_state.pc` | `string` | no | Program counter in hex (e.g. `"x3002"`) |
| `vm_state.flags` | `object` | no | Condition flags: `{ N, Z, P }` booleans |
| `vm_state.halted` | `boolean` | no | Whether the VM has halted |
| `vm_state.currentInstruction` | `string` | no | Disassembled instruction at PC |
| `vm_state.currentWord` | `string` | no | Raw hex of instruction at PC |
| `vm_state.lastOpcode` | `string` | no | Name of the last executed opcode |
| `vm_state.code` | `string` | no | Full assembly source code |

### Response `200` — `text/event-stream`

Server-Sent Events stream. Each event is a JSON chat completion delta:

```
data: {"choices":[{"delta":{"content":"PUTS is a trap routine"},"index":0}]}

data: {"choices":[{"delta":{"content":" that prints a string..."},"index":0}]}

data: [DONE]
```

### Response `400`

```json
{
  "error": "question is required"
}
```

### Response `404`

```json
{
  "error": "Not found"
}
```

**Try it:**

```bash
curl -X POST https://<edge-url>/api/explain \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What does PUTS do?",
    "vm_state": {
      "registers": { "R0": 12289 },
      "pc": "x3002",
      "flags": { "N": false, "Z": false, "P": true },
      "currentInstruction": "TRAP PUTS"
    }
  }'
```

---

## Error Handling

All error responses return JSON with an `error` field.

| Status | Meaning |
|--------|---------|
| `200` | Success — streaming SSE response |
| `400` | Bad request — missing `question` field |
| `404` | Unknown endpoint |
| `500` | Server error — Telnyx Inference call failed |
