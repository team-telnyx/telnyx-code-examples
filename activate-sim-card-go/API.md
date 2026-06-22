## `POST /sim/activate`

Activate a Telnyx IoT SIM card by its SIM card ID.

### Request

```json
{
  "sim_card_id": "6b14e151-8493-4fa1-8664-1cc4e6d14158"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sim_card_id` | `string` | **yes** | Telnyx SIM card ID (UUID) to activate |

### Response `200`

```json
{
  "id": "6b14e151-8493-4fa1-8664-1cc4e6d14158",
  "sim_card_id": "6b14e151-8493-4fa1-8664-1cc4e6d14158",
  "action_type": "enable",
  "status": "in-progress",
  "created_at": "2024-01-01T00:00:00Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | SIM Card Action ID tracking the enable operation |
| `sim_card_id` | `string` | ID of the SIM card being enabled |
| `action_type` | `string` | Type of action performed (e.g. `enable`) |
| `status` | `string` | Current status of the action (e.g. `in-progress`) |
| `created_at` | `string` | Timestamp when the action was created |

**Try it:**

```bash
curl -X POST http://localhost:8080/sim/activate \
  -H "Content-Type: application/json" \
  -d '{"sim_card_id": "6b14e151-8493-4fa1-8664-1cc4e6d14158"}'
```

---

## Telnyx API Endpoints Called

The application calls the Telnyx Go SDK method `client.SimCards.Actions.Enable(ctx, simCardID)`, which maps to:

- **Activate SIM Card**: `POST /v2/sim_cards/{id}/actions/enable` -- [API reference](https://developers.telnyx.com/api-reference/sim-cards/enable-sim-card)

---

## Error Handling

All endpoints return JSON. On error:

```json
{"error": "Description of what went wrong"}
```

| Status | Meaning |
|--------|---------|
| `200` | Success — SIM activation accepted |
| `400` | Bad request — missing `sim_card_id`, validation error, or non-API error (e.g. connection failure) |
| `401` | Invalid API key (echoed upstream status from `*telnyx.Error`) |
| `429` | Rate limit exceeded (echoed upstream status from `*telnyx.Error`) |

For `*telnyx.Error` responses, the body also includes a `status_code` field echoing the upstream HTTP status returned by the Telnyx API.
</content>
