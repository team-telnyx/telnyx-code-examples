# Receive SMS Webhook with Go and Gin

## What Does This Example Do?

Build a production-ready Gin endpoint that receives inbound SMS messages via Telnyx webhooks. This tutorial demonstrates webhook validation, proper error handling for telecom APIs, and secure credential management via environment variables. You'll configure a Messaging Profile to route inbound SMS to your endpoint and process incoming messages in real time.

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
- A Telnyx phone number enabled for inbound SMS.
- A publicly accessible URL (ngrok, Cloudflare Tunnel, or deployed server) to receive webhooks.
- Basic familiarity with Go and HTTP servers.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/receive-sms-webhook-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/receive-sms-webhook-go
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `main.go` and initialize the Telnyx client using the new pattern. Define a handler to process inbound SMS webhooks:

```go
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go"
	"github.com/telnyx/telnyx-go/option"
)

// WebhookPayload represents the structure of an inbound SMS webhook from Telnyx.
type WebhookPayload struct {
	Data struct {
		ID        string `json:"id"`
		Type      string `json:"type"`
		Direction string `json:"direction"`
		From      struct {
			PhoneNumber string `json:"phone_number"`
		} `json:"from"`
		To []struct {
			PhoneNumber string `json:"phone_number"`
		} `json:"to"`
		Text      string `json:"text"`
		Timestamp string `json:"received_at"`
	} `json:"data"`
}

// SMSMessage represents a processed inbound SMS for JSON response.
type SMSMessage struct {
	MessageID   string `json:"message_id"`
	From        string `json:"from"`
	To          string `json:"to"`
	Text        string `json:"text"`
	ReceivedAt  string `json:"received_at"`
	Direction   string `json:"direction"`
}

func init() {
	// Load environment variables from .env file
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using system environment variables")
	}
}

func main() {
	// Initialize Telnyx client with API key from environment
	apiKey := os.Getenv("TELNYX_API_KEY")
	if apiKey == "" {
		log.Fatal("TELNYX_API_KEY environment variable not set")
	}

	client := telnyx.NewClient(option.WithAPIKey(apiKey))
	_ = client // Client initialized for future use (e.g., sending replies)

	// Initialize Gin router
	router := gin.Default()

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// Webhook endpoint for inbound SMS
	router.POST("/webhooks/sms", handleSMSWebhook)

	// Start server
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting Gin server on port %s\n", port)
	if err := router.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

// handleSMSWebhook processes inbound SMS webhooks from Telnyx.
func handleSMSWebhook(c *gin.Context) {
	var payload WebhookPayload

	// Parse JSON request body
	if err := c.ShouldBindJSON(&payload); err != nil {
		log.Printf("Failed to parse webhook payload: %v\n", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON payload"})
		return
	}

	// Validate webhook contains message data
	if payload.Data.Type != "message.received" {
		log.Printf("Ignoring webhook event type: %s\n", payload.Data.Type)
		c.JSON(http.StatusOK, gin.H{"status": "ignored"})
		return
	}

	// Extract message details
	from := payload.Data.From.PhoneNumber
	to := ""
	if len(payload.Data.To) > 0 {
		to = payload.Data.To[0].PhoneNumber
	}
	text := payload.Data.Text
	timestamp := payload.Data.Timestamp

	// Log the inbound message
	log.Printf("Inbound SMS: From=%s, To=%s, Text=%s, Timestamp=%s\n", from, to, text, timestamp)

	// Build response object (JSON-serializable)
	message := SMSMessage{
		MessageID:  payload.Data.ID,
		From:       from,
		To:         to,
		Text:       text,
		ReceivedAt: timestamp,
		Direction:  payload.Data.Direction,
	}

	// Return 200 OK to acknowledge receipt
	c.JSON(http.StatusOK, gin.H{
		"status":  "received",
		"message": message,
	})
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not triggering | You send an SMS to your Telnyx number but the endpoint is never called. | Verify the **Inbound Webhook URL** is correctly configured in your Messaging Profile in the Telnyx Portal. Ensure the URL is publicly accessible (test with `curl` from another machine). If using ngrok, confirm the tunnel is still active and the URL in the Portal matches the current ngrok URL. Check your firewall and router settings to allow inbound HTTPS traffic on port 443. |
| Invalid JSON payload error | The endpoint returns `{"error": "Invalid JSON payload"}` with HTTP 400. | Verify the webhook request body is valid JSON. Use `c.ShouldBindJSON()` to parse the payload. Check the Telnyx webhook documentation to ensure your payload structure matches the expected format. Log the raw request body to debug: add `body, _ := io.ReadAll(c.Request.Body)` and `log.Printf("Raw body: %s\n", string(body))` before parsing. |
| Environment variable not set | The application exits with `TELNYX_API_KEY environment variable not set`. | Confirm your `.env` file exists in the same directory as `main.go` and contains the variable. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `godotenv.Load()` call must execute before `os.Getenv()` is called. Verify there are no trailing spaces or quotes around the API key value. |

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

- [Send a Single SMS with Go and Gin](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/go/send-single-sms).
- [Send Bulk SMS Messages with Go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/go/send-bulk-sms).
- [Implement Two-Factor Authentication with SMS](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/go/otp-2fa).
