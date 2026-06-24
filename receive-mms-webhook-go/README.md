# MMS Receive with Go and Gin

## What Does This Example Do?

Build a production-ready Gin webhook endpoint that receives inbound MMS messages from the Telnyx SMS/MMS API. This tutorial demonstrates webhook validation, secure credential management, and proper error handling for telecom events. You'll configure a Messaging Profile with a webhook URL, validate incoming requests, and extract media attachments from MMS messages.

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
- A Telnyx phone number enabled for inbound SMS/MMS.
- A publicly accessible URL (ngrok, Cloudflare Tunnel, or deployed server) to receive webhooks.
- Basic familiarity with Go and REST APIs.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/receive-mms-webhook-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `main.go` and implement the webhook receiver with proper validation and error handling:

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
	"github.com/team-telnyx/telnyx-go/v4"
	"github.com/team-telnyx/telnyx-go/v4/v2/client"
)

// WebhookPayload represents the structure of an inbound message webhook.
type WebhookPayload struct {
	Data struct {
		ID         string `json:"id"`
		Type       string `json:"type"`
		Direction  string `json:"direction"`
		From       string `json:"from"`
		To         string `json:"to"`
		Text       string `json:"text"`
		MediaURLs  []string `json:"media_urls"`
		ReceivedAt string `json:"received_at"`
	} `json:"data"`
}

// MessageResponse is the JSON-serializable response for received messages.
type MessageResponse struct {
	MessageID  string   `json:"message_id"`
	From       string   `json:"from"`
	To         string   `json:"to"`
	Text       string   `json:"text"`
	MediaURLs  []string `json:"media_urls"`
	ReceivedAt string   `json:"received_at"`
}

func init() {
	// Load environment variables from .env file
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using system environment variables")
	}
}

func main() {
	// Initialize Gin router
	router := gin.Default()

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// Webhook endpoint for inbound messages
	router.POST("/webhooks/message", handleInboundMessage)

	// Global error handler for unhandled exceptions
	router.Use(errorHandler())

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting server on port %s\n", port)
	if err := router.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

// handleInboundMessage processes inbound MMS/SMS webhooks from Telnyx.
func handleInboundMessage(c *gin.Context) {
	var payload WebhookPayload

	// Parse JSON request body
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON payload"})
		return
	}

	// Validate webhook payload structure
	if payload.Data.ID == "" || payload.Data.Type == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required fields in webhook payload"})
		return
	}

	// Only process inbound messages
	if payload.Data.Direction != "inbound" {
		c.JSON(http.StatusOK, gin.H{"message": "Ignoring non-inbound message"})
		return
	}

	// Log the received message
	log.Printf("Received message ID: %s from %s to %s\n", payload.Data.ID, payload.Data.From, payload.Data.To)

	// If MMS (has media), log media URLs
	if len(payload.Data.MediaURLs) > 0 {
		log.Printf("MMS detected with %d media attachment(s)\n", len(payload.Data.MediaURLs))
		for i, url := range payload.Data.MediaURLs {
			log.Printf("  Media %d: %s\n", i+1, url)
		}
	}

	// Build response with extracted data
	response := MessageResponse{
		MessageID:  payload.Data.ID,
		From:       payload.Data.From,
		To:         payload.Data.To,
		Text:       payload.Data.Text,
		MediaURLs:  payload.Data.MediaURLs,
		ReceivedAt: payload.Data.ReceivedAt,
	}

	// Return 200 OK to acknowledge receipt (Telnyx expects this)
	c.JSON(http.StatusOK, response)
}

// errorHandler returns a Gin middleware for global error handling.
func errorHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()

		// Check if an error occurred during request processing
		if len(c.Errors) > 0 {
			err := c.Errors.Last().Err

			// Map Telnyx SDK errors to HTTP status codes
			switch err.(type) {
			case *telnyx.AuthenticationError:
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
			case *telnyx.RateLimitError:
				c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded"})
			case *telnyx.APIStatusError:
				apiErr := err.(*telnyx.APIStatusError)
				c.JSON(apiErr.StatusCode, gin.H{"error": apiErr.Error()})
			case *telnyx.APIConnectionError:
				c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
			default:
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
			}
		}
	}
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-mms-webhook-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not triggering | You send an MMS to your Telnyx number but the webhook endpoint is never called. | Verify the webhook URL in your Messaging Profile is publicly accessible and uses HTTPS. Test with ngrok: `ngrok http 8080` and update the webhook URL to the ngrok HTTPS URL. Ensure the Messaging Profile is assigned to the phone number receiving the MMS. Check Telnyx Portal logs under **Messaging > Logs** to see if the message was received. |
| Invalid JSON payload error | The endpoint returns `{"error": "Invalid JSON payload"}` when testing with curl. | Ensure the `-H "Content-Type: application/json"` header is included in your curl request. Verify the JSON structure matches the `WebhookPayload` struct exactly—check for typos in field names like `media_urls` (snake_case, not camelCase). Use a JSON validator tool to confirm the payload is valid JSON. |
| Media URLs are empty | MMS messages are received but `media_urls` is always an empty array. | Confirm the MMS was sent with actual media attachments (images, videos, etc.), not just text. Check the Telnyx Portal message logs to verify the MMS included media. Ensure your Messaging Profile is configured to receive MMS (not SMS-only). Some carriers may strip media in transit—test with a different carrier or device if possible. |
| Port already in use | The server fails to start with error `address already in use`. | Change the `PORT` environment variable in `.env` to an unused port (e.g., `8081`). Alternatively, kill the process using the current port: `lsof -i :8080` and `kill -9 <PID>`. On Windows, use `netstat -ano \| findstr :8080` and `taskkill /PID <PID> /F`. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

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
