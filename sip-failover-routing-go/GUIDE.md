# Failover Routing with Go and Gin

Build a production-ready SIP failover routing system using Go and Gin that automatically routes inbound calls to primary and backup SIP endpoints.

## How It Works

```
  Client request
        │
        ▼
  ┌────────────────────┐
  │  Go Server          │  receives request
  └─────────┬──────────┘
        │  Telnyx API call
        ▼
  ┌────────────────────┐
  │  Telnyx SIP Trunking│  processes and responds
  └────────────────────┘
```

## Telnyx Products Used

- **SIP Trunking** — [Documentation](https://developers.telnyx.com/docs/sip-trunking)

## Prerequisites

- Go 1.19 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- At least two Telnyx phone numbers in E.164 format for testing.
- A SIP PBX or softphone (Asterisk, FreeSWITCH, 3CX, or Zoiper) for receiving calls.
- Two SIP endpoints (primary and backup) with valid IP addresses or FQDNs.
- `curl` or Postman for testing HTTP endpoints.
- Basic understanding of SIP protocol and call routing concepts.

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-failover-routing-go
cp .env.example .env
go mod tidy
```

Edit `.env` with your Telnyx credentials:

| Variable | Description |
|----------|-------------|
| `TELNYX_API_KEY` | KEY_your_telnyx_api_key_here |
| `BACKUP_SIP_IP` | your_backup_sip_ip_here |
| `PRIMARY_SIP_IP` | your_primary_sip_ip_here |
| `TELNYX_PHONE_NUMBER` | +15551234567 |

## Step 2: Understand the Code

The main application logic lives in `main.go`.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/sip/connections` | API endpoint |
| `GET` | `/sip/connections/:id` | API endpoint |
| `POST` | `/sip/failover` | API endpoint |
| `POST` | `/sip/failback` | API endpoint |
| `GET` | `/sip/status` | API endpoint |

## Step 3: Run It

```bash
go run main.go
```

The server starts on `http://localhost:5000`.

For webhook-based features, expose your local server:

```bash
ngrok http 5000
```

## Step 4: Test It

```bash
curl http://localhost:5000/sip/connections
```

## Going to Production

- **Environment variables** — never commit API keys; use a secrets manager.
- **Authentication** — protect your endpoints with API key validation.
- **Monitoring** — add structured logging and alerting.
- **Rate limiting** — protect endpoints from abuse.
- **Database** — replace any in-memory storage with a persistent store.

## Resources

- [Source code](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-failover-routing-go/README.md)
- [API reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-failover-routing-go/API.md)
- [SIP Trunking Documentation](https://developers.telnyx.com/docs/sip-trunking)
- [Telnyx Portal](https://portal.telnyx.com)
