# SMS Notifications with Go and Gin

## What Does This Example Do?

Build a production-ready Gin web service that sends SMS notifications using the Telnyx Go SDK. This tutorial demonstrates how to create a scalable notification system with proper error handling, request validation, and secure credential management. You'll learn to send SMS messages to multiple recipients, handle rate limiting, and implement idiomatic Go patterns with the Gin framework.

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
- A Telnyx phone number enabled for outbound SMS.
- Basic familiarity with Go and REST APIs.
- `curl` or similar tool for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-sms-notifications-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `notification.go` to define the notification service and request/response types:

```go
package main

import (
	"fmt"

	"github.com/team-telnyx/telnyx-go/v4/v2"
	"github.com/team-telnyx/telnyx-go/v4/v2/messaging"
)

// NotificationRequest represents an incoming SMS notification request.
type NotificationRequest struct {
	To       string `json:"to" binding:"required"`
	Message  string `json:"message" binding:"required"`
	MediaURL string `json:"media_url"`
}

// NotificationResponse represents the response after sending a notification.
type NotificationResponse struct {
	MessageID string `json:"message_id"`
	Status    string `json:"status"`
	From      string `json:"from"`
	To        string `json:"to"`
}

// NotificationService handles SMS sending logic.
type NotificationService struct {
	client        *telnyx.Client
	fromNumber    string
}

// NewNotificationService creates a new notification service instance.
func NewNotificationService(apiKey, fromNumber string) *NotificationService {
	client := telnyx.NewClient(telnyx.WithAPIKey(apiKey))
	return &NotificationService{
		client:     client,
		fromNumber: fromNumber,
	}
}

// SendNotification sends an SMS notification and returns the response.
func (ns *NotificationService) SendNotification(req *NotificationRequest) (*NotificationResponse, error) {
	// Validate E.164 format to prevent API errors.
	if len(req.To) == 0 || req.To[0] != '+' {
		return nil, fmt.Errorf("phone number must be in E.164 format (e.g., +15551234567)")
	}

	// Build the message creation request.
	createReq := &messaging.CreateMessageRequest{
		From: ns.fromNumber,
		To:   req.To,
		Text: req.Message,
	}

	// Add media URLs if provided (for MMS).
	if req.MediaURL != "" {
		createReq.MediaURLs = []string{req.MediaURL}
	}

	// Send the message via Telnyx API.
	response, err := ns.client.Messaging.CreateMessage(createReq)
	if err != nil {
		return nil, err
	}

	// Extract serializable data from the response.
	status := "unknown"
	if response.Data != nil && len(response.Data.To) > 0 {
		status = response.Data.To[0].Status
	}

	return &NotificationResponse{
		MessageID: response.Data.ID,
		Status:    status,
		From:      ns.fromNumber,
		To:        req.To,
	}, nil
}
```

Create `main.go` to set up the Gin server with routes and error handling:

```go
package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/team-telnyx/telnyx-go/v4/v2"
)

func main() {
	// Load configuration from environment.
	config, err := LoadConfig()
	if err != nil {
		panic(err)
	}

	// Initialize the notification service.
	notificationService := NewNotificationService(config.TelnyxAPIKey, config.TelnyxPhoneNum)

	// Create Gin router.
	router := gin.Default()

	// Register routes.
	router.POST("/notifications/send", func(c *gin.Context) {
		sendNotificationHandler(c, notificationService)
	})

	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy"})
	})

	// Start the server.
	router.Run(":" + config.Port)
}

// sendNotificationHandler handles incoming SMS notification requests.
func sendNotificationHandler(c *gin.Context, service *NotificationService) {
	var req NotificationRequest

	// Parse and validate the JSON request body.
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body: " + err.Error()})
		return
	}

	// Send the notification.
	response, err := service.SendNotification(&req)

	// Handle Telnyx API errors with appropriate HTTP status codes.
	if err != nil {
		switch err.(type) {
		case *telnyx.AuthenticationError:
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
		case *telnyx.RateLimitError:
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded. Please slow down."})
		case *telnyx.APIStatusError:
			apiErr := err.(*telnyx.APIStatusError)
			c.JSON(apiErr.StatusCode, gin.H{"error": err.Error(), "status_code": apiErr.StatusCode})
		case *telnyx.APIConnectionError:
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
		default:
			// Handle validation errors and other issues.
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		}
		return
	}

	// Return the successful response.
	c.JSON(http.StatusOK, response)
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-notifications-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Gin server. |
| Invalid Phone Number Format | You receive a 400 error stating "phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Environment Variable Not Set | The application panics with `TELNYX_API_KEY environment variable not set` on startup. | Confirm your `.env` file exists in the same directory as `main.go` and contains the variable. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `godotenv.Load()` call must execute before `os.Getenv()` is called—verify this import order in your code. |
| Port Already in Use | The server fails to start with "address already in use" error. | Change the `PORT` environment variable to an available port (e.g., `PORT=8081`) or kill the process using port 8080. On Linux/macOS, use `lsof -i :8080` to find the process ID and `kill -9 <PID>` to terminate it. |
| Missing Dependencies | Running `go run` produces "cannot find package" errors. | Ensure all dependencies are installed by running `go mod tidy` and `go get ./...`. Verify your `go.mod` file contains the required packages: `github.com/gin-gonic/gin`, `github.com/team-telnyx/telnyx-go/v4/v2`, and `github.com/joho/godotenv`. |

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
