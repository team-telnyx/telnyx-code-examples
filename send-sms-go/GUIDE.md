# Send Your First SMS with Telnyx and Go

Send an SMS message using the Telnyx Messaging API and Go SDK, exposed over a Gin HTTP endpoint.

## How It Works

```
  POST /sms/send  (Gin)
        │
        ▼
  ┌────────────────────┐
  │ SendSMS() helper    │
  │ - validate E.164    │
  │ - read from-number  │
  └─────────┬──────────┘
            │  Messages.Send
            ▼
  ┌────────────────────┐
  │ Telnyx Messaging    │
  └─────────┬──────────┘
            │
            └──► SMS delivered to recipient
```

## Telnyx Products Used

- **Messaging** — send and receive messages with delivery receipts

## API Endpoints

- **Send Message**: `POST /v2/messages` (via `client.Messages.Send`) -- [API reference](https://developers.telnyx.com/api/messaging/send-message)

## Prerequisites

- Go 1.22+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) with messaging enabled

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-sms-go
cp .env.example .env
go mod download
```

Edit `.env` with your Telnyx credentials:

```
TELNYX_API_KEY=KEY_your_telnyx_api_key_here
TELNYX_PHONE_NUMBER=+15551234567
```

## Step 2: Understand the Code

Everything lives in `main.go`. Here is what each piece does.

### Initialize the client

`initTelnyxClient()` reads `TELNYX_API_KEY` from the environment and builds the SDK client with the current option-based pattern:

```go
func initTelnyxClient() *telnyx.Client {
	apiKey := os.Getenv("TELNYX_API_KEY")
	client := telnyx.NewClient(option.WithAPIKey(apiKey))
	return &client
}
```

### Send helper

`SendSMS()` reads the from-number, validates that the destination is E.164, builds `MessageSendParams`, and calls the API. It returns a plain map because the SDK response object is not JSON-serializable:

```go
func SendSMS(client *telnyx.Client, toNumber string, message string) (map[string]interface{}, error) {
	fromNumber := os.Getenv("TELNYX_PHONE_NUMBER")
	if fromNumber == "" {
		return nil, fmt.Errorf("TELNYX_PHONE_NUMBER environment variable not set")
	}

	if !strings.HasPrefix(toNumber, "+") {
		return nil, fmt.Errorf("phone number must be in E.164 format (e.g., +15551234567)")
	}

	params := telnyx.MessageSendParams{
		To:   toNumber,
		From: telnyx.String(fromNumber),
		Text: telnyx.String(message),
	}

	response, err := client.Messages.Send(context.Background(), params)
	// ... extract message_id, status, from, to into a map
}
```

### HTTP endpoint

`main()` loads `.env` with `godotenv.Load()`, creates a Gin router, and registers `POST /sms/send`. The handler binds the JSON body (`to` and `message` are both `binding:"required"`), calls `SendSMS`, and maps errors to HTTP status codes. Telnyx API failures surface as `*telnyx.Error`, matched with `errors.As`; the handler returns the error's `StatusCode`:

| Error | Status |
|-------|--------|
| `*telnyx.Error` (any Telnyx API error) | the error's `StatusCode` (e.g. `401`, `429`) |
| anything else (validation) | `400` |

The server listens on `:5000`.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/sms/send` | Send a single SMS |

## Step 3: Run It

```bash
go run .
```

The server starts on `http://localhost:5000`.

## Step 4: Test It

Send a message:

```bash
curl -X POST http://localhost:5000/sms/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+12125559999",
    "message": "Hello from Telnyx and Go"
  }'
```

A successful call returns the message ID, status, and the from/to numbers.

## Going to Production

- **Authentication** — add API key or token validation on your endpoint
- **Structured logging** — replace Gin's default logger with structured logs and request IDs
- **Rate limiting** — protect the endpoint from abuse
- **Retries** — retry on `429` and `503` responses with backoff
- **Monitoring** — track send success rate and add alerting

## Run

```bash
go mod download
go run .
```

## Resources

- [Source code and reference](./README.md)
- [Typed endpoint reference](./API.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Messaging quickstart](https://developers.telnyx.com/docs/messaging)
- [Go SDK](https://developers.telnyx.com/development/sdk/go)
- [Telnyx Portal](https://portal.telnyx.com)
