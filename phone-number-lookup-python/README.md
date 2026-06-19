---
name: phone-number-lookup
title: "Phone Number Lookup"
description: "Look up carrier, line type, and portability data for any phone number using the Telnyx Number Lookup API, with a 24-hour in-memory cache."
language: python
framework: flask
telnyx_products: [Number Lookup]
channel: [voice, sms]
---

# Phone Number Lookup

Look up carrier, line type, and portability data for any phone number using the Telnyx Number Lookup API, with a 24-hour in-memory cache.

## Telnyx API Endpoints Used

- **Number Lookup**: `GET /v2/number_lookup/{phone_number}` -- [API reference](https://developers.telnyx.com/api-reference/number-lookup/retrieve-lookup)

## Architecture

```
  HTTP Request (POST /lookup or GET /lookup/<number>)
        │
        ▼
  ┌──────────────────┐      hit
  │  In-memory cache  │──────────────► cached result (from_cache: true)
  │   (24h TTL)       │
  └────────┬─────────┘
           │ miss
           ▼
  ┌──────────────────┐
  │  Telnyx Number    │
  │  Lookup API       │
  └────────┬─────────┘
           │
           └──► carrier + line type + portability (cached, returned)
```

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network.

- **Authoritative number data** — carrier, line type, and number portability sourced directly, not resold.
- **Low latency** — lookups served over the Telnyx-owned IP network.
- **One API, one bill** — Number Lookup sits alongside Voice, Messaging, SIP, and IoT under a single account.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `FLASK_DEBUG` | `string` | `false` | no | Enable Flask debug mode | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/phone-number-lookup-python
cp .env.example .env    # ← fill in your TELNYX_API_KEY
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

## API Reference

### `POST /lookup`

Look up a single number from a JSON body.

```bash
curl -X POST http://localhost:5000/lookup \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+15551234567"}'
```

**Response:**

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

### `GET /lookup/<phone_number>`

Look up a single number from the URL path. Use the E.164 number including the `+`.

```bash
curl http://localhost:5000/lookup/+15551234567
```

Returns the same response shape as `POST /lookup`. Repeated lookups within the 24-hour cache window return `"from_cache": true`.

### `GET /cache/stats`

Inspect the in-memory cache for monitoring.

```bash
curl http://localhost:5000/cache/stats
```

**Response:**

```json
{
  "cache_size": 2,
  "cached_numbers": ["+15551234567", "+447700900123"]
}
```

## Troubleshooting

- **Connection refused on port 5000**: App isn't running. Run `python app.py` and check no other process uses port 5000.
- **401 Invalid API key**: Your `TELNYX_API_KEY` is wrong or revoked. Generate a new one at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys) and restart the server.
- **400 Invalid request**: The number is not in E.164 format. Numbers must start with `+` followed by country code and digits, e.g. `+15551234567`.
- **429 Rate limit exceeded**: Space out requests and rely on the cache — repeated lookups of the same number return `from_cache: true` without hitting the API.
- **503 Network error**: Telnyx was unreachable. Check connectivity and the [Telnyx Status Page](https://status.telnyx.com).

## Related Examples

- [number-lookup-fraud-screener-python](../number-lookup-fraud-screener-python/) - screen inbound numbers for fraud before connecting
- [number-lookup-lead-enrichment-python](../number-lookup-lead-enrichment-python/) - enrich sales leads with carrier and CNAM data
- [cnam-caller-id-lookup-enrichment-python](../cnam-caller-id-lookup-enrichment-python/) - CNAM caller ID enrichment
- [bulk-number-validation-cleaner-python](../bulk-number-validation-cleaner-python/) - validate and clean lists of numbers

## Resources

- [Number Lookup Guide](https://developers.telnyx.com/docs/identity/number-lookup)
- [Number Lookup API Reference](https://developers.telnyx.com/api-reference/number-lookup/retrieve-lookup)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx Number Lookup](https://telnyx.com/products/number-lookup)
- [Number Lookup Pricing](https://telnyx.com/pricing/lookup)
