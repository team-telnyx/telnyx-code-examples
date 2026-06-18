---
name: wireguard-private-voice-network
title: "WireGuard Private Voice Network"
description: "WireGuard Private Voice Network — create WireGuard mesh network for private SIP trunking with encrypted voice traffic."
language: python
framework: flask
telnyx_products: [Migration, Networking, Number Porting]
---

# WireGuard Private Voice Network

WireGuard Private Voice Network — create WireGuard mesh network for private SIP trunking with encrypted voice traffic.

## Telnyx API Endpoints Used

- **Create WireGuard Interface**: `POST /v2/wireguard_interfaces` — [API reference](https://developers.telnyx.com/api/networking/create-wireguard-interface)
- **List WireGuard Interfaces**: `GET /v2/wireguard_interfaces` — [API reference](https://developers.telnyx.com/api/networking/list-wireguard-interfaces)
- **Create Call**: `POST /v2/calls` — [API reference](https://developers.telnyx.com/api/call-control/create-call)

## Architecture

```
  API Request
        │
        ▼
  ┌──────────────────┐
  │  Your App         │
  └────────┬─────────┘
           │
           ├──► Telnyx Number Porting
           ├──► Telnyx Global IP / WireGuard
           │
           ▼
     JSON API response
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/wireguard-private-voice-network-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t wireguard-private-voice-network-python .
docker run --env-file .env -p 5000:5000 wireguard-private-voice-network-python
```

## API Reference

### `POST /networks`

Triggers networks

```bash
curl -X POST http://localhost:5000/networks \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "id": "item-1750280400",
  "status": "created",
  "created_at": "2026-07-15T14:30:00Z"
}
```

### `GET /networks`

Returns networks

```bash
curl http://localhost:5000/networks
```

**Response:**

```json
{
  "items": [
    {
      "id": "item-001",
      "status": "active",
      "created_at": "2026-07-15T14:30:00Z"
    }
  ]
}
```

### `POST /interfaces`

Triggers interfaces

```bash
curl -X POST http://localhost:5000/interfaces \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "id": "item-1750280400",
  "status": "created",
  "created_at": "2026-07-15T14:30:00Z"
}
```

### `POST /peers`

Triggers peers

```bash
curl -X POST http://localhost:5000/peers \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "id": "item-1750280400",
  "status": "created",
  "created_at": "2026-07-15T14:30:00Z"
}
```

### `GET /interfaces/<iface_id>/config`

Returns config

```bash
curl http://localhost:5000/interfaces/example-id/config
```

**Response:**

```json
{
  "items": [
    {
      "id": "item-001",
      "status": "active",
      "created_at": "2026-07-15T14:30:00Z"
    }
  ]
}
```

### `GET /topology`

Returns topology

```bash
curl http://localhost:5000/topology
```

**Response:**

```json
{
  "items": [
    {
      "id": "item-001",
      "status": "active",
      "created_at": "2026-07-15T14:30:00Z"
    }
  ]
}
```

### `GET /health`

Returns health

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok",
  "uptime_seconds": 3842,
  "active_sessions": 2,
  "version": "1.0.0"
}
```

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
