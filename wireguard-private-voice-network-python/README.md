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

- **WireGuard Interfaces**: `POST /v2/wireguard_interfaces` — [API reference](https://developers.telnyx.com/api/networking/create-wireguard-interface)


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
cd telnyx-code-examples/wireguard-private-voice-network-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t wireguard-private-voice-network .
docker run --env-file .env -p 5000:5000 wireguard-private-voice-network
```

## API Reference

### `POST /networks`

Creates a new record.

**Request:**

```bash
curl -X POST http://localhost:5000/networks \
  -H "Content-Type: application/json" \
  -d '{
  "name": "f\"voice-net-{int(time.time("
}'
```

**Response:**

```json
{
  "status": "ok"
}
```

### `GET /networks`

Returns all networks.

**Request:**

```bash
curl http://localhost:5000/networks
```

**Response:**

```json
{
  "networks": [
    "..."
  ]
}
```

### `POST /interfaces`

Creates a new record.

**Request:**

```bash
curl -X POST http://localhost:5000/interfaces \
  -H "Content-Type: application/json" \
  -d '{
  "network_id": "abc-123",
  "region": "ashburn-va"
}'
```

**Response:**

```json
{
  "status": "ok"
}
```

### `POST /peers`

Creates a new record.

**Request:**

```bash
curl -X POST http://localhost:5000/peers \
  -H "Content-Type: application/json" \
  -d '{
  "interface_id": "abc-123",
  "public_key": "example_value",
  "name": "sip-endpoint"
}'
```

**Response:**

```json
{
  "status": "ok"
}
```

### `GET /interfaces/<iface_id>/config`

Returns config details.

**Request:**

```bash
curl http://localhost:5000/interfaces/example-id/config
```

**Response:**

```json
{
  "config": "...",
  "interface": "..."
}
```

### `GET /topology`

Handles `GET /topology`.

**Request:**

```bash
curl http://localhost:5000/topology
```

**Response:**

```json
{
  "status": "ok"
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
