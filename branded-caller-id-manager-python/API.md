# API Reference — Branded Caller ID Manager

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/brands` | Create a new brand. |
| `GET` | `/brands` | List brands. |
| `POST` | `/campaigns` | Create a new campaign. |
| `PUT` | `/numbers/<number>/caller-id` | Update caller id. |
| `GET` | `/stir-shaken/status` | Stir shaken status. |
| `GET` | `/campaigns` | List campaigns. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /brands`

Create a new brand.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `entity_type` | `string` | no | Entity type |
| `display_name` | `string` | **yes** | Display name |
| `company_name` | `string` | **yes** | Company name |
| `ein` | `string` | **yes** | Ein |
| `phone` | `string` | **yes** | Phone number in E.164 format (e.g., `+12125551234`) |
| `street` | `string` | **yes** | Street |
| `city` | `string` | **yes** | City |
| `state` | `string` | **yes** | State |
| `postal_code` | `string` | **yes** | Postal code |
| `country` | `string` | no | Country |
| `vertical` | `string` | no | Vertical |
| `website` | `string` | **yes** | Website |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /brands`

List all brands.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /campaigns`

Create a new campaign.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `brand_id` | `string` | **yes** | Brand id |
| `usecase` | `string` | no | Usecase |
| `description` | `string` | **yes** | Description |
| `sample_message` | `string` | no | Sample message |
| `phone_numbers` | `array` | no | Phone numbers |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `PUT /numbers/<number>/caller-id`

Update caller id.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `business_name` | `string` | no | Business name |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /stir-shaken/status`

Stir shaken status.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /campaigns`

List all campaigns.

### Response `200`

```json
{"campaigns": campaigns}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "campaigns": "..."
}
```

---

## Error Handling

All endpoints return JSON. On error:

```json
{ "status": "ok", "data": { } }
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request — missing or invalid fields |
| `500` | Server error |
