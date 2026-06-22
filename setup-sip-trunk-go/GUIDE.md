# Set Up a SIP Trunk with Telnyx and Go

Create, list, and retrieve Telnyx SIP trunk connections via a Go and Gin REST API.

## How It Works

```
  HTTP Client (curl / PBX / SBC)
        │
        ▼
  ┌──────────────────────┐
  │ Gin REST API (:8080)  │
  │  /sip-connections     │
  └──────────┬───────────┘
             │  Telnyx Go SDK
             ▼
  ┌──────────────────────┐
  │ Telnyx SIP Trunking   │
  └──────────────────────┘
```

## Telnyx Products Used

- **SIP Trunking** — credential-based SIP connections that route calls over the Telnyx private network

## API Endpoints

- **Create Credential Connection**: `POST /v2/credential_connections` -- [API reference](https://developers.telnyx.com/api/connections/create-credential-connection)
- **List Credential Connections**: `GET /v2/credential_connections` -- [API reference](https://developers.telnyx.com/api/connections/list-connections)
- **Retrieve Credential Connection**: `GET /v2/credential_connections/{id}` -- [API reference](https://developers.telnyx.com/api/connections/retrieve-connection)

## Prerequisites

- Go 1.22+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)
- A publicly reachable IP or domain for your SIP endpoint (PBX/SBC) for call routing
- curl or Postman for testing HTTP endpoints

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/setup-sip-trunk-go
cp .env.example .env
go mod download
```

Edit `.env` and set `TELNYX_API_KEY`. You can optionally set `SIP_ENDPOINT_IP` and `SIP_ENDPOINT_PORT` defaults, though the SIP endpoint is passed per request when creating a connection.

## Step 2: Understand the Code

Everything lives in `main.go`. Here is what each piece does.

### Configuration & client

- **`LoadConfig()`** — calls `godotenv.Load()` and reads `TELNYX_API_KEY`, `SIP_ENDPOINT_IP`, and `SIP_ENDPOINT_PORT` from the environment into a `Config` struct.
- **`init()`** — loads config and, if `TELNYX_API_KEY` is empty, prints an error and exits. Otherwise it builds the Telnyx client with `telnyx.NewClient(option.WithAPIKey(...))`.

### Handlers

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| `POST` | `/sip-connections` | `createSIPConnection` | Create a SIP trunk |
| `GET` | `/sip-connections` | `listSIPConnections` | List all SIP trunks |
| `GET` | `/sip-connections/:id` | `getSIPConnection` | Retrieve one SIP trunk |
| `GET` | `/health` | inline | Liveness probe |

The create handler binds and validates the request, then calls the Telnyx SDK:

```go
func createSIPConnection(c *gin.Context) {
	var req CreateSIPConnectionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.SIPEndpointPort < 1 || req.SIPEndpointPort > 65535 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "SIP endpoint port must be between 1 and 65535"})
		return
	}

	params := telnyx.CredentialConnectionNewParams{
		ConnectionName: req.Name,
		UserName:       req.Username,
		Password:       req.Password,
	}
	// ... then client.CredentialConnections.New(context.Background(), params)
}
```

### Error mapping

- **`handleTelnyxError()`** — uses `errors.As` to match a `*telnyx.Error` and maps it to an HTTP status via its `StatusCode` field (e.g. 401 for an invalid key, 429 for rate limiting); anything else returns 500. Responses never leak raw exception internals.

## Step 3: Run It

```bash
go run .
```

The server starts on `http://localhost:8080` and prints `Starting SIP Trunking API on :8080`.

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:8080/health
```

**Create a SIP connection:**

```bash
curl -X POST http://localhost:8080/sip-connections \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My PBX Trunk",
    "username": "sip_user",
    "password": "s3cure_p@ss",
    "sip_endpoint_ip": "192.0.2.10",
    "sip_endpoint_port": 5060
  }'
```

Copy the `id` from the response, then list and retrieve:

```bash
curl http://localhost:8080/sip-connections
curl http://localhost:8080/sip-connections/<id>
```

## Going to Production

- **Authentication** — add API key or token validation in front of your endpoints
- **Secrets** — store `TELNYX_API_KEY` in a secret manager rather than a committed `.env`
- **Outbound voice profiles** — attach an outbound voice profile so the trunk can place outbound calls
- **Monitoring** — add structured logging and alert on the `/health` probe
- **Rate limiting** — protect your endpoints from abuse

## Run

```bash
go mod download
go run .
```

## Resources

- [Source code and reference](./README.md)
- [Typed API reference](./API.md)
- [SIP Trunking Get Started](https://developers.telnyx.com/docs/voice/sip-trunking/get-started)
- [Go SDK](https://developers.telnyx.com/development/sdk/go)
- [Telnyx Portal](https://portal.telnyx.com)
