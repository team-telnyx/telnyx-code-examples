# Guide — Edge Compute Backend for AI Assistant

This walkthrough shows how to build a single Telnyx Edge Compute function (Go) that serves as the backend for an AI Assistant — handling both dynamic variable resolution at call start and webhook tool calls mid-conversation — with no separate server.

## What you'll build

A lead-screener assistant ("Jordan") for a home services company that:

1. Greets callers by company name (dynamic variables resolved from the caller's phone number via Edge function)
2. Qualifies the lead (service type, scope, timeline, budget, property type, decision-maker)
3. Calls a `schedule_estimate` webhook tool (same Edge function) to book an on-site estimate

Both the dynamic variable lookup and the tool call hit one Edge Compute function at a single URL.

## Key concepts

### Single function, two callbacks

Edge Compute routes all HTTP methods and paths under your function URL to your handler. This guide uses body-shape dispatch:

- **Dynamic variables webhook** — Telnyx wraps the payload under `data.event_type`.
- **Webhook tool call** — the body is the flat arguments object from the tool's `body_parameters` schema.

You could also use separate paths (e.g. `/dynamic-variables` and `/tool/schedule-estimate`) if you prefer path-based routing.

### Webhook signature verification

Telnyx signs every dynamic-variables webhook and webhook tool call with an Ed25519 key. The signature is in the `telnyx-signature-ed25519` header; the timestamp is in `telnyx-timestamp`. The signed message is `"{timestamp}|{raw_body}"`.

Your org's public key is available at:

```bash
GET https://api.telnyx.com/v2/public_key
Authorization: Bearer <TELNYX_API_KEY>
```

The response contains `data.public` — the base64-encoded Ed25519 public key.

### Dynamic variables response format

The response **must** nest variables under a `dynamic_variables` key:

```json
{
  "dynamic_variables": {
    "customer_name": "James Smith",
    "account_tier": "premium"
  }
}
```

A flat object (e.g. `{"customer_name": "James"}`) is silently ignored.

### Timeout

The default dynamic variables webhook timeout is 1,500 ms. Edge Compute functions may occasionally need more time on a cold start, so set `dynamic_variables_webhook_timeout_ms` to 8,000 ms.

## Step 1: Scaffold the function

```bash
telnyx-edge new-func -l go -n edge-ai-assistant-backend
cd edge-ai-assistant-backend
```

> The Go module **must** be named `function` (package `function`, entrypoint `Handle(w, r)`). Other module names fail to build. Use `go 1.24` in `go.mod`.

## Step 2: Store the public key as a secret

```bash
PUBLIC_KEY=$(curl -s -H "Authorization: Bearer $TELNYX_API_KEY" \
  https://api.telnyx.com/v2/public_key | jq -r '.data.public')

telnyx-edge secrets add TELNYX_PUBLIC_KEY "$PUBLIC_KEY"
```

The function reads this secret from `os.Getenv("TELNYX_PUBLIC_KEY")` at startup.

## Step 3: Write the handler

The handler does three things:

1. Verifies the Telnyx Ed25519 signature on every request
2. Detects whether the request is a dynamic-variables webhook or a tool call
3. Returns the appropriate response

See `handler.go` in this folder for the full implementation.

### Body-shape dispatch

```go
func isDynamicVariablesRequest(body []byte) bool {
    var probe struct {
        Data *struct {
            EventType string `json:"event_type"`
        } `json:"data"`
    }
    if err := json.Unmarshal(body, &probe); err != nil {
        return false
    }
    return probe.Data != nil
}
```

### Signature verification

```go
func verifyTelnyxSignature(h http.Header, body []byte) bool {
    if publicKey == nil {
        return false
    }
    sig := h.Get("telnyx-signature-ed25519")
    ts := h.Get("telnyx-timestamp")
    // ... parse timestamp, check skew, decode signature, verify
    signed := append([]byte(ts+"|"), body...)
    return ed25519.Verify(publicKey, signed, s)
}
```

## Step 4: Ship the function

```bash
telnyx-edge ship
```

The ship process takes 2–3 minutes. After upload, poll `telnyx-edge list` until status shows `deploy_ok`.

```bash
telnyx-edge list
# FUNC ID      FUNCTION NAME              STATUS      INVOKE URL
# ...          edge-ai-assistant-backend  deploy_ok   https://edge-ai-assistant-backend-<org>.telnyxcompute.com
```

## Step 5: Configure the AI Assistant

Set the function URL as both the dynamic variables webhook URL and the webhook tool URL:

| Field | Value |
|-------|-------|
| `dynamic_variables_webhook_url` | `https://edge-ai-assistant-backend-<org>.telnyxcompute.com/` |
| `dynamic_variables_webhook_timeout_ms` | `8000` |

Add a webhook tool pointing to the same URL:

```json
{
  "type": "webhook",
  "webhook": {
    "name": "schedule_estimate",
    "url": "https://edge-ai-assistant-backend-<org>.telnyxcompute.com/",
    "method": "POST",
    "body_parameters": {
      "type": "object",
      "properties": {
        "customer_name": {"type": "string"},
        "phone_number": {"type": "string"},
        "service_type": {"type": "string"},
        "service_address": {"type": "string"},
        "preferred_date": {"type": "string"},
        "preferred_time": {"type": "string"}
      },
      "required": ["customer_name", "phone_number", "service_type", "service_address"]
    }
  }
}
```

Use `{{variable_name}}` in the assistant's instructions and greeting:

```
greeting: "Hi, this is Jordan with {{company_name}}..."
instructions: "You are Jordan, a lead specialist for {{company_name}}. Scheduling speed: {{timeframe}}."
```

## Step 6: Test end-to-end

1. **Call the function directly** (expect 403 — signature verification working):
   ```bash
   curl -X POST https://edge-ai-assistant-backend-<org>.telnyxcompute.com/ \
     -H "Content-Type: application/json" \
     -d '{"customer_name":"Test","phone_number":"+15551234567","service_type":"roof repair","service_address":"123 Main St","preferred_date":"2025-04-10","preferred_time":"10:00"}'
   # → 403 invalid signature
   ```

2. **Make a test call** to the assistant's phone number from your phone.

3. **Verify** in the conversation:
   - The greeting includes the resolved `company_name`
   - The assistant can call `schedule_estimate` and read back the confirmation number

## Tips and gotchas

- **Ship takes a few minutes** — the CLI's build monitor has a 5-minute timeout, but the build continues server-side. Check `telnyx-edge list` for the actual status.
- **Secrets require re-shipping** — adding or changing a secret does not affect an already-deployed function. Run `telnyx-edge ship` again.
- **The `dynamic_variables` wrapper is mandatory** — returning a flat JSON object will be silently ignored.
- **Module name must be `function`** — other names fail to build with "malformed module path."
