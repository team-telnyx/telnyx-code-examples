# API Reference — WireGuard Private Voice Network

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/networks` | Create a new network. |
| `GET` | `/networks` | List networks. |
| `POST` | `/interfaces` | Create a new interface. |
| `POST` | `/peers` | Create a new peer. |
| `GET` | `/interfaces/<iface_id>/config` | Get config. |
| `GET` | `/topology` | Topology. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /networks`

Create a new network.

### Request

```json
{
  "name": "Jane Smith"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | no | Display name or label |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /networks`

List all networks.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /interfaces`

Create a new interface.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `network_id` | `string` | **yes** | Network id |
| `region` | `string` | no | Region |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /peers`

Create a new peer.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `interface_id` | `string` | **yes** | Interface id |
| `public_key` | `string` | **yes** | Public key |
| `name` | `string` | no | Display name or label |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /interfaces/<iface_id>/config`

Get a specific config by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /topology`

Topology.

### Response `200`

```json
{"networks": "...", "interfaces": "...",
        "details": {"networks": "..."), "interfaces": "...")}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "networks": "...",
  "interfaces": "..."
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
