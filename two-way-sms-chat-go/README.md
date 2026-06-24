# Two Way SMS with Go and Gin

## What Does This Example Do?

Build a production-ready Gin web service that sends and receives SMS messages using the Telnyx Go SDK. This tutorial demonstrates bidirectional SMS communication: outbound message delivery via HTTP endpoints and inbound message handling through webhooks. You'll learn proper error handling for telecom APIs, secure credential management, and webhook signature validation for production resilience.

## Who Is This For?

- **Go developers** building sms features with Gin.
- **Backend engineers** integrating telephony or messaging into existing applications.
- **DevOps teams** looking for containerized, production-ready telecom examples.
- **Startups and enterprises** replacing legacy telecom providers with a modern API-first platform.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform that gives developers a single API for [voice](https://telnyx.com/products/voice-ai-agents), [messaging](https://telnyx.com/products/sms-api), [SIP](https://telnyx.com/products/sip-trunks), [AI](https://telnyx.com/ai-assistants), and [IoT](https://telnyx.com/products/iot-sim-card) — no Frankenstack required.

- **Integrated platform** — [Voice](https://telnyx.com/products/voice-ai-agents), [SMS](https://telnyx.com/products/sms-api), [SIP trunking](https://telnyx.com/products/sip-trunks), [AI assistants](https://telnyx.com/ai-assistants), and [IoT SIM management](https://telnyx.com/products/iot-sim-card) under one roof. No stitching together multiple vendors.
- **Global private network** — Calls and messages traverse the Telnyx-owned IP network for lower latency and higher reliability than the public internet.
- **Developer-first** — SDKs for Python, Node.js, Go, Ruby, Java, and PHP. Comprehensive webhook event model. Sandbox environment for testing.
- **Competitive pricing** — Pay-as-you-go with no minimums, contracts, or per-seat fees.

## Prerequisites

- Go 1.19 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for inbound and outbound SMS.
- A publicly accessible URL for webhook delivery (ngrok, Cloudflare Tunnel, or deployed server).
- Basic familiarity with Go and REST APIs.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/two-way-sms-chat-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/two-way-sms-chat-go
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `handlers.go` to define request/response types and implement the send and receive handlers:

```go
package main

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/telnyx/telnyx-go/v2"
)

// SendSMSRequest represents the JSON payload for sending SMS.
type SendSMSRequest struct {
	To      string `json:"to" binding:"required"`
	Message string `json:"message" binding:"required"`
}

// SendSMSResponse represents the JSON response after sending SMS.
type SendSMSResponse struct {
	MessageID string `json:"message_id"`
	Status    string `json:"status"`
	From      string `json:"from"`
	To        string `json:"to"`
}

// InboundSMSEvent represents a webhook payload for inbound SMS.
type InboundSMSEvent struct {
	Data struct {
		ID        string `json:"id"`
		Direction string `json:"direction"`
		From      struct {
			PhoneNumber string `json:"phone_number"`
		} `json:"from"`
		To []struct {
			PhoneNumber string `json:"phone_number"`
		} `json:"to"`
		Text string `json:"text"`
	} `json:"data"`
}

// SendSMS sends an outbound SMS message via Telnyx.
func SendSMS(toNumber, message string) (*SendSMSResponse, error) {
	// Validate E.164 format to prevent API errors.
	if !strings.HasPrefix(toNumber, "+") {
		return nil, fmt.Errorf("phone number must be in E.164 format (e.g., +15551234567)")
	}

	// Create message via Telnyx API.
	params := &telnyx.MessageCreateParams{
		From: telnyx.String(config.TelnyxPhoneNum),
		To:   telnyx.String(toNumber),
		Text: telnyx.String(message),
	}

	response, err := client.Messages.Create(params)
	if err != nil {
		return nil, err
	}

	// Extract serializable data from SDK response.
	status := "unknown"
	if response.Data != nil && len(response.Data.To) > 0 {
		status = response.Data.To[0].Status
	}

	return &SendSMSResponse{
		MessageID: response.Data.ID,
		Status:    status,
		From:      config.TelnyxPhoneNum,
		To:        toNumber,
	}, nil
}

// SendSMSHandler handles POST /sms/send requests.
func SendSMSHandler(c *gin.Context) {
	var req SendSMSRequest

	// Bind and validate JSON request body.
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required fields: 'to' and 'message'"})
		return
	}

	// Call SendSMS helper function.
	result, err := SendSMS(req.To, req.Message)

	// Handle Telnyx SDK errors with appropriate HTTP status codes.
	if err != nil {
		switch err.(type) {
		case *telnyx.AuthenticationError:
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
			return
		case *telnyx.RateLimitError:
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded. Please slow down."})
			return
		case *telnyx.APIStatusError:
			apiErr := err.(*telnyx.APIStatusError)
			c.JSON(apiErr.StatusCode, gin.H{"error": apiErr.Error(), "status_code": apiErr.StatusCode})
			return
		case *telnyx.APIConnectionError:
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
			return
		default:
			// Handle validation errors (E.164 format, etc.)
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}

	c.JSON(http.StatusOK, result)
}

// ReceiveSMSHandler handles POST /webhooks/sms requests for inbound messages.
func ReceiveSMSHandler(c *gin.Context) {
	var event InboundSMSEvent

	// Bind webhook payload.
	if err := c.ShouldBindJSON(&event); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	// Log inbound message details (in production, store in database).
	fmt.Printf("Inbound SMS received:\n")
	fmt.Printf("  Message ID: %s\n", event.Data.ID)
	fmt.Printf("  From: %s\n", event.Data.From.PhoneNumber)
	if len(event.Data.To) > 0 {
		fmt.Printf("  To: %s\n", event.Data.To[0].PhoneNumber)
	}
	fmt.Printf("  Text: %s\n", event.Data.Text)

	// Acknowledge webhook receipt with 200 OK.
	c.JSON(http.StatusOK, gin.H{"status": "received"})
}
```

Create `main.go` to set up the Gin router and start the server:

```go
package main

import (
	"fmt"

	"github.com/gin-gonic/gin"
)

func main() {
	// Create Gin router with default middleware.
	router := gin.Default()

	// Define routes.
	router.POST("/sms/send", SendSMSHandler)
	router.POST("/webhooks/sms", ReceiveSMSHandler)

	// Health check endpoint.
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Start server.
	fmt.Printf("Starting Telnyx two-way SMS server on port %s\n", config.Port)
	if err := router.Run(":" + config.Port); err != nil {
		panic(err)
	}
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/two-way-sms-chat-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Go server. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Webhook Not Receiving Inbound Messages | The `/webhooks/sms` endpoint is not being called when SMS arrives at your Telnyx number. | Verify that your Messaging Profile in the [Telnyx Portal](https://portal.telnyx.com) has the webhook URL configured correctly. Use ngrok or a public URL (not localhost). Ensure the URL is accessible from the internet and returns HTTP 200. Check your server logs for incoming POST requests. |
| Environment Variable Not Set | The application panics with "TELNYX_API_KEY environment variable not set" on startup. | Confirm your `.env` file exists in the same directory as your Go source files and contains the variable. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `godotenv.Load()` call must execute before `os.Getenv()` is called—verify this import order in your code. |
| Port Already in Use | The server fails to start with "address already in use" error. | Change the `PORT` environment variable to an available port (e.g., `PORT=8081`) or kill the process using the current port. On Linux/macOS, use `lsof -i :8080` to find the process ID and `kill -9 <PID>` to terminate it. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What Go version do I need?**

Go 1.22 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Go SDK](https://developers.telnyx.com/development/sdk/go)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)

## Related Examples

- [Send Bulk SMS Messages](/tutorials/sms/go/send-bulk-sms).
- [Implement Two-Factor Authentication with SMS](/tutorials/sms/go/otp-2fa).
- [Build an SMS Survey Application](/tutorials/sms/go/sms-survey).
