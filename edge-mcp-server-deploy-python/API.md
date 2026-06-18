# API Reference — Edge MCP Server

This is a Model Context Protocol (MCP) server deployed to Telnyx Edge. It exposes tools that AI agents can discover and call.

## MCP Methods

| Method | Description |
|--------|-------------|
| `tools/list` | Returns available tools |
| `tools/call` | Executes a tool with arguments |

---

## `tools/list`

Returns all available tools.

### Request

```json
{ "method": "tools/list" }
```

### Response

```json
{
  "tools": [
    { "name": "search_numbers", "description": "Search available phone numbers by area code or region" },
    { "name": "send_sms", "description": "Send an SMS message to a phone number" },
    { "name": "create_call", "description": "Create an outbound voice call" }
  ]
}
```

---

## `tools/call` — search_numbers

### Request

```json
{
  "method": "tools/call",
  "params": {
    "name": "search_numbers",
    "arguments": { "area_code": "212", "limit": 5 }
  }
}
```

### Response

```json
{
  "result": {
    "numbers": ["+12125551234", "+12125551235"]
  }
}
```

---

## `tools/call` — send_sms

### Request

```json
{
  "method": "tools/call",
  "params": {
    "name": "send_sms",
    "arguments": { "to": "+12125559999", "from": "+12125551234", "text": "Hello" }
  }
}
```

### Response

```json
{
  "result": { "message_id": "msg_abc123", "status": "queued" }
}
```

---

## `tools/call` — create_call

### Request

```json
{
  "method": "tools/call",
  "params": {
    "name": "create_call",
    "arguments": { "to": "+12125559999", "from": "+12125551234" }
  }
}
```

### Response

```json
{
  "result": { "call_control_id": "cc_abc123", "status": "initiated" }
}
```
