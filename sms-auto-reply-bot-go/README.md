# SMS Autoresponder with Go and Gin

## What Does This Example Do?

Build a production-ready SMS autoresponder using Go and the Gin web framework. This tutorial demonstrates how to receive inbound SMS messages via webhooks, parse them, and send automatic replies using the Telnyx Go SDK. You'll learn webhook validation, concurrent message handling, and proper error recovery patterns for telecom applications.

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
- A publicly accessible URL (ngrok, Cloudflare Tunnel, or deployed server) for webhook delivery.
- Basic familiarity with Go and REST APIs.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-auto-reply-bot-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-auto-reply-bot-go
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `main.go` with the Gin server, webhook handler, and autoresponder logic:

```go
package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/telnyx/telnyx-go"
	"github.com/telnyx/telnyx-go/v2/messaging"
)

var client *telnyx.Client
var cfg *Config

func init() {
	cfg = LoadConfig()

	// Validate required configuration
	if cfg.TelnyxAPIKey == "" {
		log.Fatal("TELNYX_API_KEY environment variable not set")
	}
	if cfg.TelnyxPhoneNum == "" {
		log.Fatal("TELNYX_PHONE_NUMBER environment variable not set")
	}

	// Initialize Telnyx client with API key
	client = telnyx.NewClient(telnyx.WithAPIKey(cfg.TelnyxAPIKey))
}

// InboundMessage represents the webhook payload structure
type InboundMessage struct {
	Data struct {
		ID         string `json:"id"`
		Direction  string `json:"direction"`
		From       string `json:"from"`
		To         string `json:"to"`
		Text       string `json:"text"`
		ReceivedAt string `json:"received_at"`
	} `json:"data"`
	Meta struct {
		EventType string `json:"event_type"`
	} `json:"meta"`
}

// AutoresponseMessage represents the autoresponse payload
type AutoresponseMessage struct {
	MessageID string `json:"message_id"`
	From      string `json:"from"`
	To        string `json:"to"`
	Text      string `json:"text"`
	Status    string `json:"status"`
}

func main() {
	router := gin.Default()

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// Webhook endpoint for inbound SMS
	router.POST("/webhooks/sms", handleInboundSMS)

	// Start server
	addr := ":" + cfg.Port
	log.Printf("Starting SMS autoresponder on %s\n", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("Server error: %v\n", err)
	}
}

// handleInboundSMS processes inbound SMS and sends autoresponse
func handleInboundSMS(c *gin.Context) {
	var msg InboundMessage

	// Parse JSON payload
	if err := c.ShouldBindJSON(&msg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	// Only process received messages
	if msg.Meta.EventType != "message.received" {
		c.JSON(http.StatusOK, gin.H{"message": "Event type not processed"})
		return
	}

	// Validate sender phone number format
	if msg.Data.From == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing sender phone number"})
		return
	}

	// Log inbound message
	log.Printf("Inbound SMS from %s: %s\n", msg.Data.From, msg.Data.Text)

	// Send autoresponse asynchronously to avoid blocking webhook response
	go sendAutoresponse(msg.Data.From, msg.Data.Text)

	// Acknowledge webhook immediately
	c.JSON(http.StatusOK, gin.H{"status": "received"})
}

// sendAutoresponse sends an automatic reply to the sender
func sendAutoresponse(senderNumber, inboundText string) {
	// Build autoresponse message
	autoresponseText := fmt.Sprintf(
		"Thank you for your message: \"%s\". We'll get back to you shortly!",
		inboundText,
	)

	// Create message via Telnyx API
	params := &messaging.MessageCreateParams{
		From: cfg.TelnyxPhoneNum,
		To:   senderNumber,
		Text: autoresponseText,
	}

	response, err := client.Messages.Create(params)
	if err != nil {
		// Log error but don't crash — webhook already acknowledged
		logSendError(senderNumber, err)
		return
	}

	// Extract and log response data
	if response != nil && response.Data != nil {
		log.Printf(
			"Autoresponse sent: ID=%s, To=%s, Status=%s\n",
			response.Data.ID,
			senderNumber,
			response.Data.To[0].Status,
		)
	}
}

// logSendError logs API errors with appropriate context
func logSendError(recipient string, err error) {
	switch e := err.(type) {
	case *telnyx.AuthenticationError:
		log.Printf("Auth error sending to %s: invalid API key\n", recipient)
	case *telnyx.RateLimitError:
		log.Printf("Rate limit error sending to %s: slow down\n", recipient)
	case *telnyx.APIStatusError:
		log.Printf("API error sending to %s: status=%d, message=%s\n", recipient, e.Status, e.Message)
	case *telnyx.APIConnectionError:
		log.Printf("Connection error sending to %s: %v\n", recipient, e)
	default:
		log.Printf("Error sending autoresponse to %s: %v\n", recipient, err)
	}
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-auto-reply-bot-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not receiving messages | The `/webhooks/sms` endpoint is not being called when SMS arrives. | Verify the webhook URL in the Telnyx Portal matches your public URL exactly (e.g., `https://your-domain.com/webhooks/sms`). Ensure ngrok or your tunnel is running and the forwarding URL is correct. Check server logs with `go run main.go config.go` to see if requests arrive. If using ngrok, the URL changes each restart—update the portal configuration. |
| Authentication Error (401) | The autoresponder logs "Auth error: invalid API key" when sending replies. | Verify `TELNYX_API_KEY` in your `.env` file matches the key from the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the server after updating the `.env` file. If the key was recently regenerated, update the environment variable and restart. |
| Autoresponse not sent | Inbound messages are received but no autoresponse is sent; logs show no error. | Check that `TELNYX_PHONE_NUMBER` is set correctly in `.env` and is enabled for outbound SMS in the Telnyx Portal. Verify the sender's phone number is in valid E.164 format (starts with `+`). Check Telnyx Portal message logs to see if the outbound message was attempted. Ensure your Telnyx account has sufficient credits or an active payment method. |
| Port already in use | Server fails to start with "address already in use" error. | Change the `PORT` environment variable: `PORT=8081 go run main.go config.go`. Alternatively, kill the process using the port: `lsof -i :8080` (macOS/Linux) or `netstat -ano \| findstr :8080` (Windows), then terminate the process. |
| JSON parsing error | Webhook handler returns 400 "Invalid request body". | Verify the webhook payload is valid JSON. Check that the Telnyx Portal is sending the correct event structure. Test with the curl command in Step 4 to confirm the endpoint accepts the payload format. Enable Gin debug logging by setting `gin.SetMode(gin.DebugMode)` before creating the router. |

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

- [Receive SMS Webhooks with Go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/go/receive-sms-webhook).
- [Send Bulk SMS Messages with Go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/go/send-bulk-sms).
- [Implement Two-Factor Authentication with SMS](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/go/otp-2fa).
