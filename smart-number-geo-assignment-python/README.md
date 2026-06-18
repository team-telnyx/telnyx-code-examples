---
name: smart-number-geo-assignment
title: "Smart Number Geo-Assignment"
description: "Smart Number Geo-Assignment — automatically purchase and assign local numbers based on caller geography to maximize answer rates."
language: python
framework: flask
telnyx_products: [Migration, Number Porting, Numbers]
---

# Smart Number Geo-Assignment

Smart Number Geo-Assignment — automatically purchase and assign local numbers based on caller geography to maximize answer rates.


## Telnyx API Endpoints Used

- **Phone Numbers**: `GET /v2/available_phone_numbers` — [API reference](https://developers.telnyx.com/api/numbers/list-available-phone-numbers)


## Architecture

```text
┌─────────────┐                        ┌──────────────────────┐
│  API Client │───────────────────────►│     Your App         │
└─────────────┘                        └──────────┬───────────┘
                                                   │
                                                   ▼
                                          ┌─────────────────┐
                                          │ Response (SMS/  │
                                          │ Voice/Webhook)  │
                                          └─────────────────┘
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY...` | **yes** | Telnyx API v2 key | [→ link](https://portal.telnyx.com/api-keys) |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/smart-number-geo-assignment-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t smart-number-geo-assignment .
docker run --env-file .env -p 5000:5000 smart-number-geo-assignment
```

## API Reference

### `POST /assign`

Assigns to a team member. Notifies both assignee and customer.

**Request:**

```bash
curl -X POST http://localhost:5000/assign \
  -H "Content-Type: application/json" \
  -d '{
  "area_code": "example_value",
  "use_case": "outbound"
}'
```

**Response:**

```json
{
  "number": "...",
  "source": "..."
}
```

### `POST /lookup-and-assign`

Assigns to a team member. Notifies both assignee and customer.

**Request:**

```bash
curl -X POST http://localhost:5000/lookup-and-assign \
  -H "Content-Type: application/json" \
  -d '{
  "target_number": "example_value"
}'
```

**Response:**

```json
{
  "status": "ok"
}
```

### `GET /inventory`

Handles `GET /inventory`.

**Request:**

```bash
curl http://localhost:5000/inventory
```

**Response:**

```json
{
  "numbers": "...",
  "total": 3
}
```

### `GET /assignments`

Returns all assignments.

**Request:**

```bash
curl http://localhost:5000/assignments
```

**Response:**

```json
{
  "assignments": "..."
}
```

### `GET /health`

Returns service health and operational metrics.

**Request:**

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok"
}
```

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
