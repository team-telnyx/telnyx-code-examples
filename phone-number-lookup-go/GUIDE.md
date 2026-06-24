# Number Lookup with Go and Gin

Build a production-ready Gin endpoint that performs number lookup queries using the Telnyx SMS API.

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
  │  Telnyx Phone Numbers│  processes and responds
  └────────────────────┘
```

## Telnyx Products Used

- **Phone Numbers** — [Documentation](https://developers.telnyx.com/docs/numbers)

## Prerequisites

- Go 1.19 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- The Gin web framework and Telnyx Go SDK installed.
- curl or Postman for testing HTTP endpoints.

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/phone-number-lookup-go
cp .env.example .env
go mod tidy
```

Edit `.env` with your Telnyx credentials:

| Variable | Description |
|----------|-------------|
| `TELNYX_API_KEY` | KEY_your_telnyx_api_key_here |
| `PORT` | 5000 |

## Step 2: Understand the Code

The main application logic lives in `main.go`.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/lookup` | API endpoint |

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
curl -X POST http://localhost:5000/lookup \
  -H "Content-Type: application/json" \
  -d '{"to": "+15551234567"}'
```

## Going to Production

- **Environment variables** — never commit API keys; use a secrets manager.
- **Authentication** — protect your endpoints with API key validation.
- **Monitoring** — add structured logging and alerting.
- **Rate limiting** — protect endpoints from abuse.
- **Database** — replace any in-memory storage with a persistent store.

## Resources

- [Source code](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/phone-number-lookup-go/README.md)
- [API reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/phone-number-lookup-go/API.md)
- [Phone Numbers Documentation](https://developers.telnyx.com/docs/numbers)
- [Telnyx Portal](https://portal.telnyx.com)
