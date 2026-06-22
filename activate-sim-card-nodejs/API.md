# API Reference — Activate SIM Card

The Express server (`server.js`) exposes three HTTP routes. All responses are JSON.

## `GET /sim/:id`

Retrieve details for a single SIM card.

### Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` (path) | `string` | **yes** | Telnyx SIM card ID |

No request body.

### Response `200`

```json
{
  "id": "6b14e151-8493-4fa1-8664-1cc4e6d14158",
  "iccid": "89310410106543789301",
  "status": "disabled",
  "simCardGroupId": "47a9c0fa-1d3b-4f2a-9e22-2c4e9a1b7d10",
  "phoneNumber": "+13125550123"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | SIM card ID |
| `iccid` | `string` | Integrated Circuit Card Identifier |
| `status` | `string` | Current SIM status (e.g. `disabled`, `enabled`) |
| `simCardGroupId` | `string` | ID of the SIM card group |
| `phoneNumber` | `string \| null` | Associated phone number, or `null` |

**Try it:**

```bash
curl http://localhost:5000/sim/6b14e151-8493-4fa1-8664-1cc4e6d14158
```

---

## `POST /sim/:id/activate`

Activate a SIM card by ID.

### Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` (path) | `string` | **yes** | Telnyx SIM card ID to activate |

No request body.

### Response `200`

```json
{
  "message": "SIM card activated successfully",
  "sim": {
    "id": "6b14e151-8493-4fa1-8664-1cc4e6d14158",
    "iccid": "89310410106543789301",
    "status": "enabled",
    "simCardGroupId": "47a9c0fa-1d3b-4f2a-9e22-2c4e9a1b7d10",
    "activatedAt": "2026-06-18T12:00:00.000Z"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `message` | `string` | Human-readable success message |
| `sim.id` | `string` | SIM card ID |
| `sim.iccid` | `string` | Integrated Circuit Card Identifier |
| `sim.status` | `string` | SIM status after activation |
| `sim.simCardGroupId` | `string` | ID of the SIM card group |
| `sim.activatedAt` | `string \| null` | Activation timestamp, or `null` |

**Try it:**

```bash
curl -X POST http://localhost:5000/sim/6b14e151-8493-4fa1-8664-1cc4e6d14158/activate
```

---

## `GET /health`

Liveness probe.

### Response `200`

```json
{ "status": "ok" }
```

---

## Telnyx API endpoints called

The code calls the Telnyx IoT SIM API through the Node.js SDK:

| SDK call | Telnyx endpoint | Used by route |
|----------|-----------------|---------------|
| `client.simCards.retrieve(id)` | `GET /v2/sim_cards/{id}` | `GET /sim/:id` |
| `client.simCards.actions.enable(id)` | `POST /v2/sim_cards/{id}/actions/enable` | `POST /sim/:id/activate` |

## Error Handling

All endpoints return JSON. Errors are mapped from Telnyx SDK exceptions to HTTP status codes:

| Status | Meaning | Body |
|--------|---------|------|
| `200` | Success | Route-specific payload |
| `400` | Invalid SIM card ID | `{"error": "SIM card ID must be a non-empty string"}` |
| `401` | Authentication failed | `{"error": "Invalid API key"}` |
| `429` | Rate limited | `{"error": "Rate limit exceeded. Please slow down."}` |
| `503` | Network error reaching Telnyx | `{"error": "Network error connecting to Telnyx"}` |
| `500` | Unexpected server error | `{"error": "Internal server error", "message": "..."}` |

For Telnyx `APIError` responses, the server returns the upstream status code (e.g. `404`) with `{"error": "...", "status_code": <code>}`.
