# API Reference — RCS Capability Campaign Desk

All endpoints are served from `http://localhost:5050` by default.

## `GET /health`

Health check endpoint.

```bash
curl http://localhost:5050/health
```

**Response:**

```json
{
  "status": "ok",
  "uptime_seconds": 42,
  "version": "1.0.0"
}
```

---

## `GET /`

Serves the single-page dashboard UI.

```bash
open http://localhost:5050
```

---

## `POST /api/check-capability`

Checks a phone number's carrier info (Number Lookup) and RCS feature support (RCS Capabilities API), then returns a format recommendation.

**Request:**

```bash
curl -X POST http://localhost:5050/api/check-capability \
  -H "Content-Type: application/json" \
  -d '{"phone": "+12125551234"}'
```

**Response:**

```json
{
  "phone": "+12125551234",
  "number_lookup": {
    "carrier": "T-Mobile",
    "line_type": "mobile",
    "country_code": "US"
  },
  "rcs_capabilities": {
    "features": ["RICHCARD_STANDALONE", "ACTION_DIAL", "ACTION_VIEW_LOCATION"],
    "rcs_enabled": true
  },
  "decision": {
    "format": "rich_card_with_sms_fallback",
    "tier": "full_rcs",
    "reason": "Device supports standalone rich cards — sending rich card with SMS fallback."
  }
}
```

**Decision tiers:**

| Tier | Format | When |
|------|--------|------|
| `full_rcs` | `rich_card_with_sms_fallback` | Device supports `RICHCARD_STANDALONE` |
| `basic_rcs` | `plain_rcs_with_sms_fallback` | Device has RCS features but no rich cards |
| `no_rcs` | `sms_only` | Landline, VoIP, or no RCS support |

---

## `POST /api/generate-content`

Uses Telnyx AI Inference to generate RCS rich card content and SMS fallback text from a campaign prompt.

**Request:**

```bash
curl -X POST http://localhost:5050/api/generate-content \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Flash sale: 30% off all plans this weekend only"}'
```

**Response:**

```json
{
  "content": {
    "title": "Weekend Flash Sale",
    "description": "Get 30% off all Telnyx plans this weekend. Limited time offer.",
    "button_text": "Shop Now",
    "button_url": "https://telnyx.com/pricing",
    "sms_fallback_text": "Flash Sale! 30% off all plans this weekend. Shop now: https://telnyx.com/pricing"
  }
}
```

---

## `POST /api/send`

Runs a capability check on the recipient, applies the decision ladder, and sends the message in the optimal format.

**Request:**

```bash
curl -X POST http://localhost:5050/api/send \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125551234",
    "title": "Weekend Flash Sale",
    "description": "Get 30% off all Telnyx plans this weekend.",
    "button_text": "Shop Now",
    "button_url": "https://telnyx.com/pricing",
    "sms_fallback_text": "Flash Sale! 30% off all plans this weekend. Shop now: https://telnyx.com/pricing"
  }'
```

**Response:**

```json
{
  "decision": {
    "format": "rich_card_with_sms_fallback",
    "tier": "full_rcs",
    "reason": "Device supports standalone rich cards — sending rich card with SMS fallback."
  },
  "results": [
    {
      "channel": "rcs_rich_card",
      "status": "sent",
      "message_id": "4001d26e-1234-5678-9abc-def012345678"
    },
    {
      "channel": "sms_fallback",
      "status": "sent",
      "message_id": "4001d26e-8765-4321-cba9-876543210fed"
    }
  ]
}
```

---

## `POST /api/generate-deeplink`

Generates an RCS deeplink URL that opens an RCS conversation pre-filled with the given message body.

**Request:**

```bash
curl -X POST http://localhost:5050/api/generate-deeplink \
  -H "Content-Type: application/json" \
  -d '{"body": "Hi! I would like to learn about your weekend flash sale."}'
```

**Response:**

```json
{
  "deeplink": "https://rcs.telnyx.com/dl/abc123",
  "raw": {
    "deeplink_url": "https://rcs.telnyx.com/dl/abc123"
  }
}
```
