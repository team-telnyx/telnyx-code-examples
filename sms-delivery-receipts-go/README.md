# Delivery Receipts with Go and Gin

## What Does This Example Do?

Build a production-ready Gin application that receives and processes SMS delivery receipts from Telnyx. This tutorial demonstrates webhook handling, message status tracking, and proper error handling for telecom APIs. You'll set up an endpoint to receive delivery status updates and store them for monitoring outbound SMS campaigns.

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
- A publicly accessible URL (ngrok, Cloudflare Tunnel, or deployed server) to receive webhooks.
- Basic familiarity with Go and REST APIs.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-delivery-receipts-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-delivery-receipts-go
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `models.go` to define the webhook payload structure:

```go
package main

// WebhookPayload represents the structure of a Telnyx webhook event.
type WebhookPayload struct {
	Data struct {
		ID         string `json:"id"`
		Type       string `json:"type"`
		Attributes struct {
			ID        string `json:"id"`
			Direction string `json:"direction"`
			From      struct {
				PhoneNumber string `json:"phone_number"`
			} `json:"from"`
			To []struct {
				PhoneNumber string `json:"phone_number"`
				Status      string `json:"status"`
			} `json:"to"`
			Text      string `json:"text"`
			CreatedAt string `json:"created_at"`
			UpdatedAt string `json:"updated_at"`
		} `json:"attributes"`
	} `json:"data"`
}

// MessageStatus represents a stored delivery receipt.
type MessageStatus struct {
	MessageID   string `json:"message_id"`
	Direction   string `json:"direction"`
	From        string `json:"from"`
	To          string `json:"to"`
	Status      string `json:"status"`
	Text        string `json:"text"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}
```

Create `storage.go` to manage in-memory message status storage:

```go
package main

import "sync"

// MessageStore holds delivery receipts in memory.
// In production, use a database like PostgreSQL or MongoDB.
type MessageStore struct {
	mu       sync.RWMutex
	messages map[string]*MessageStatus
}

func NewMessageStore() *MessageStore {
	return &MessageStore{
		messages: make(map[string]*MessageStatus),
	}
}

func (s *MessageStore) Save(status *MessageStatus) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.messages[status.MessageID] = status
}

func (s *MessageStore) Get(messageID string) *MessageStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.messages[messageID]
}

func (s *MessageStore) List() []*MessageStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()

	statuses := make([]*MessageStatus, 0, len(s.messages))
	for _, status := range s.messages {
		statuses = append(statuses, status)
	}
	return statuses
}
```

Create `handlers.go` to define the webhook and status endpoints:

```go
package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/telnyx/telnyx-go/v2"
)

type Handlers struct {
	store  *MessageStore
	client *telnyx.Client
	config *Config
}

func NewHandlers(store *MessageStore, client *telnyx.Client, config *Config) *Handlers {
	return &Handlers{
		store:  store,
		client: client,
		config: config,
	}
}

// HandleWebhook processes incoming delivery receipt webhooks from Telnyx.
func (h *Handlers) HandleWebhook(c *gin.Context) {
	var payload WebhookPayload

	// Parse the incoming JSON webhook payload.
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	// Extract message status from the webhook data.
	messageID := payload.Data.Attributes.ID
	direction := payload.Data.Attributes.Direction
	from := payload.Data.Attributes.From.PhoneNumber
	text := payload.Data.Attributes.Text
	createdAt := payload.Data.Attributes.CreatedAt
	updatedAt := payload.Data.Attributes.UpdatedAt

	// Handle the "to" field which is an array.
	var to string
	var status string
	if len(payload.Data.Attributes.To) > 0 {
		to = payload.Data.Attributes.To[0].PhoneNumber
		status = payload.Data.Attributes.To[0].Status
	}

	// Store the delivery receipt.
	messageStatus := &MessageStatus{
		MessageID: messageID,
		Direction: direction,
		From:      from,
		To:        to,
		Status:    status,
		Text:      text,
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}

	h.store.Save(messageStatus)

	// Return 200 OK to acknowledge receipt of the webhook.
	c.JSON(http.StatusOK, gin.H{"status": "received"})
}

// HandleGetStatus retrieves the delivery status of a specific message.
func (h *Handlers) HandleGetStatus(c *gin.Context) {
	messageID := c.Param("message_id")

	if messageID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "message_id parameter required"})
		return
	}

	status := h.store.Get(messageID)
	if status == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Message not found"})
		return
	}

	c.JSON(http.StatusOK, status)
}

// HandleListStatuses retrieves all stored delivery statuses.
func (h *Handlers) HandleListStatuses(c *gin.Context) {
	statuses := h.store.List()

	// Convert to JSON-serializable format.
	items := make([]map[string]interface{}, len(statuses))
	for i, status := range statuses {
		items[i] = map[string]interface{}{
			"message_id": status.MessageID,
			"direction":  status.Direction,
			"from":       status.From,
			"to":         status.To,
			"status":     status.Status,
			"text":       status.Text,
			"created_at": status.CreatedAt,
			"updated_at": status.UpdatedAt,
		}
	}

	c.JSON(http.StatusOK, items)
}

// HandleSendSMS sends an SMS and returns the message ID for tracking.
func (h *Handlers) HandleSendSMS(c *gin.Context) {
	var req struct {
		To      string `json:"to" binding:"required"`
		Message string `json:"message" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required fields: 'to' and 'message'"})
		return
	}

	// Validate E.164 format.
	if len(req.To) == 0 || req.To[0] != '+' {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Phone number must be in E.164 format (e.g., +15551234567)"})
		return
	}

	// Send the message via Telnyx API.
	response, err := h.client.Messages.Create(c.Request.Context(), &telnyx.MessageCreateParams{
		From: telnyx.String(h.config.PhoneNumber),
		To:   telnyx.String(req.To),
		Text: telnyx.String(req.Message),
	})

	if err != nil {
		// Handle Telnyx-specific errors.
		switch err.(type) {
		case *telnyx.AuthenticationError:
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
		case *telnyx.RateLimitError:
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded. Please slow down."})
		case *telnyx.APIStatusError:
			apiErr := err.(*telnyx.APIStatusError)
			c.JSON(apiErr.StatusCode, gin.H{"error": apiErr.Error(), "status_code": apiErr.StatusCode})
		case *telnyx.APIConnectionError:
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to send message"})
		}
		return
	}

	// Extract and return serializable response data.
	messageID := ""
	status := "unknown"
	if response.Data != nil {
		messageID = response.Data.ID
		if len(response.Data.To) > 0 {
			status = response.Data.To[0].Status
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"message_id": messageID,
		"status":     status,
		"from":       h.config.PhoneNumber,
		"to":         req.To,
	})
}
```

Create `main.go` to set up the Gin router and start the server:

```go
package main

import (
	"fmt"
	"log"

	"github.com/gin-gonic/gin"
)

func main() {
	// Load configuration from environment variables.
	config, err := LoadConfig()
	if err != nil {
		log.Fatalf("Configuration error: %v", err)
	}

	// Initialize Telnyx client.
	client := NewTelnyxClient(config.APIKey)

	// Initialize message store and handlers.
	store := NewMessageStore()
	handlers := NewHandlers(store, client, config)

	// Create Gin router.
	router := gin.Default()

	// Define routes.
	router.POST("/webhooks/message-status", handlers.HandleWebhook)
	router.GET("/messages/:message_id", handlers.HandleGetStatus)
	router.GET("/messages", handlers.HandleListStatuses)
	router.POST("/sms/send", handlers.HandleSendSMS)

	// Start the server.
	port := ":8080"
	fmt.Printf("Server running on http://localhost%s\n", port)
	if err := router.Run(port); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-delivery-receipts-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not receiving events | The `/webhooks/message-status` endpoint is not being called by Telnyx. | Verify that your ngrok URL is correctly configured in the Telnyx Portal under Messaging Profiles. Ensure the webhook URL in your `.env` file matches the URL you registered in the portal. Check that your local server is running and ngrok is active. Use `ngrok web` to inspect incoming requests. |
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the server. |
| Message status not found | Calling `GET /messages/{message_id}` returns `{"error": "Message not found"}`. | Ensure the message was sent successfully via `POST /sms/send` and the webhook was received. Check that the `message_id` in your request matches the ID returned from the send endpoint. Delivery receipts may take a few seconds to arrive; wait briefly and retry. |
| Invalid phone number format | You receive a 400 error stating "Phone number must be in E.164 format". | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Environment variable not set | The application fails to start with "TELNYX_API_KEY environment variable not set". | Confirm your `.env` file exists in the same directory as `main.go` and contains all required variables: `TELNYX_API_KEY`, `TELNYX_PHONE_NUMBER`, and `WEBHOOK_URL`. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `godotenv.Load()` call must execute before `os.Getenv()` is called. |

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

- [Send Bulk SMS Messages](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/go/send-bulk-sms).
- [Receive SMS Webhooks with Go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/go/receive-sms-webhook).
- [Implement Two-Factor Authentication with SMS](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/go/otp-2fa).
