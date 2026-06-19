# API Reference — Phone Number Lookup

All endpoints return JSON. The service wraps the Telnyx Number Lookup API and adds a 24-hour in-memory cache.

## `POST /lookup`

Look up carrier, line type, and portability data for a single phone number.

### Request

```json
{
  "phone_number": "+15551234567"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone_number` | `string` | **yes** | Number to look up, in E.164 format (must start with `+`) |

### Response `200`

```json
{
  "phone_number": "+15551234567",
  "country_code": "US",
  "carrier": {
    "name": "Verizon Wireless",
    "type": "wireless"
  },
  "line_type": "wireless",
  "number_type": "mobile",
  "portability": {
    "status": "ported",
    "last_checked_at": "2026-01-15T12:00:00Z"
  },
  "from_cache": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `phone_number` | `string` | The looked-up number in E.164 format |
| `country_code` | `string` | ISO country code (e.g. `US`) |
| `carrier.name` | `string \| null` | Carrier name, or `null` if unavailable |
| `carrier.type` | `string \| null` | Carrier type, or `null` if unavailable |
| `line_type` | `string` | Line type (e.g. `wireless`, `landline`, `voip`) |
| `number_type` | `string` | Number type classification |
| `portability.status` | `string \| null` | Portability status, or `null` if unavailable |
| `portability.last_checked_at` | `string \| null` | ISO 8601 timestamp of the last portability check |
| `from_cache` | `boolean` | `true` if served from the 24-hour cache, `false` if freshly fetched |

**Try it:**

```bash
curl -X POST http://localhost:5000/lookup \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+15551234567"}'
```

---

## `GET /lookup/<phone_number>`

Look up a single number passed as a URL path parameter. Returns the same body as `POST /lookup`.

| Path parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `phone_number` | `string` | **yes** | Number to look up, in E.164 format (include the leading `+`) |

**Try it:**

```bash
curl http://localhost:5000/lookup/+15551234567
```

---

## `GET /cache/stats`

Return current in-memory cache statistics for monitoring.

### Response `200`

```json
{
  "cache_size": 2,
  "cached_numbers": ["+15551234567", "+447700900123"]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `cache_size` | `integer` | Number of entries currently cached |
| `cached_numbers` | `string[]` | List of cached phone numbers |

**Try it:**

```bash
curl http://localhost:5000/cache/stats
```

---

## Error Handling

All endpoints return JSON. On error:

```json
{"error": "Description of what went wrong"}
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request — missing `phone_number` or not in E.164 format |
| `401` | Invalid `TELNYX_API_KEY` |
| `429` | Rate limit exceeded — slow down and rely on the cache |
| `503` | Network error reaching the Telnyx API |
| `5xx` | Upstream Telnyx API error (status code echoed in `status_code`) |
